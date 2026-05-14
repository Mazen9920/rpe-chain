/**
 * AR Aging service — Tier 4 #14. Mirrors apAging.service.
 */
const prisma = require('../lib/prisma');
const fx = require('./fx.service');

const BUCKETS = ['CURRENT', '1_30', '31_60', '61_90', 'OVER_90'];

function bucketFor(dueDate, asOf) {
  if (!dueDate) return 'CURRENT';
  const ms = new Date(asOf).getTime() - new Date(dueDate).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'OVER_90';
}

function dec(n) { return Number(n ?? 0); }

async function openInvoices(customerId, asOf) {
  const where = { status: { in: ['POSTED', 'PARTIALLY_PAID'] } };
  if (customerId) where.customerId = customerId;
  const invoices = await prisma.customerInvoice.findMany({
    where,
    include: { customer: { select: { id: true, name: true, code: true, currency: true } } },
    orderBy: { dueDate: 'asc' },
  });
  return invoices.map((i) => {
    const balance = dec(i.amount) - dec(i.paidAmount);
    const bucket = bucketFor(i.dueDate, asOf);
    const daysOverdue = Math.max(0, Math.floor((new Date(asOf).getTime() - new Date(i.dueDate).getTime()) / 86400000));
    return { ...i, openBalance: balance, agingBucket: bucket, daysOverdue, currency: i.currency || 'USD' };
  });
}

async function aging({ customerId, asOf } = {}) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const rows = await openInvoices(customerId, asOfDate);
  return { asOf: asOfDate, rows };
}

async function agingSummary({ customerId, asOf, reportingCurrency } = {}) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const repCcy = String(reportingCurrency || 'USD').toUpperCase();
  const rows = await openInvoices(customerId, asOfDate);
  const byCustomer = new Map();
  const byCurrency = {};
  const totals = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0, total: 0 };
  for (const r of rows) {
    const ccy = (r.currency || 'USD').toUpperCase();
    let converted = r.openBalance;
    if (ccy !== repCcy) {
      try { converted = await fx.convert(r.openBalance, ccy, repCcy, asOfDate); }
      catch (_e) { /* keep raw if FX missing */ }
    }
    if (!byCustomer.has(r.customerId)) {
      byCustomer.set(r.customerId, {
        customerId: r.customerId,
        customerName: r.customer.name,
        customerCode: r.customer.code,
        CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0, total: 0,
      });
    }
    const row = byCustomer.get(r.customerId);
    row[r.agingBucket] += converted;
    row.total += converted;
    totals[r.agingBucket] += converted;
    totals.total += converted;
    if (!byCurrency[ccy]) byCurrency[ccy] = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0, total: 0 };
    byCurrency[ccy][r.agingBucket] += r.openBalance;
    byCurrency[ccy].total += r.openBalance;
  }
  return {
    asOf: asOfDate,
    reportingCurrency: repCcy,
    buckets: BUCKETS,
    customers: Array.from(byCustomer.values()).sort((a, b) => b.total - a.total),
    totals,
    byCurrency,
  };
}

async function customerStatement(customerId, asOf) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const [customer, ledger, open] = await Promise.all([
    prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, code: true, currency: true, paymentTerms: true, creditLimit: true } }),
    prisma.arLedgerEntry.findMany({
      where: { customerId, createdAt: { lte: asOfDate } },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        payment: { select: { id: true, reference: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    openInvoices(customerId, asOfDate),
  ]);
  if (!customer) {
    const err = new Error('Customer not found');
    err.status = 404;
    throw err;
  }
  const outstanding = open.reduce((s, r) => s + r.openBalance, 0);
  return { asOf: asOfDate, customer, ledger, openInvoices: open, outstanding };
}

module.exports = { aging, agingSummary, customerStatement, bucketFor, BUCKETS };
