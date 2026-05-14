// Section 7 — Cross-module alert generators + alert lifecycle helpers.
// Each `scanX` function is idempotent: it upserts OPEN alerts by natural key
// and auto-resolves any prior OPEN alerts of its types whose condition no longer holds.

const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const AUDIENCE = {
  EXPIRY: ['WAREHOUSE', 'PROCUREMENT', 'ADMIN'],
  STOCKOUT_RISK: ['WAREHOUSE', 'PROCUREMENT', 'ADMIN'],
  DEAD_STOCK: ['WAREHOUSE', 'PROCUREMENT', 'ADMIN'],
  PAYMENT_DUE: ['FINANCE', 'ADMIN'],
  OVERDUE: ['FINANCE', 'ADMIN'],
  SUPPLIER_PERF: ['PROCUREMENT', 'ADMIN'],
  SHIPMENT_DELAY: ['WAREHOUSE', 'SALES', 'ADMIN'],
  CREDIT_LIMIT: ['SALES', 'FINANCE', 'ADMIN'],
  CERTIFICATION_EXPIRY: ['PROCUREMENT', 'WAREHOUSE', 'ADMIN'],
  // Tier 3 — anomaly alerts
  DEMAND_ANOMALY: ['WAREHOUSE', 'PROCUREMENT', 'SALES', 'ADMIN'],
  MARGIN: ['SALES', 'FINANCE', 'ADMIN'],
  LEAD_TIME: ['PROCUREMENT', 'ADMIN'],
};

// Carrier SLA (days from dispatch to expected delivery) — used when estimatedArrival missing.
const CARRIER_SLA_DAYS = { DHL: 5, ARAMEX: 5, BOSTA: 3, OTHER: 7 };

function naturalKey(type, entityType, entityId) {
  return `${type}::${entityType || ''}::${entityId || ''}`;
}

// Generic upsert: returns nothing; caller tracks stillActive keys.
async function upsertAlert(stillActive, openByKey, alert) {
  const key = naturalKey(alert.type, alert.entityType, alert.entityId);
  stillActive.add(key);
  const existing = openByKey.get(key);
  const data = {
    type: alert.type,
    severity: alert.severity,
    productId: alert.productId || null,
    supplierId: alert.supplierId || null,
    entityType: alert.entityType || null,
    entityId: alert.entityId || null,
    payload: alert.payload || {},
    reasoning: alert.reasoning || '',
    audienceRoles: AUDIENCE[alert.type] || [],
  };
  if (existing) {
    const sameSeverity = existing.severity === data.severity;
    const sameReasoning = existing.reasoning === data.reasoning;
    const samePayload = JSON.stringify(existing.payload) === JSON.stringify(data.payload);
    if (!sameSeverity || !sameReasoning || !samePayload) {
      await prisma.alert.update({ where: { id: existing.id }, data });
    }
    return;
  }
  const created = await prisma.alert.create({ data: { ...data, status: 'OPEN' } });

  // Fan out to subscribed users via outbox. Failure must not block alert creation.
  try {
    const notifications = require('./notifications.service');
    await notifications.dispatchAlertEmail(created);
  } catch (e) {
    // Use console here — logger import path may differ across older callers.
    console.error('[alerts] notifications dispatch failed:', e.message);
  }
}

async function loadOpenAlertsForTypes(types) {
  const rows = await prisma.alert.findMany({ where: { status: 'OPEN', type: { in: types } } });
  return new Map(rows.map((r) => [naturalKey(r.type, r.entityType, r.entityId), r]));
}

async function autoResolveStale(types, stillActive) {
  const open = await prisma.alert.findMany({ where: { status: 'OPEN', type: { in: types } } });
  let resolved = 0;
  for (const a of open) {
    const key = naturalKey(a.type, a.entityType, a.entityId);
    if (!stillActive.has(key)) {
      await prisma.alert.update({ where: { id: a.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
      resolved += 1;
    }
  }
  return resolved;
}

// ─── 1. Inventory ────────────────────────────────────────────────────────────
async function scanInventoryAlerts() {
  const TYPES = ['EXPIRY', 'STOCKOUT_RISK', 'DEAD_STOCK'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const now = new Date();
  const in90 = new Date(now.getTime() + 90 * 86400000);

  // EXPIRY — lots expiring within 90 days with stock on hand
  const lots = await prisma.lot.findMany({
    where: { expiryDate: { lte: in90 }, qtyRemaining: { gt: 0 } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  for (const lot of lots) {
    const daysLeft = Math.ceil((new Date(lot.expiryDate).getTime() - now.getTime()) / 86400000);
    let severity;
    if (daysLeft < 0) severity = 'CRITICAL';
    else if (daysLeft < 30) severity = 'HIGH';
    else if (daysLeft < 60) severity = 'MEDIUM';
    else severity = 'LOW';
    await upsertAlert(stillActive, openByKey, {
      type: 'EXPIRY',
      severity,
      productId: lot.productId,
      entityType: 'Lot',
      entityId: lot.id,
      payload: { lotId: lot.id, lotNumber: lot.lotNumber, qtyRemaining: lot.qtyRemaining, expiryDate: lot.expiryDate, daysLeft, sku: lot.product?.sku },
      reasoning: daysLeft < 0
        ? `Lot ${lot.lotNumber} expired ${Math.abs(daysLeft)} day(s) ago — ${lot.qtyRemaining} units remain.`
        : `Lot ${lot.lotNumber} expires in ${daysLeft} day(s) — ${lot.qtyRemaining} units.`,
    });
  }

  // STOCKOUT_RISK — onHand <= reorderPoint
  const stockLevels = await prisma.stockLevel.findMany({
    include: {
      product: { select: { id: true, sku: true, name: true, reorderPoint: true, isActive: true } },
      warehouse: { select: { id: true, code: true } },
    },
  });
  for (const sl of stockLevels) {
    if (!sl.product?.isActive || sl.product.reorderPoint == null) continue;
    if (sl.onHand > sl.product.reorderPoint) continue;
    const severity = sl.onHand <= 0 ? 'CRITICAL' : sl.onHand < sl.product.reorderPoint / 2 ? 'HIGH' : 'MEDIUM';
    await upsertAlert(stillActive, openByKey, {
      type: 'STOCKOUT_RISK',
      severity,
      productId: sl.productId,
      entityType: 'StockLevel',
      entityId: `${sl.productId}:${sl.warehouseId}`,
      payload: { warehouseId: sl.warehouseId, warehouseCode: sl.warehouse.code, onHand: sl.onHand, reorderPoint: sl.product.reorderPoint, sku: sl.product.sku },
      reasoning: `${sl.product.sku} at ${sl.warehouse.code}: ${sl.onHand} on hand vs reorder point ${sl.product.reorderPoint}.`,
    });
  }

  // DEAD_STOCK — QA quarantined lots
  const quarantined = await prisma.lot.findMany({
    where: { qaStatus: 'QUARANTINED', qtyRemaining: { gt: 0 } },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  for (const lot of quarantined) {
    await upsertAlert(stillActive, openByKey, {
      type: 'DEAD_STOCK',
      severity: 'MEDIUM',
      productId: lot.productId,
      entityType: 'Lot',
      entityId: lot.id,
      payload: { lotId: lot.id, lotNumber: lot.lotNumber, qtyRemaining: lot.qtyRemaining, reason: 'QA_QUARANTINE', sku: lot.product?.sku },
      reasoning: `Lot ${lot.lotNumber} (${lot.qtyRemaining} units of ${lot.product?.sku}) is on QA quarantine.`,
    });
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 2. AP — Payment due & overdue ───────────────────────────────────────────
async function scanApAlerts() {
  const TYPES = ['PAYMENT_DUE', 'OVERDUE'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const now = new Date();
  const in7 = new Date(now.getTime() + 7 * 86400000);

  // Open invoices: APPROVED or MATCHED status with remaining balance.
  const invoices = await prisma.supplierInvoice.findMany({
    where: {
      status: { in: ['APPROVED', 'MATCHED', 'PARTIALLY_PAID'] },
    },
    include: { supplier: { select: { id: true, code: true, name: true } } },
  });

  for (const inv of invoices) {
    const remaining = Number(inv.amount) - Number(inv.paidAmount);
    if (remaining <= 0) continue;

    const due = new Date(inv.dueDate);
    const daysToDue = Math.ceil((due.getTime() - now.getTime()) / 86400000);

    if (daysToDue < 0) {
      // OVERDUE
      const daysOver = Math.abs(daysToDue);
      let severity;
      if (daysOver > 30) severity = 'CRITICAL';
      else if (daysOver > 14) severity = 'HIGH';
      else severity = 'MEDIUM';
      await upsertAlert(stillActive, openByKey, {
        type: 'OVERDUE',
        severity,
        supplierId: inv.supplierId,
        entityType: 'SupplierInvoice',
        entityId: inv.id,
        payload: {
          invoiceNumber: inv.invoiceNumber,
          supplierCode: inv.supplier.code,
          supplierName: inv.supplier.name,
          amount: Number(inv.amount),
          paidAmount: Number(inv.paidAmount),
          remaining,
          currency: inv.currency,
          dueDate: inv.dueDate,
          daysOverdue: daysOver,
        },
        reasoning: `Invoice ${inv.invoiceNumber} (${inv.supplier.code}) overdue ${daysOver}d — ${remaining.toFixed(2)} ${inv.currency} unpaid.`,
      });
    } else if (daysToDue <= 7 && due <= in7) {
      let severity;
      if (daysToDue <= 1) severity = 'HIGH';
      else if (daysToDue <= 3) severity = 'MEDIUM';
      else severity = 'LOW';
      await upsertAlert(stillActive, openByKey, {
        type: 'PAYMENT_DUE',
        severity,
        supplierId: inv.supplierId,
        entityType: 'SupplierInvoice',
        entityId: inv.id,
        payload: {
          invoiceNumber: inv.invoiceNumber,
          supplierCode: inv.supplier.code,
          supplierName: inv.supplier.name,
          amount: Number(inv.amount),
          paidAmount: Number(inv.paidAmount),
          remaining,
          currency: inv.currency,
          dueDate: inv.dueDate,
          daysToDue,
        },
        reasoning: `Invoice ${inv.invoiceNumber} (${inv.supplier.code}) due in ${daysToDue}d — ${remaining.toFixed(2)} ${inv.currency} outstanding.`,
      });
    }
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 3. Supplier performance ─────────────────────────────────────────────────
async function scanSupplierPerfAlerts() {
  const TYPES = ['SUPPLIER_PERF'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  // Take latest AUTO performance row per supplier within last 180d. Flag if overallScore < 0.7.
  const cutoff = new Date(Date.now() - 180 * 86400000);
  const suppliers = await prisma.supplier.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });

  for (const s of suppliers) {
    const latest = await prisma.supplierPerformance.findFirst({
      where: { supplierId: s.id, periodStart: { gte: cutoff } },
      orderBy: { periodStart: 'desc' },
    });
    if (!latest) continue;

    const onTime = latest.onTimeRate ?? null;
    const fill = latest.fillRate ?? null;
    const defectInv = latest.defectRate == null ? null : 1 - Number(latest.defectRate);
    const parts = [];
    if (onTime != null) parts.push({ w: 0.4, v: Number(onTime) });
    if (fill != null) parts.push({ w: 0.3, v: Number(fill) });
    if (defectInv != null) parts.push({ w: 0.3, v: defectInv });
    if (!parts.length) continue;
    const totalW = parts.reduce((acc, p) => acc + p.w, 0);
    const score = parts.reduce((acc, p) => acc + p.w * p.v, 0) / totalW;

    if (score >= 0.7) continue;

    let severity;
    if (score < 0.5) severity = 'CRITICAL';
    else if (score < 0.6) severity = 'HIGH';
    else severity = 'MEDIUM';

    await upsertAlert(stillActive, openByKey, {
      type: 'SUPPLIER_PERF',
      severity,
      supplierId: s.id,
      entityType: 'Supplier',
      entityId: s.id,
      payload: {
        supplierCode: s.code,
        supplierName: s.name,
        overallScore: Number(score.toFixed(3)),
        onTimeRate: onTime == null ? null : Number(onTime),
        fillRate: fill == null ? null : Number(fill),
        defectRate: latest.defectRate == null ? null : Number(latest.defectRate),
        periodStart: latest.periodStart,
      },
      reasoning: `Supplier ${s.code} performance score ${(score * 100).toFixed(1)}% in latest period.`,
    });
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 4. Shipment delay ───────────────────────────────────────────────────────
async function scanShipmentDelayAlerts() {
  const TYPES = ['SHIPMENT_DELAY'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const now = new Date();
  const shipments = await prisma.shipment.findMany({
    where: { status: { in: ['PENDING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] } },
    include: { salesOrder: { select: { orderNumber: true, customerName: true } } },
  });

  for (const sh of shipments) {
    // Compute expected ETA: estimatedArrival OR (dispatchedAt + carrier SLA days) OR (createdAt + SLA + 1).
    const slaDays = CARRIER_SLA_DAYS[sh.carrier] ?? CARRIER_SLA_DAYS.OTHER;
    let expected = sh.estimatedArrival ? new Date(sh.estimatedArrival) : null;
    if (!expected) {
      const base = sh.dispatchedAt ? new Date(sh.dispatchedAt) : new Date(sh.createdAt);
      expected = new Date(base.getTime() + slaDays * 86400000);
    }
    if (now <= expected) continue;
    const daysLate = Math.ceil((now.getTime() - expected.getTime()) / 86400000);

    let severity;
    if (daysLate > 7) severity = 'CRITICAL';
    else if (daysLate > 3) severity = 'HIGH';
    else severity = 'MEDIUM';

    await upsertAlert(stillActive, openByKey, {
      type: 'SHIPMENT_DELAY',
      severity,
      entityType: 'Shipment',
      entityId: sh.id,
      payload: {
        shipmentNumber: sh.shipmentNumber,
        carrier: sh.carrier,
        status: sh.status,
        dispatchedAt: sh.dispatchedAt,
        estimatedArrival: sh.estimatedArrival,
        expectedDelivery: expected,
        daysLate,
        orderNumber: sh.salesOrder?.orderNumber || null,
        customerName: sh.salesOrder?.customerName || null,
      },
      reasoning: `Shipment ${sh.shipmentNumber}${sh.carrier ? ` via ${sh.carrier}` : ''} is ${daysLate}d past expected delivery.`,
    });
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 5. Credit limit ─────────────────────────────────────────────────────────
async function scanCreditLimitAlerts() {
  const TYPES = ['CREDIT_LIMIT'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const customers = await prisma.customer.findMany({
    where: { isActive: true, deletedAt: null, creditLimit: { not: null } },
    select: { id: true, code: true, name: true, creditLimit: true, currency: true },
  });

  for (const c of customers) {
    const limit = Number(c.creditLimit);
    if (!(limit > 0)) continue;

    const openOrders = await prisma.salesOrder.findMany({
      where: {
        customerId: c.id,
        status: { in: ['RECEIVED', 'CONFIRMED', 'ALLOCATED', 'PICKED', 'PACKED', 'SHIPPED'] },
      },
      select: { id: true, orderNumber: true, totalAmount: true },
    });
    const exposure = openOrders.reduce((acc, o) => acc + Number(o.totalAmount), 0);
    const utilization = exposure / limit;
    if (utilization < 0.8) continue;

    let severity;
    if (utilization > 1) severity = 'CRITICAL';
    else if (utilization > 0.9) severity = 'HIGH';
    else severity = 'MEDIUM';

    await upsertAlert(stillActive, openByKey, {
      type: 'CREDIT_LIMIT',
      severity,
      entityType: 'Customer',
      entityId: c.id,
      payload: {
        customerCode: c.code,
        customerName: c.name,
        creditLimit: limit,
        exposure: Number(exposure.toFixed(2)),
        utilization: Number(utilization.toFixed(3)),
        currency: c.currency,
        openOrderCount: openOrders.length,
      },
      reasoning: `Customer ${c.code} open exposure ${exposure.toFixed(2)} ${c.currency} is ${(utilization * 100).toFixed(1)}% of credit limit (${limit.toFixed(2)}).`,
    });
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 6. Demand anomaly — sustained 7d outflow surge vs 28d baseline ──────────
//
// Algorithm:
//   1. Group OUT/SHIPMENT StockMovement rows by productId × day for the last 35 days.
//   2. Per product, recent = last 7 days, baseline = prior 28 days.
//   3. baselineMean = sum/28; baselineStd = stddev over those 28 daily totals.
//   4. recentMean = sum/7.
//   5. Flag when recentMean > baselineMean + 2*baselineStd AND
//                  recentMean >= 1.5 * baselineMean AND
//                  baselineMean >= 1 (guards tiny-baseline noise).
//   6. Severity: HIGH if recentMean ≥ 2*baselineMean or > baselineMean + 3*baselineStd; else MEDIUM.
//   7. Auto-resolve when current 7d ≤ baselineMean + 1*baselineStd.
async function scanDemandAnomalyAlerts() {
  const TYPES = ['DEMAND_ANOMALY'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const now = Date.now();
  const startOfTodayUtc = (() => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
  const window35Start = new Date(startOfTodayUtc - 35 * 86400000);

  const movements = await prisma.stockMovement.findMany({
    where: {
      createdAt: { gte: window35Start },
      reasonCode: 'SHIPMENT',
      direction: 'OUT',
    },
    select: { productId: true, qty: true, createdAt: true },
  });

  // Aggregate qty per product per UTC day.
  const byProductDay = new Map(); // productId -> Map<dayIso, qty>
  for (const m of movements) {
    const d = new Date(m.createdAt);
    d.setUTCHours(0, 0, 0, 0);
    const dayIso = d.toISOString().slice(0, 10);
    if (!byProductDay.has(m.productId)) byProductDay.set(m.productId, new Map());
    const map = byProductDay.get(m.productId);
    map.set(dayIso, (map.get(dayIso) || 0) + Math.abs(m.qty));
  }

  if (byProductDay.size > 0) {
    const productIds = [...byProductDay.keys()];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, sku: true, name: true },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    // Build day axis for baseline (days -35..-7) and recent (days -7..-1).
    const baselineDays = [];
    for (let i = 35; i >= 8; i -= 1) baselineDays.push(new Date(startOfTodayUtc - i * 86400000).toISOString().slice(0, 10));
    const recentDays = [];
    for (let i = 7; i >= 1; i -= 1) recentDays.push(new Date(startOfTodayUtc - i * 86400000).toISOString().slice(0, 10));

    for (const [productId, dayMap] of byProductDay) {
      const product = productById.get(productId);
      if (!product) continue;

      const baselineDaily = baselineDays.map((d) => dayMap.get(d) || 0);
      const recentDaily = recentDays.map((d) => dayMap.get(d) || 0);
      const baselineSum = baselineDaily.reduce((a, b) => a + b, 0);
      const recentSum = recentDaily.reduce((a, b) => a + b, 0);
      const baselineMean = baselineSum / 28;
      const recentMean = recentSum / 7;
      if (baselineMean < 1) continue; // ignore tiny baselines

      const variance = baselineDaily.reduce((acc, v) => acc + (v - baselineMean) ** 2, 0) / 28;
      const baselineStd = Math.sqrt(variance);

      const thresholdSpike = baselineMean + 2 * baselineStd;
      const thresholdRatio = 1.5 * baselineMean;

      if (recentMean > thresholdSpike && recentMean >= thresholdRatio) {
        const ratio = recentMean / baselineMean;
        const severity = (ratio >= 2 || recentMean > baselineMean + 3 * baselineStd) ? 'HIGH' : 'MEDIUM';
        await upsertAlert(stillActive, openByKey, {
          type: 'DEMAND_ANOMALY',
          severity,
          productId,
          entityType: 'Product',
          entityId: productId,
          payload: {
            sku: product.sku,
            name: product.name,
            recent7dQty: recentSum,
            recent7dDailyMean: Number(recentMean.toFixed(2)),
            baseline28dDailyMean: Number(baselineMean.toFixed(2)),
            baseline28dDailyStd: Number(baselineStd.toFixed(2)),
            ratio: Number(ratio.toFixed(2)),
          },
          reasoning: `${product.sku} 7-day outflow averages ${recentMean.toFixed(1)}/day — ${ratio.toFixed(1)}× the 28-day baseline of ${baselineMean.toFixed(1)}/day.`,
        });
      }
    }
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 7. Margin erosion — realized weighted margin drop on SKUs sold lately ───
//
// Algorithm:
//   For each Product with shipped SalesOrderLines in last 90d:
//     marginFor(window) = Σ(qty * (unitPrice - product.costPrice)) / Σ(qty * unitPrice)
//     current  = marginFor(last 30d)
//     baseline = marginFor(prior 60d, i.e. day -90..-31)
//   Flag when:
//     current < baseline - 0.05 (5pp drop), AND
//     current < 0.15 (absolute floor), AND
//     baseline >= 0.10 (need a meaningful baseline to drop from), AND
//     last30 has ≥ 3 line entries.
//   Severity: CRITICAL if current < 0; HIGH if drop ≥ 0.10; else MEDIUM.
//   Auto-resolve when current recovers to baseline - 0.02 (2pp).
async function scanMarginErosionAlerts() {
  const TYPES = ['MARGIN'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const now = Date.now();
  const cutoff90 = new Date(now - 90 * 86400000);
  const cutoff30 = new Date(now - 30 * 86400000);

  // Pull all lines whose parent order shipped in the last 90 days.
  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrder: { shippedAt: { gte: cutoff90 } } },
    select: {
      productId: true,
      qty: true,
      unitPrice: true,
      salesOrder: { select: { shippedAt: true } },
      product: { select: { id: true, sku: true, name: true, costPrice: true } },
    },
  });

  // Bucket per product.
  const buckets = new Map(); // productId -> { product, current: {qty, revenue, profit, count}, baseline: same }
  for (const ln of lines) {
    if (!ln.product || ln.product.costPrice == null) continue;
    const cost = Number(ln.product.costPrice);
    const price = Number(ln.unitPrice);
    const qty = Number(ln.qty);
    if (qty <= 0 || price <= 0) continue;

    const revenue = qty * price;
    const profit = qty * (price - cost);
    const shippedAt = new Date(ln.salesOrder.shippedAt);

    let b = buckets.get(ln.productId);
    if (!b) {
      b = {
        product: ln.product,
        current: { qty: 0, revenue: 0, profit: 0, count: 0 },
        baseline: { qty: 0, revenue: 0, profit: 0, count: 0 },
      };
      buckets.set(ln.productId, b);
    }
    const target = shippedAt >= cutoff30 ? b.current : b.baseline;
    target.qty += qty;
    target.revenue += revenue;
    target.profit += profit;
    target.count += 1;
  }

  for (const [productId, b] of buckets) {
    if (b.current.count < 3 || b.current.revenue <= 0 || b.baseline.revenue <= 0) continue;
    const currentMargin = b.current.profit / b.current.revenue;
    const baselineMargin = b.baseline.profit / b.baseline.revenue;
    if (baselineMargin < 0.10) continue; // skip products without meaningful baseline

    if (currentMargin < baselineMargin - 0.05 && currentMargin < 0.15) {
      const drop = baselineMargin - currentMargin;
      const severity = currentMargin < 0 ? 'CRITICAL' : (drop >= 0.10 ? 'HIGH' : 'MEDIUM');
      await upsertAlert(stillActive, openByKey, {
        type: 'MARGIN',
        severity,
        productId,
        entityType: 'Product',
        entityId: productId,
        payload: {
          sku: b.product.sku,
          name: b.product.name,
          currentMarginPct: Number((currentMargin * 100).toFixed(2)),
          baselineMarginPct: Number((baselineMargin * 100).toFixed(2)),
          dropPp: Number((drop * 100).toFixed(2)),
          last30dRevenue: Number(b.current.revenue.toFixed(2)),
          last30dProfit: Number(b.current.profit.toFixed(2)),
          last30dLines: b.current.count,
        },
        reasoning: `${b.product.sku} 30-day margin ${(currentMargin * 100).toFixed(1)}% — down ${(drop * 100).toFixed(1)}pp from baseline ${(baselineMargin * 100).toFixed(1)}%.`,
      });
    }
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── 8. Lead time drift — supplier delivery time degradation ─────────────────
//
// Algorithm:
//   Take GoodsReceipts in last 90d, join PO for sentAt + supplierId.
//   Per supplier:
//     recent   = receipts in last 30d
//     baseline = receipts in prior 60d (day -90..-31)
//   leadTimeDays = (receivedAt - sentAt) / 86400000 — skip if sentAt missing or negative.
//   Flag when:
//     recent.count >= 3, AND
//     baseline.count >= 3, AND
//     recent.mean > baseline.mean + 1.5 * baseline.std, AND
//     recent.mean > baseline.mean + 1 (at least 1 day worse, absolute floor).
//   Severity: HIGH if recent.mean > 2*baseline.mean or > baseline.mean + 3*baseline.std; else MEDIUM.
//   Auto-resolve when recent.mean returns to baseline.mean + 0.5 * baseline.std.
async function scanLeadTimeDriftAlerts() {
  const TYPES = ['LEAD_TIME'];
  const openByKey = await loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const now = Date.now();
  const cutoff90 = new Date(now - 90 * 86400000);
  const cutoff30 = new Date(now - 30 * 86400000);

  const grns = await prisma.goodsReceipt.findMany({
    where: { receivedAt: { gte: cutoff90 } },
    select: {
      receivedAt: true,
      purchaseOrder: { select: { supplierId: true, sentAt: true } },
    },
  });

  const bySupplier = new Map(); // supplierId -> { current: number[], baseline: number[] }
  for (const g of grns) {
    const po = g.purchaseOrder;
    if (!po || !po.sentAt || !po.supplierId) continue;
    const leadDays = (new Date(g.receivedAt).getTime() - new Date(po.sentAt).getTime()) / 86400000;
    if (leadDays < 0 || leadDays > 365) continue; // skip junk

    let b = bySupplier.get(po.supplierId);
    if (!b) { b = { current: [], baseline: [] }; bySupplier.set(po.supplierId, b); }
    if (new Date(g.receivedAt) >= cutoff30) b.current.push(leadDays);
    else b.baseline.push(leadDays);
  }

  if (bySupplier.size > 0) {
    const suppliers = await prisma.supplier.findMany({
      where: { id: { in: [...bySupplier.keys()] } },
      select: { id: true, code: true, name: true, leadTimeDays: true },
    });
    const supplierById = new Map(suppliers.map((s) => [s.id, s]));

    for (const [supplierId, b] of bySupplier) {
      const supplier = supplierById.get(supplierId);
      if (!supplier) continue;
      if (b.current.length < 3 || b.baseline.length < 3) continue;

      const mean = (arr) => arr.reduce((a, x) => a + x, 0) / arr.length;
      const std = (arr, m) => Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length);
      const baselineMean = mean(b.baseline);
      const baselineStd = std(b.baseline, baselineMean);
      const recentMean = mean(b.current);

      const drift = recentMean - baselineMean;
      const thresholdStd = baselineMean + 1.5 * baselineStd;
      if (recentMean > thresholdStd && drift > 1) {
        const severity = (recentMean >= 2 * baselineMean || recentMean > baselineMean + 3 * baselineStd) ? 'HIGH' : 'MEDIUM';
        await upsertAlert(stillActive, openByKey, {
          type: 'LEAD_TIME',
          severity,
          supplierId,
          entityType: 'Supplier',
          entityId: supplierId,
          payload: {
            supplierCode: supplier.code,
            supplierName: supplier.name,
            recent30dMeanDays: Number(recentMean.toFixed(2)),
            recent30dCount: b.current.length,
            baselineMeanDays: Number(baselineMean.toFixed(2)),
            baselineStdDays: Number(baselineStd.toFixed(2)),
            baselineCount: b.baseline.length,
            driftDays: Number(drift.toFixed(2)),
          },
          reasoning: `${supplier.code} 30-day lead time ${recentMean.toFixed(1)}d — drift +${drift.toFixed(1)}d vs baseline ${baselineMean.toFixed(1)}d (σ=${baselineStd.toFixed(1)}).`,
        });
      }
    }
  }

  const resolved = await autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// ─── Master scan ─────────────────────────────────────────────────────────────
async function runAllScans({ actorId = null, sourceIp = null } = {}) {
  const compliance = require('./compliance.service');
  const summary = {
    inventory: await scanInventoryAlerts(),
    ap: await scanApAlerts(),
    supplierPerf: await scanSupplierPerfAlerts(),
    shipmentDelay: await scanShipmentDelayAlerts(),
    creditLimit: await scanCreditLimitAlerts(),
    certificationExpiry: await compliance.scanCertificationExpiryAlerts(),
    demandAnomaly: await scanDemandAnomalyAlerts(),
    marginErosion: await scanMarginErosionAlerts(),
    leadTimeDrift: await scanLeadTimeDriftAlerts(),
  };
  await logEvent({ eventType: 'ALERTS_SCANNED', entityType: 'Alert', entityId: 'all', actorId, payload: summary, sourceIp });
  return summary;
}

// ─── List / filter / lifecycle ───────────────────────────────────────────────
async function listAlerts({ status, type, severity, role, limit = 50, offset = 0 } = {}) {
  const where = {};
  if (status) where.status = status;
  if (type) where.type = type;
  if (severity) where.severity = severity;

  // role filter: non-ADMIN users only see alerts whose audienceRoles is empty or contains their role.
  if (role && role !== 'ADMIN') {
    where.OR = [
      { audienceRoles: { isEmpty: true } },
      { audienceRoles: { has: role } },
    ];
  }

  const [alerts, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      take: Math.min(Number(limit) || 50, 200),
      skip: Number(offset) || 0,
      orderBy: [
        { status: 'asc' },
        { severity: 'desc' },
        { createdAt: 'desc' },
      ],
    }),
    prisma.alert.count({ where }),
  ]);

  const productIds = [...new Set(alerts.map((a) => a.productId).filter(Boolean))];
  const supplierIds = [...new Set(alerts.map((a) => a.supplierId).filter(Boolean))];
  const [products, suppliers] = await Promise.all([
    productIds.length ? prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } }) : [],
    supplierIds.length ? prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, code: true, name: true } }) : [],
  ]);
  const productById = new Map(products.map((p) => [p.id, p]));
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const decorated = alerts.map((a) => ({
    ...a,
    product: a.productId ? productById.get(a.productId) || null : null,
    supplier: a.supplierId ? supplierById.get(a.supplierId) || null : null,
  }));

  const counts = await prisma.alert.groupBy({
    by: ['status', 'severity'],
    where: { status: 'OPEN' },
    _count: { _all: true },
  });
  const severityCounts = counts.reduce((acc, c) => {
    acc[c.severity] = (acc[c.severity] || 0) + c._count._all;
    return acc;
  }, {});

  return { alerts: decorated, total, counts: severityCounts };
}

async function acknowledgeAlert(id, actorId) {
  const alert = await prisma.alert.findUnique({ where: { id } });
  if (!alert) return null;
  return prisma.alert.update({
    where: { id },
    data: { status: 'ACKNOWLEDGED', acknowledgedById: actorId, acknowledgedAt: new Date() },
  });
}

async function snoozeAlert(id, until) {
  const target = new Date(until);
  if (Number.isNaN(target.getTime()) || target <= new Date()) {
    const e = new Error('snoozedUntil must be a future date');
    e.status = 400;
    throw e;
  }
  return prisma.alert.update({ where: { id }, data: { status: 'SNOOZED', snoozedUntil: target } });
}

async function resolveAlert(id, actorId) {
  await logEvent({ eventType: 'ALERT_RESOLVED', entityType: 'Alert', entityId: id, actorId });
  return prisma.alert.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
}

module.exports = {
  AUDIENCE,
  CARRIER_SLA_DAYS,
  loadOpenAlertsForTypes,
  upsertAlert,
  autoResolveStale,
  scanInventoryAlerts,
  scanApAlerts,
  scanSupplierPerfAlerts,
  scanShipmentDelayAlerts,
  scanCreditLimitAlerts,
  scanDemandAnomalyAlerts,
  scanMarginErosionAlerts,
  scanLeadTimeDriftAlerts,
  runAllScans,
  listAlerts,
  acknowledgeAlert,
  snoozeAlert,
  resolveAlert,
};
