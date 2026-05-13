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
  runAllScans,
  listAlerts,
  acknowledgeAlert,
  snoozeAlert,
  resolveAlert,
};
