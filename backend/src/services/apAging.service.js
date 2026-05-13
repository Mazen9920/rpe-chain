/**
 * AP Aging service — Section 5.
 * Aging is always computed on read; ApLedgerEntry.agingBucket snapshots are advisory only.
 */
const prisma = require('../lib/prisma');

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

async function openInvoices(supplierId, asOf) {
  const where = { status: { in: ['APPROVED', 'PARTIALLY_PAID'] } };
  if (supplierId) where.supplierId = supplierId;
  const invoices = await prisma.supplierInvoice.findMany({
    where,
    include: { supplier: { select: { id: true, name: true, code: true, currency: true } } },
    orderBy: { dueDate: 'asc' },
  });
  return invoices.map((i) => {
    const balance = dec(i.amount) - dec(i.paidAmount);
    const bucket = bucketFor(i.dueDate, asOf);
    const daysOverdue = Math.max(0, Math.floor((new Date(asOf).getTime() - new Date(i.dueDate).getTime()) / 86400000));
    return { ...i, openBalance: balance, agingBucket: bucket, daysOverdue };
  });
}

async function aging({ supplierId, asOf } = {}) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const rows = await openInvoices(supplierId, asOfDate);
  return { asOf: asOfDate, rows };
}

async function agingSummary({ supplierId, asOf } = {}) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const rows = await openInvoices(supplierId, asOfDate);
  const bySupplier = new Map();
  const totals = { CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0, total: 0 };
  for (const r of rows) {
    if (!bySupplier.has(r.supplierId)) {
      bySupplier.set(r.supplierId, {
        supplierId: r.supplierId,
        supplierName: r.supplier.name,
        supplierCode: r.supplier.code,
        CURRENT: 0, '1_30': 0, '31_60': 0, '61_90': 0, OVER_90: 0, total: 0,
      });
    }
    const row = bySupplier.get(r.supplierId);
    row[r.agingBucket] += r.openBalance;
    row.total += r.openBalance;
    totals[r.agingBucket] += r.openBalance;
    totals.total += r.openBalance;
  }
  return {
    asOf: asOfDate,
    buckets: BUCKETS,
    suppliers: Array.from(bySupplier.values()).sort((a, b) => b.total - a.total),
    totals,
  };
}

async function supplierStatement(supplierId, asOf) {
  const asOfDate = asOf ? new Date(asOf) : new Date();
  const [supplier, ledger, open] = await Promise.all([
    prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true, code: true, currency: true, paymentTerms: true } }),
    prisma.apLedgerEntry.findMany({
      where: { supplierId, createdAt: { lte: asOfDate } },
      include: {
        invoice: { select: { id: true, invoiceNumber: true } },
        payment: { select: { id: true, reference: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    openInvoices(supplierId, asOfDate),
  ]);
  if (!supplier) {
    const err = new Error('Supplier not found');
    err.status = 404;
    throw err;
  }
  const outstanding = open.reduce((s, r) => s + r.openBalance, 0);
  return { asOf: asOfDate, supplier, ledger, openInvoices: open, outstanding };
}

module.exports = { aging, agingSummary, supplierStatement, bucketFor, BUCKETS };
