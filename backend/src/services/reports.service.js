// Tier 4 #15 — Custom reports v1.5.0
//
// Each builder returns a normalized envelope:
//   { title, columns: [{key,label,format?}], rows: [{...}], summary?: {...} }
// Builders are stateless and re-callable so they can power both interactive
// HTTP responses (controller) and scheduled exports (scheduler dispatch).

const prisma = require('../lib/prisma');

function bucketize(daysOverdue) {
  if (daysOverdue <= 0) return 'CURRENT';
  if (daysOverdue <= 30) return '1-30';
  if (daysOverdue <= 60) return '31-60';
  if (daysOverdue <= 90) return '61-90';
  return '90+';
}

async function buildApAging({ supplierId } = {}) {
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
  return {
    title: 'AP Aging',
    columns: [
      { key: 'supplierCode', label: 'Supplier Code' },
      { key: 'supplierName', label: 'Supplier Name' },
      { key: 'invoiceNumber', label: 'Invoice #' },
      { key: 'invoiceDate', label: 'Invoice Date', format: 'date' },
      { key: 'dueDate', label: 'Due Date', format: 'date' },
      { key: 'daysOverdue', label: 'Days Overdue' },
      { key: 'bucket', label: 'Bucket' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'paidAmount', label: 'Paid', format: 'money' },
      { key: 'outstanding', label: 'Outstanding', format: 'money' },
      { key: 'currency', label: 'Currency' },
      { key: 'status', label: 'Status' },
    ],
    rows,
    summary: {
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Number(v.toFixed(2))])),
      invoiceCount: rows.length,
    },
  };
}

async function buildArAging({ customerId } = {}) {
  const now = new Date();
  const where = { status: { in: ['POSTED', 'PARTIALLY_PAID'] } };
  if (customerId) where.customerId = customerId;
  const invoices = await prisma.customerInvoice.findMany({
    where,
    include: { customer: { select: { code: true, name: true } } },
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
      customerCode: inv.customer?.code || '',
      customerName: inv.customer?.name || '',
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
  return {
    title: 'AR Aging',
    columns: [
      { key: 'customerCode', label: 'Customer Code' },
      { key: 'customerName', label: 'Customer Name' },
      { key: 'invoiceNumber', label: 'Invoice #' },
      { key: 'invoiceDate', label: 'Invoice Date', format: 'date' },
      { key: 'dueDate', label: 'Due Date', format: 'date' },
      { key: 'daysOverdue', label: 'Days Overdue' },
      { key: 'bucket', label: 'Bucket' },
      { key: 'amount', label: 'Amount', format: 'money' },
      { key: 'paidAmount', label: 'Paid', format: 'money' },
      { key: 'outstanding', label: 'Outstanding', format: 'money' },
      { key: 'currency', label: 'Currency' },
      { key: 'status', label: 'Status' },
    ],
    rows,
    summary: {
      totalOutstanding: Number(totalOutstanding.toFixed(2)),
      buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Number(v.toFixed(2))])),
      invoiceCount: rows.length,
    },
  };
}

async function buildSupplierScorecards() {
  const suppliers = await prisma.supplier.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, name: true },
  });
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
  rows.sort((a, b) => (b.overallScore ?? -Infinity) - (a.overallScore ?? -Infinity));
  return {
    title: 'Supplier Scorecards',
    columns: [
      { key: 'supplierCode', label: 'Supplier Code' },
      { key: 'supplierName', label: 'Supplier Name' },
      { key: 'periodStart', label: 'Period Start', format: 'date' },
      { key: 'periodEnd', label: 'Period End', format: 'date' },
      { key: 'onTimeRate', label: 'On-Time %', format: 'pct' },
      { key: 'fillRate', label: 'Fill Rate %', format: 'pct' },
      { key: 'defectRate', label: 'Defect Rate %', format: 'pct' },
      { key: 'leadTimeMean', label: 'Lead Time Mean (d)' },
      { key: 'leadTimeStd', label: 'Lead Time Std (d)' },
      { key: 'overallScore', label: 'Overall Score' },
      { key: 'source', label: 'Source' },
    ],
    rows,
    summary: { total: rows.length, withData: rows.filter((r) => r.hasData).length },
  };
}

async function buildSalesFulfillment({ from, to } = {}) {
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
  const avgCycleHours = leadTimesHours.length
    ? leadTimesHours.reduce((a, b) => a + b, 0) / leadTimesHours.length
    : null;
  return {
    title: 'Sales Fulfillment',
    columns: [
      { key: 'orderNumber', label: 'Order #' },
      { key: 'orderedAt', label: 'Ordered At', format: 'datetime' },
      { key: 'status', label: 'Status' },
      { key: 'customerCode', label: 'Customer Code' },
      { key: 'customerName', label: 'Customer Name' },
      { key: 'qtyOrdered', label: 'Qty Ordered' },
      { key: 'qtyShipped', label: 'Qty Shipped' },
      { key: 'fillRate', label: 'Fill Rate', format: 'pct' },
      { key: 'revenue', label: 'Revenue', format: 'money' },
      { key: 'currency', label: 'Currency' },
      { key: 'cycleHours', label: 'Cycle Hours' },
      { key: 'deliveredAt', label: 'Delivered At', format: 'datetime' },
    ],
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
  };
}

// Registry of available report keys. Custom report definitions reference these
// keys; renderer dispatches via this map.
const BUILDERS = {
  'ap-aging': buildApAging,
  'ar-aging': buildArAging,
  'supplier-scorecards': buildSupplierScorecards,
  'sales-fulfillment': buildSalesFulfillment,
};

function listReportKeys() {
  return Object.keys(BUILDERS);
}

async function buildReport(reportKey, params = {}) {
  const builder = BUILDERS[reportKey];
  if (!builder) {
    const err = new Error(`Unknown reportKey: ${reportKey}`);
    err.status = 400;
    err.code = 'REPORT_KEY_INVALID';
    throw err;
  }
  return builder(params || {});
}

module.exports = {
  BUILDERS,
  buildReport,
  buildApAging,
  buildArAging,
  buildSupplierScorecards,
  buildSalesFulfillment,
  listReportKeys,
};
