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

module.exports = { apAging, supplierScorecards, salesFulfillment };
