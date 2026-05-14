// Section 7 — Cross-module CSV/JSON reports.
//   - GET /api/reports/ap-aging
//   - GET /api/reports/supplier-scorecards
//   - GET /api/reports/sales-fulfillment

const prisma = require('../lib/prisma');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

function toCsvRow(values) {
  return values
    .map((v) => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

function sendCsv(res, filename, header, rows) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  return res.send([toCsvRow(header), ...rows.map((r) => toCsvRow(r))].join('\r\n'));
}

function bucketize(daysOverdue) {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

// ─── AP Aging ────────────────────────────────────────────────────────────────
const apAging = wrap(async (req, res) => {
  const { format = 'json', supplierId } = req.query;
  const now = new Date();
  const where = { status: { in: ['APPROVED', 'MATCHED', 'PARTIALLY_PAID'] } };
  if (supplierId) where.supplierId = supplierId;

  const invoices = await prisma.supplierInvoice.findMany({
    where,
    include: { supplier: { select: { code: true, name: true } } },
    orderBy: { dueDate: 'asc' },
  });

  const rows = [];
  const buckets = { CURRENT: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let totalOutstanding = 0;

  for (const inv of invoices) {
    const outstanding = Number(inv.amount) - Number(inv.paidAmount);
    if (outstanding <= 0) continue;
    const daysOverdue = Math.ceil((now.getTime() - new Date(inv.dueDate).getTime()) / 86400000);
    const bucket = bucketize(daysOverdue);
    buckets[bucket] += outstanding;
    totalOutstanding += outstanding;
    rows.push({
      supplierCode: inv.supplier.code,
      supplierName: inv.supplier.name,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      bucket,
      amount: Number(inv.amount),
      paidAmount: Number(inv.paidAmount),
      outstanding,
      currency: inv.currency,
      status: inv.status,
    });
  }

  if (format === 'csv') {
    return sendCsv(
      res,
      'ap-aging.csv',
      ['Supplier Code', 'Supplier Name', 'Invoice #', 'Invoice Date', 'Due Date', 'Days Overdue', 'Bucket', 'Amount', 'Paid', 'Outstanding', 'Currency', 'Status'],
      rows.map((r) => [
        r.supplierCode, r.supplierName, r.invoiceNumber,
        r.invoiceDate.toISOString().slice(0, 10), r.dueDate.toISOString().slice(0, 10),
        r.daysOverdue, r.bucket, r.amount.toFixed(2), r.paidAmount.toFixed(2),
        r.outstanding.toFixed(2), r.currency, r.status,
      ]),
    );
  }

  res.json({
    rows,
    summary: {
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Number(v.toFixed(2))])),
      invoiceCount: rows.length,
    },
  });
});

// ─── Supplier Scorecards ─────────────────────────────────────────────────────
const supplierScorecards = wrap(async (req, res) => {
  const { format = 'json' } = req.query;

  const suppliers = await prisma.supplier.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true } });
  const rows = [];
  for (const s of suppliers) {
    const latest = await prisma.supplierPerformance.findFirst({
      where: { supplierId: s.id },
      orderBy: { periodStart: 'desc' },
    });
    if (!latest) {
      rows.push({ supplierCode: s.code, supplierName: s.name, hasData: false });
      continue;
    }
    const onTime = latest.onTimeRate == null ? null : Number(latest.onTimeRate);
    const fill = latest.fillRate == null ? null : Number(latest.fillRate);
    const defect = latest.defectRate == null ? null : Number(latest.defectRate);
    const parts = [];
    if (onTime != null) parts.push({ w: 0.4, v: onTime });
    if (fill != null) parts.push({ w: 0.3, v: fill });
    if (defect != null) parts.push({ w: 0.3, v: 1 - defect });
    const totalW = parts.reduce((a, p) => a + p.w, 0);
    const score = totalW ? parts.reduce((a, p) => a + p.w * p.v, 0) / totalW : null;

    rows.push({
      supplierCode: s.code,
      supplierName: s.name,
      hasData: true,
      periodStart: latest.periodStart,
      periodEnd: latest.periodEnd,
      onTimeRate: onTime,
      fillRate: fill,
      defectRate: defect,
      leadTimeMean: latest.leadTimeMean == null ? null : Number(latest.leadTimeMean),
      leadTimeStd: latest.leadTimeStd == null ? null : Number(latest.leadTimeStd),
      overallScore: score == null ? null : Number(score.toFixed(3)),
      source: latest.source,
    });
  }

  rows.sort((a, b) => {
    const sa = a.overallScore ?? -Infinity;
    const sb = b.overallScore ?? -Infinity;
    return sb - sa;
  });

  if (format === 'csv') {
    return sendCsv(
      res,
      'supplier-scorecards.csv',
      ['Supplier Code', 'Supplier Name', 'Period Start', 'Period End', 'On-Time %', 'Fill Rate %', 'Defect Rate %', 'Lead Time Mean (d)', 'Lead Time Std (d)', 'Overall Score', 'Source'],
      rows.map((r) => [
        r.supplierCode, r.supplierName,
        r.periodStart ? new Date(r.periodStart).toISOString().slice(0, 10) : '',
        r.periodEnd ? new Date(r.periodEnd).toISOString().slice(0, 10) : '',
        r.onTimeRate == null ? '' : (r.onTimeRate * 100).toFixed(1),
        r.fillRate == null ? '' : (r.fillRate * 100).toFixed(1),
        r.defectRate == null ? '' : (r.defectRate * 100).toFixed(1),
        r.leadTimeMean == null ? '' : r.leadTimeMean.toFixed(1),
        r.leadTimeStd == null ? '' : r.leadTimeStd.toFixed(1),
        r.overallScore == null ? '' : r.overallScore,
        r.source || '',
      ]),
    );
  }

  res.json({ rows, summary: { total: rows.length, withData: rows.filter((r) => r.hasData).length } });
});

// ─── Sales Fulfillment ───────────────────────────────────────────────────────
const salesFulfillment = wrap(async (req, res) => {
  const { format = 'json', from, to } = req.query;
  const where = {};
  if (from || to) {
    where.orderedAt = {};
    if (from) where.orderedAt.gte = new Date(from);
    if (to) where.orderedAt.lte = new Date(to);
  }

  const orders = await prisma.salesOrder.findMany({
    where,
    include: {
      customer: { select: { code: true, name: true } },
      lines: { select: { qty: true, qtyShipped: true, unitPrice: true } },
    },
    orderBy: { orderedAt: 'desc' },
  });

  const rows = [];
  let totalRevenue = 0;
  let totalShipped = 0;
  let totalOrdered = 0;
  const statusCounts = {};
  const leadTimesHours = [];

  for (const so of orders) {
    const ordered = so.lines.reduce((s, l) => s + l.qty, 0);
    const shipped = so.lines.reduce((s, l) => s + l.qtyShipped, 0);
    const fillRate = ordered ? shipped / ordered : null;
    const revenue = Number(so.totalAmount);
    let cycleHours = null;
    if (so.deliveredAt && so.orderedAt) {
      cycleHours = (new Date(so.deliveredAt).getTime() - new Date(so.orderedAt).getTime()) / 3600000;
      leadTimesHours.push(cycleHours);
    }
    totalRevenue += revenue;
    totalShipped += shipped;
    totalOrdered += ordered;
    statusCounts[so.status] = (statusCounts[so.status] || 0) + 1;
    rows.push({
      orderNumber: so.orderNumber,
      orderedAt: so.orderedAt,
      status: so.status,
      customerCode: so.customer?.code || null,
      customerName: so.customerName,
      qtyOrdered: ordered,
      qtyShipped: shipped,
      fillRate: fillRate == null ? null : Number(fillRate.toFixed(3)),
      revenue,
      currency: so.currency,
      cycleHours: cycleHours == null ? null : Number(cycleHours.toFixed(1)),
      deliveredAt: so.deliveredAt,
    });
  }

  if (format === 'csv') {
    return sendCsv(
      res,
      'sales-fulfillment.csv',
      ['Order #', 'Ordered At', 'Status', 'Customer Code', 'Customer Name', 'Qty Ordered', 'Qty Shipped', 'Fill Rate', 'Revenue', 'Currency', 'Cycle Hours', 'Delivered At'],
      rows.map((r) => [
        r.orderNumber, new Date(r.orderedAt).toISOString(), r.status,
        r.customerCode || '', r.customerName, r.qtyOrdered, r.qtyShipped,
        r.fillRate == null ? '' : (r.fillRate * 100).toFixed(1) + '%',
        r.revenue.toFixed(2), r.currency,
        r.cycleHours == null ? '' : r.cycleHours.toFixed(1),
        r.deliveredAt ? new Date(r.deliveredAt).toISOString() : '',
      ]),
    );
  }

  const avgCycleHours = leadTimesHours.length ? leadTimesHours.reduce((a, b) => a + b, 0) / leadTimesHours.length : null;
  res.json({
    rows,
    summary: {
      orderCount: rows.length,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      totalOrdered,
      totalShipped,
      overallFillRate: totalOrdered ? Number((totalShipped / totalOrdered).toFixed(3)) : null,
      avgCycleHours: avgCycleHours == null ? null : Number(avgCycleHours.toFixed(1)),
      statusCounts,
    },
  });
});

// ─── Demand anomalies (Tier 3) ───────────────────────────────────────────────
// Inspect last `days` of OUT/SHIPMENT movements per product and surface SKUs
// whose recent 7d daily mean exceeds the prior baseline mean + 2σ.
const demandAnomalies = wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 14), 180);
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const movements = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: since }, reasonCode: 'SHIPMENT', direction: 'OUT' },
    select: { productId: true, qty: true, createdAt: true },
  });
  if (movements.length === 0) return res.json({ days, rows: [] });

  const productIds = [...new Set(movements.map((m) => m.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, sku: true, name: true },
  });
  const productById = new Map(products.map((p) => [p.id, p]));

  // Per product, compute recent7 and baseline (everything before recent7).
  const cutoffRecent = Date.now() - 7 * 86400000;
  const stats = new Map();
  for (const m of movements) {
    let s = stats.get(m.productId);
    if (!s) { s = { recent: 0, recentDays: new Set(), baseline: [], baselineDayMap: new Map() }; stats.set(m.productId, s); }
    const t = new Date(m.createdAt);
    const dayKey = (() => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.toISOString().slice(0, 10); })();
    if (t.getTime() >= cutoffRecent) {
      s.recent += Math.abs(m.qty);
      s.recentDays.add(dayKey);
    } else {
      s.baselineDayMap.set(dayKey, (s.baselineDayMap.get(dayKey) || 0) + Math.abs(m.qty));
    }
  }

  const rows = [];
  for (const [productId, s] of stats) {
    const baselineDailyTotals = [...s.baselineDayMap.values()];
    const baselineDayCount = Math.max(1, days - 7);
    // Pad zero-days into baseline to keep mean honest.
    const zeros = Math.max(0, baselineDayCount - baselineDailyTotals.length);
    for (let i = 0; i < zeros; i += 1) baselineDailyTotals.push(0);
    const baselineMean = baselineDailyTotals.reduce((a, b) => a + b, 0) / baselineDailyTotals.length;
    const variance = baselineDailyTotals.reduce((a, v) => a + (v - baselineMean) ** 2, 0) / baselineDailyTotals.length;
    const baselineStd = Math.sqrt(variance);
    const recentMean = s.recent / 7;
    const ratio = baselineMean > 0 ? recentMean / baselineMean : null;
    const product = productById.get(productId);
    if (!product) continue;
    rows.push({
      productId,
      sku: product.sku,
      name: product.name,
      recent7dQty: s.recent,
      recent7dDailyMean: Number(recentMean.toFixed(2)),
      baselineDailyMean: Number(baselineMean.toFixed(2)),
      baselineDailyStd: Number(baselineStd.toFixed(2)),
      ratio: ratio == null ? null : Number(ratio.toFixed(2)),
      isSpike: baselineMean >= 1 && recentMean > baselineMean + 2 * baselineStd && recentMean >= 1.5 * baselineMean,
    });
  }
  rows.sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));
  res.json({ days, rows });
});

// ─── Margin erosion (Tier 3) ─────────────────────────────────────────────────
// Per-product weighted-margin comparison: last 30d vs prior 60d.
const marginErosion = wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 60), 180);
  const cutoffWindow = new Date(Date.now() - days * 86400000);
  const cutoffRecent = new Date(Date.now() - 30 * 86400000);

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrder: { shippedAt: { gte: cutoffWindow } } },
    select: {
      productId: true, qty: true, unitPrice: true,
      salesOrder: { select: { shippedAt: true } },
      product: { select: { id: true, sku: true, name: true, costPrice: true } },
    },
  });

  const buckets = new Map();
  for (const ln of lines) {
    if (!ln.product || ln.product.costPrice == null) continue;
    const cost = Number(ln.product.costPrice);
    const price = Number(ln.unitPrice);
    const qty = Number(ln.qty);
    if (qty <= 0 || price <= 0) continue;
    let b = buckets.get(ln.productId);
    if (!b) {
      b = { product: ln.product, current: { qty: 0, revenue: 0, profit: 0, count: 0 }, baseline: { qty: 0, revenue: 0, profit: 0, count: 0 } };
      buckets.set(ln.productId, b);
    }
    const tgt = new Date(ln.salesOrder.shippedAt) >= cutoffRecent ? b.current : b.baseline;
    tgt.qty += qty;
    tgt.revenue += qty * price;
    tgt.profit += qty * (price - cost);
    tgt.count += 1;
  }

  const rows = [];
  for (const [productId, b] of buckets) {
    const currentMargin = b.current.revenue > 0 ? b.current.profit / b.current.revenue : null;
    const baselineMargin = b.baseline.revenue > 0 ? b.baseline.profit / b.baseline.revenue : null;
    rows.push({
      productId,
      sku: b.product.sku,
      name: b.product.name,
      currentMarginPct: currentMargin == null ? null : Number((currentMargin * 100).toFixed(2)),
      baselineMarginPct: baselineMargin == null ? null : Number((baselineMargin * 100).toFixed(2)),
      dropPp: (currentMargin != null && baselineMargin != null) ? Number(((baselineMargin - currentMargin) * 100).toFixed(2)) : null,
      last30dRevenue: Number(b.current.revenue.toFixed(2)),
      last30dLines: b.current.count,
    });
  }
  rows.sort((a, b) => (b.dropPp ?? -Infinity) - (a.dropPp ?? -Infinity));
  res.json({ days, rows });
});

// ─── Lead time drift (Tier 3) ────────────────────────────────────────────────
// Per-supplier realized lead time over last `days` window: last 30d vs prior.
const leadTimeDrift = wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 90, 60), 180);
  const cutoffWindow = new Date(Date.now() - days * 86400000);
  const cutoffRecent = new Date(Date.now() - 30 * 86400000);

  const grns = await prisma.goodsReceipt.findMany({
    where: { receivedAt: { gte: cutoffWindow } },
    select: { receivedAt: true, purchaseOrder: { select: { supplierId: true, sentAt: true } } },
  });

  const bySupplier = new Map();
  for (const g of grns) {
    const po = g.purchaseOrder;
    if (!po || !po.sentAt || !po.supplierId) continue;
    const leadDays = (new Date(g.receivedAt).getTime() - new Date(po.sentAt).getTime()) / 86400000;
    if (leadDays < 0 || leadDays > 365) continue;
    let b = bySupplier.get(po.supplierId);
    if (!b) { b = { recent: [], baseline: [] }; bySupplier.set(po.supplierId, b); }
    if (new Date(g.receivedAt) >= cutoffRecent) b.recent.push(leadDays); else b.baseline.push(leadDays);
  }

  const suppliers = bySupplier.size === 0 ? [] : await prisma.supplier.findMany({
    where: { id: { in: [...bySupplier.keys()] } },
    select: { id: true, code: true, name: true, leadTimeDays: true },
  });
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));

  const mean = (arr) => (arr.length ? arr.reduce((a, x) => a + x, 0) / arr.length : null);
  const std = (arr, m) => (arr.length && m != null ? Math.sqrt(arr.reduce((a, x) => a + (x - m) ** 2, 0) / arr.length) : null);

  const rows = [];
  for (const [supplierId, b] of bySupplier) {
    const s = supplierById.get(supplierId);
    if (!s) continue;
    const recentMean = mean(b.recent);
    const baselineMean = mean(b.baseline);
    const baselineStd = std(b.baseline, baselineMean);
    rows.push({
      supplierId,
      supplierCode: s.code,
      supplierName: s.name,
      contractedLeadTimeDays: s.leadTimeDays,
      recent30dMeanDays: recentMean == null ? null : Number(recentMean.toFixed(2)),
      recent30dCount: b.recent.length,
      baselineMeanDays: baselineMean == null ? null : Number(baselineMean.toFixed(2)),
      baselineStdDays: baselineStd == null ? null : Number(baselineStd.toFixed(2)),
      baselineCount: b.baseline.length,
      driftDays: (recentMean != null && baselineMean != null) ? Number((recentMean - baselineMean).toFixed(2)) : null,
    });
  }
  rows.sort((a, b) => (b.driftDays ?? -Infinity) - (a.driftDays ?? -Infinity));
  res.json({ days, rows });
});

module.exports = { apAging, supplierScorecards, salesFulfillment, demandAnomalies, marginErosion, leadTimeDrift };
