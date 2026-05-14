/**
 * AR Customer Invoice service — Tier 4 #14.
 * Lifecycle: DRAFT → POSTED → PARTIALLY_PAID → PAID. VOID terminal. (No 3-way match.)
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const STATUSES = ['DRAFT', 'POSTED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function dec(n) { return Number(n ?? 0); }

function daysToTerms(paymentTerms) {
  if (!paymentTerms) return 30;
  const m = /^NET_?(\d+)$/i.exec(String(paymentTerms).trim());
  if (m) return parseInt(m[1], 10);
  if (/^COD$/i.test(paymentTerms) || /^PREPAID$/i.test(paymentTerms)) return 0;
  return 30;
}

function agingBucketFor(dueDate, asOf) {
  if (!dueDate) return 'CURRENT';
  const ms = new Date(asOf).getTime() - new Date(dueDate).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return 'CURRENT';
  if (days <= 30) return '1_30';
  if (days <= 60) return '31_60';
  if (days <= 90) return '61_90';
  return 'OVER_90';
}

const INVOICE_INCLUDE = {
  customer: { select: { id: true, name: true, code: true, currency: true, paymentTerms: true, creditLimit: true } },
  salesOrder: { select: { id: true, orderNumber: true, status: true } },
  shipment: { select: { id: true, shipmentNumber: true, status: true } },
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  creditedInvoice: { select: { id: true, invoiceNumber: true } },
  creditNotes: { select: { id: true, invoiceNumber: true, amount: true, status: true, invoiceDate: true } },
  lines: {
    include: { product: { select: { id: true, sku: true, name: true, uom: true } } },
  },
  paymentApplications: {
    include: { payment: { select: { id: true, paymentDate: true, method: true, status: true, reference: true } } },
    orderBy: { createdAt: 'asc' },
  },
};

// ─── Reads ────────────────────────────────────────────────────────────────────

async function listInvoices(filters = {}) {
  const where = {};
  if (filters.customerId) where.customerId = filters.customerId;
  if (filters.status) where.status = filters.status;
  if (filters.salesOrderId) where.salesOrderId = filters.salesOrderId;
  if (filters.shipmentId) where.shipmentId = filters.shipmentId;
  if (filters.invoiceType) where.invoiceType = filters.invoiceType;
  if (filters.dueBefore) where.dueDate = { lte: new Date(filters.dueBefore) };
  if (filters.dueAfter) where.dueDate = { ...(where.dueDate || {}), gte: new Date(filters.dueAfter) };
  if (filters.search) where.invoiceNumber = { contains: filters.search, mode: 'insensitive' };

  const take = Math.min(parseInt(filters.limit ?? '50', 10), 200);
  const skip = Math.max(parseInt(filters.offset ?? '0', 10), 0);

  const [rows, total] = await Promise.all([
    prisma.customerInvoice.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true, code: true } },
        salesOrder: { select: { id: true, orderNumber: true } },
        _count: { select: { lines: true, paymentApplications: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      take,
      skip,
    }),
    prisma.customerInvoice.count({ where }),
  ]);
  return { rows, total };
}

async function getInvoiceById(id) {
  const invoice = await prisma.customerInvoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
  if (!invoice) bad('Invoice not found', 404);
  return invoice;
}

async function getKpis() {
  const groups = await prisma.customerInvoice.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { amount: true, paidAmount: true },
  });
  const result = { total: 0, byStatus: {}, openReceivable: 0 };
  for (const g of groups) {
    result.total += g._count._all;
    result.byStatus[g.status] = {
      count: g._count._all,
      amount: dec(g._sum.amount),
      paid: dec(g._sum.paidAmount),
    };
    if (['POSTED', 'PARTIALLY_PAID'].includes(g.status)) {
      result.openReceivable += dec(g._sum.amount) - dec(g._sum.paidAmount);
    }
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function currentBalance(tx, customerId) {
  const agg = await tx.arLedgerEntry.aggregate({
    where: { customerId },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
}

async function nextInvoiceNumber(tx, customerId) {
  const now = new Date();
  const ym = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const prefix = `CIV-${ym}-`;
  const last = await tx.customerInvoice.findFirst({
    where: { customerId, invoiceNumber: { startsWith: prefix } },
    orderBy: { invoiceNumber: 'desc' },
    select: { invoiceNumber: true },
  });
  let n = 1;
  if (last) {
    const m = /-(\d+)$/.exec(last.invoiceNumber);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(n).padStart(4, '0')}`;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

async function createInvoice(data, actor, sourceIp) {
  const {
    customerId, salesOrderId, shipmentId, invoiceNumber, invoiceDate, dueDate,
    currency, fxRate, invoiceType = 'STANDARD', taxAmount = 0,
    notes, creditedInvoiceId, lines = [],
  } = data;

  if (!customerId) bad('customerId required');
  if (!invoiceDate) bad('invoiceDate required');
  if (!Array.isArray(lines) || lines.length === 0) bad('At least one invoice line required');

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.deletedAt) bad('Customer not found', 404);

  if (salesOrderId) {
    const so = await prisma.salesOrder.findUnique({ where: { id: salesOrderId }, select: { id: true, customerId: true } });
    if (!so) bad('Sales order not found', 404);
    if (so.customerId && so.customerId !== customerId) bad('SO does not belong to customer', 400);
  }
  if (shipmentId) {
    const sh = await prisma.shipment.findUnique({ where: { id: shipmentId }, select: { id: true, salesOrderId: true } });
    if (!sh) bad('Shipment not found', 404);
  }
  if (creditedInvoiceId) {
    const credited = await prisma.customerInvoice.findUnique({ where: { id: creditedInvoiceId }, select: { id: true, customerId: true } });
    if (!credited) bad('Credited invoice not found', 404);
    if (credited.customerId !== customerId) bad('Credited invoice does not belong to customer', 400);
  }

  const subtotal = lines.reduce((s, l) => s + dec(l.quantity) * dec(l.unitPrice), 0);
  const total = subtotal + dec(taxAmount);
  const sign = invoiceType === 'CREDIT_NOTE' ? -1 : 1;

  const effectiveDueDate = dueDate
    ? new Date(dueDate)
    : new Date(new Date(invoiceDate).getTime() + daysToTerms(customer.paymentTerms) * 86400000);

  const resolvedCurrency = (() => {
    const c = currency || customer.currency;
    if (!c) bad('currency required (no customer default)', 400, 'CURRENCY_REQUIRED');
    return String(c).toUpperCase();
  })();

  const created = await prisma.$transaction(async (tx) => {
    const finalInvoiceNumber = invoiceNumber || await nextInvoiceNumber(tx, customerId);
    const dup = await tx.customerInvoice.findUnique({ where: { customerId_invoiceNumber: { customerId, invoiceNumber: finalInvoiceNumber } } });
    if (dup) bad('Duplicate invoice number for customer', 409, 'DUPLICATE_INVOICE');

    const inv = await tx.customerInvoice.create({
      data: {
        customerId,
        salesOrderId: salesOrderId || null,
        shipmentId: shipmentId || null,
        invoiceNumber: finalInvoiceNumber,
        invoiceType,
        invoiceDate: new Date(invoiceDate),
        dueDate: effectiveDueDate,
        subtotal: sign * subtotal,
        taxAmount: sign * dec(taxAmount),
        amount: sign * total,
        currency: resolvedCurrency,
        fxRate: fxRate ?? null,
        status: 'POSTED',
        postedAt: new Date(),
        notes: notes || null,
        creditedInvoiceId: creditedInvoiceId || null,
        createdById: actor?.id || null,
        lines: {
          create: lines.map((l) => ({
            productId: l.productId || null,
            description: l.description || '',
            quantity: sign * dec(l.quantity),
            unitPrice: dec(l.unitPrice),
            lineTotal: sign * dec(l.quantity) * dec(l.unitPrice),
          })),
        },
      },
      include: INVOICE_INCLUDE,
    });

    // Post AR ledger entry on creation (AR posts directly — no separate APPROVE step).
    const balance = await currentBalance(tx, customerId);
    await tx.arLedgerEntry.create({
      data: {
        customerId,
        invoiceId: inv.id,
        entryType: invoiceType === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE_POSTED',
        amount: inv.amount,
        balance: balance + Number(inv.amount),
        dueDate: inv.dueDate,
        agingBucket: agingBucketFor(inv.dueDate, new Date()),
        description: `Invoice ${inv.invoiceNumber} posted`,
      },
    });

    await logEvent({
      eventType: invoiceType === 'CREDIT_NOTE' ? 'CUSTOMER_CREDIT_NOTE_CREATED' : 'CUSTOMER_INVOICE_CREATED',
      entityType: 'CustomerInvoice',
      entityId: inv.id,
      actorId: actor?.id,
      payload: { invoiceNumber: finalInvoiceNumber, customerId, amount: dec(inv.amount), invoiceType },
      sourceIp,
    }, tx);
    return inv;
  });

  return getInvoiceById(created.id);
}

async function voidInvoice(id, { reason } = {}, actor, sourceIp) {
  if (!reason) bad('voidReason required', 400);
  const invoice = await prisma.customerInvoice.findUnique({ where: { id } });
  if (!invoice) bad('Invoice not found', 404);
  if (invoice.status === 'VOID') bad('Already void', 409, 'INVALID_STATUS');
  if (Number(invoice.paidAmount) > 0) bad('Cannot void an invoice with applied payments — void payments first', 409, 'INVOICE_HAS_PAYMENTS');

  await prisma.$transaction(async (tx) => {
    await tx.customerInvoice.update({
      where: { id },
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidedById: actor?.id || null,
        voidReason: reason,
      },
    });
    // Reverse ledger.
    const balance = await currentBalance(tx, invoice.customerId);
    await tx.arLedgerEntry.create({
      data: {
        customerId: invoice.customerId,
        invoiceId: id,
        entryType: 'INVOICE_VOIDED',
        amount: Number(invoice.amount) * -1,
        balance: balance - Number(invoice.amount),
        description: `Invoice ${invoice.invoiceNumber} voided: ${reason}`,
      },
    });
    await logEvent({
      eventType: 'CUSTOMER_INVOICE_VOIDED',
      entityType: 'CustomerInvoice',
      entityId: id,
      actorId: actor?.id,
      payload: { reason, priorStatus: invoice.status },
      sourceIp,
    }, tx);
  });
  return getInvoiceById(id);
}

module.exports = {
  listInvoices,
  getInvoiceById,
  getKpis,
  createInvoice,
  voidInvoice,
  currentBalance,
  agingBucketFor,
  daysToTerms,
  nextInvoiceNumber,
  STATUSES,
};
