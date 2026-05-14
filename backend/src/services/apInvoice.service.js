/**
 * Supplier Invoice service — Section 5.
 * Lifecycle: DRAFT → RECEIVED → MATCHED|EXCEPTION → APPROVED → PARTIALLY_PAID → PAID. VOID terminal.
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');
const threeWayMatch = require('./threeWayMatch.service');

const STATUSES = ['DRAFT', 'RECEIVED', 'MATCHED', 'EXCEPTION', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'VOID'];

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function assertTransition(current, next) {
  const ok = {
    DRAFT: ['RECEIVED', 'VOID'],
    RECEIVED: ['MATCHED', 'EXCEPTION', 'VOID'],
    MATCHED: ['APPROVED', 'RECEIVED', 'VOID'],
    EXCEPTION: ['APPROVED', 'RECEIVED', 'VOID'],
    APPROVED: ['PARTIALLY_PAID', 'PAID', 'VOID'],
    PARTIALLY_PAID: ['PAID', 'APPROVED', 'VOID'],
    PAID: ['PARTIALLY_PAID', 'APPROVED'], // reachable by voiding a payment
    VOID: [],
  };
  if (!ok[current] || !ok[current].includes(next)) {
    bad(`Cannot transition invoice from ${current} to ${next}`, 409, 'BAD_STATUS_TRANSITION');
  }
}

function daysToTerms(paymentTerms) {
  if (!paymentTerms) return 30;
  const m = /^NET(\d+)$/i.exec(paymentTerms.trim());
  return m ? parseInt(m[1], 10) : 30;
}

function dec(n) { return Number(n ?? 0); }

const INVOICE_INCLUDE = {
  supplier: { select: { id: true, name: true, code: true, currency: true, paymentTerms: true } },
  purchaseOrder: { select: { id: true, poNumber: true, status: true, currency: true, totalAmount: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  creditedInvoice: { select: { id: true, invoiceNumber: true } },
  creditNotes: { select: { id: true, invoiceNumber: true, amount: true, status: true, invoiceDate: true } },
  lines: {
    include: {
      poLine: { include: { product: { select: { id: true, sku: true, name: true, uom: true } } } },
      grnLine: { include: { lot: { select: { id: true, lotNumber: true } } } },
    },
  },
  paymentApplications: {
    include: { payment: { select: { id: true, paymentDate: true, method: true, status: true, reference: true } } },
    orderBy: { createdAt: 'asc' },
  },
};

// ─── Reads ────────────────────────────────────────────────────────────────────

async function listInvoices(filters = {}) {
  const where = {};
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.status) where.status = filters.status;
  if (filters.poId) where.purchaseOrderId = filters.poId;
  if (filters.dueBefore) where.dueDate = { lte: new Date(filters.dueBefore) };
  if (filters.invoiceType) where.invoiceType = filters.invoiceType;
  if (filters.q) where.invoiceNumber = { contains: filters.q, mode: 'insensitive' };

  const take = Math.min(parseInt(filters.limit ?? '50', 10), 200);
  const skip = Math.max(parseInt(filters.offset ?? '0', 10), 0);

  const [rows, total] = await Promise.all([
    prisma.supplierInvoice.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        purchaseOrder: { select: { id: true, poNumber: true } },
        _count: { select: { lines: true, paymentApplications: true } },
      },
      orderBy: { invoiceDate: 'desc' },
      take,
      skip,
    }),
    prisma.supplierInvoice.count({ where }),
  ]);
  return { rows, total };
}

async function getInvoiceById(id) {
  const invoice = await prisma.supplierInvoice.findUnique({
    where: { id },
    include: INVOICE_INCLUDE,
  });
  if (!invoice) bad('Invoice not found', 404);
  return invoice;
}

async function getKpis() {
  const groups = await prisma.supplierInvoice.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { amount: true, paidAmount: true },
  });
  const result = { total: 0, byStatus: {}, openLiability: 0, exceptionCount: 0 };
  for (const g of groups) {
    result.total += g._count._all;
    result.byStatus[g.status] = {
      count: g._count._all,
      amount: dec(g._sum.amount),
      paid: dec(g._sum.paidAmount),
    };
    if (g.status === 'EXCEPTION') result.exceptionCount = g._count._all;
    if (['APPROVED', 'PARTIALLY_PAID'].includes(g.status)) {
      result.openLiability += dec(g._sum.amount) - dec(g._sum.paidAmount);
    }
  }
  return result;
}

// ─── Writes ───────────────────────────────────────────────────────────────────

async function createInvoice(data, actor, sourceIp) {
  const {
    supplierId, purchaseOrderId, invoiceNumber, invoiceDate, dueDate,
    currency, fxRate, invoiceType = 'STANDARD', taxAmount = 0,
    notes, attachmentUrl, creditedInvoiceId, lines = [],
  } = data;

  if (!supplierId) bad('supplierId required');
  if (!invoiceNumber) bad('invoiceNumber required');
  if (!invoiceDate) bad('invoiceDate required');
  if (!Array.isArray(lines) || lines.length === 0) bad('At least one invoice line required');

  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId } });
  if (!supplier || supplier.deletedAt) bad('Supplier not found', 404);
  if (purchaseOrderId) {
    const po = await prisma.purchaseOrder.findUnique({ where: { id: purchaseOrderId }, select: { id: true, supplierId: true } });
    if (!po) bad('Purchase order not found', 404);
    if (po.supplierId !== supplierId) bad('PO does not belong to supplier', 400);
  }
  if (creditedInvoiceId) {
    const credited = await prisma.supplierInvoice.findUnique({ where: { id: creditedInvoiceId }, select: { id: true, supplierId: true } });
    if (!credited) bad('Credited invoice not found', 404);
    if (credited.supplierId !== supplierId) bad('Credited invoice does not belong to supplier', 400);
  }

  const dup = await prisma.supplierInvoice.findUnique({ where: { supplierId_invoiceNumber: { supplierId, invoiceNumber } } });
  if (dup) bad('Duplicate invoice number for supplier', 409, 'DUPLICATE_INVOICE');

  const subtotal = lines.reduce((s, l) => s + dec(l.quantity) * dec(l.unitPrice), 0);
  const total = subtotal + dec(taxAmount);
  const sign = invoiceType === 'CREDIT_NOTE' ? -1 : 1;

  const effectiveDueDate = dueDate
    ? new Date(dueDate)
    : new Date(new Date(invoiceDate).getTime() + daysToTerms(supplier.paymentTerms) * 86400000);

  const created = await prisma.$transaction(async (tx) => {
    const inv = await tx.supplierInvoice.create({
      data: {
        supplierId,
        purchaseOrderId: purchaseOrderId || null,
        invoiceNumber,
        invoiceType,
        invoiceDate: new Date(invoiceDate),
        dueDate: effectiveDueDate,
        subtotal: sign * subtotal,
        taxAmount: sign * dec(taxAmount),
        amount: sign * total,
        currency: (() => {
          const c = currency || supplier.currency;
          if (!c) bad('currency required (no supplier default)', 400, 'CURRENCY_REQUIRED');
          return String(c).toUpperCase();
        })(),
        fxRate: fxRate ?? null,
        status: 'DRAFT',
        notes: notes || null,
        attachmentUrl: attachmentUrl || null,
        creditedInvoiceId: creditedInvoiceId || null,
        createdById: actor?.id || null,
        lines: {
          create: lines.map((l) => ({
            poLineId: l.poLineId || null,
            grnLineId: l.grnLineId || null,
            description: l.description || '',
            quantity: sign * dec(l.quantity),
            unitPrice: dec(l.unitPrice),
            lineTotal: sign * dec(l.quantity) * dec(l.unitPrice),
            matchStatus: 'PENDING',
          })),
        },
      },
      include: INVOICE_INCLUDE,
    });
    await logEvent({
      eventType: invoiceType === 'CREDIT_NOTE' ? 'CREDIT_NOTE_CREATED' : 'INVOICE_CREATED',
      entityType: 'SupplierInvoice',
      entityId: inv.id,
      actorId: actor?.id,
      payload: { invoiceNumber, supplierId, amount: dec(inv.amount), invoiceType },
      sourceIp,
    }, tx);
    return inv;
  });

  return created;
}

async function submitForMatching(id, actor, sourceIp) {
  const invoice = await prisma.supplierInvoice.findUnique({ where: { id }, select: { id: true, status: true, invoiceType: true } });
  if (!invoice) bad('Invoice not found', 404);
  if (invoice.invoiceType === 'CREDIT_NOTE') bad('Credit notes do not require matching', 400);
  assertTransition(invoice.status, 'RECEIVED');

  const result = await prisma.$transaction(async (tx) => {
    await tx.supplierInvoice.update({ where: { id }, data: { status: 'RECEIVED', receivedAt: new Date() } });
    const matched = await threeWayMatch.match(id, tx);
    await logEvent({
      eventType: matched.status === 'MATCHED' ? 'INVOICE_MATCHED' : 'INVOICE_EXCEPTION',
      entityType: 'SupplierInvoice',
      entityId: id,
      actorId: actor?.id,
      payload: { lineStatuses: matched.lineStatuses, variance: matched.varianceAmount },
      sourceIp,
    }, tx);
    return matched;
  });
  return getInvoiceById(id);
}

async function rematch(id, actor, sourceIp) {
  const invoice = await prisma.supplierInvoice.findUnique({ where: { id }, select: { id: true, status: true } });
  if (!invoice) bad('Invoice not found', 404);
  if (!['RECEIVED', 'MATCHED', 'EXCEPTION'].includes(invoice.status)) {
    bad(`Cannot rematch from status ${invoice.status}`, 409, 'INVALID_STATUS');
  }
  await prisma.$transaction(async (tx) => {
    const matched = await threeWayMatch.match(id, tx);
    await logEvent({
      eventType: matched.status === 'MATCHED' ? 'INVOICE_MATCHED' : 'INVOICE_EXCEPTION',
      entityType: 'SupplierInvoice',
      entityId: id,
      actorId: actor?.id,
      payload: { rematch: true, variance: matched.varianceAmount },
      sourceIp,
    }, tx);
  });
  return getInvoiceById(id);
}

async function approveInvoice(id, { overrideReason } = {}, actor, sourceIp) {
  const invoice = await prisma.supplierInvoice.findUnique({ where: { id } });
  if (!invoice) bad('Invoice not found', 404);
  assertTransition(invoice.status, 'APPROVED');
  if (invoice.status === 'EXCEPTION' && !overrideReason) {
    bad('Approving an EXCEPTION invoice requires an overrideReason', 409, 'OVER_TOLERANCE_NO_OVERRIDE');
  }

  const approved = await prisma.$transaction(async (tx) => {
    const upd = await tx.supplierInvoice.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedById: actor?.id || null,
        holdReason: overrideReason || invoice.holdReason || null,
      },
    });
    // Post AP ledger entry (positive = liability for STANDARD; negative for CREDIT_NOTE).
    const balance = await currentBalance(tx, invoice.supplierId);
    await tx.apLedgerEntry.create({
      data: {
        supplierId: invoice.supplierId,
        invoiceId: id,
        entryType: invoice.invoiceType === 'CREDIT_NOTE' ? 'CREDIT_NOTE' : 'INVOICE_POSTED',
        amount: invoice.amount,
        balance: Number(balance) + Number(invoice.amount),
        dueDate: invoice.dueDate,
        agingBucket: agingBucketFor(invoice.dueDate, new Date()),
        description: `Invoice ${invoice.invoiceNumber} approved`,
      },
    });
    await logEvent({
      eventType: 'INVOICE_APPROVED',
      entityType: 'SupplierInvoice',
      entityId: id,
      actorId: actor?.id,
      payload: { amount: dec(invoice.amount), overrideReason: overrideReason || null },
      sourceIp,
    }, tx);
    return upd;
  });
  return getInvoiceById(approved.id);
}

async function voidInvoice(id, { reason } = {}, actor, sourceIp) {
  if (!reason) bad('voidReason required', 400);
  const invoice = await prisma.supplierInvoice.findUnique({ where: { id } });
  if (!invoice) bad('Invoice not found', 404);
  if (invoice.status === 'VOID') bad('Already void', 409, 'INVALID_STATUS');
  if (Number(invoice.paidAmount) > 0) bad('Cannot void an invoice with applied payments — void payments first', 409, 'INVOICE_HAS_PAYMENTS');

  await prisma.$transaction(async (tx) => {
    await tx.supplierInvoice.update({
      where: { id },
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidedById: actor?.id || null,
        voidReason: reason,
      },
    });
    // Reverse ledger if it was posted (APPROVED+).
    if (['APPROVED', 'PARTIALLY_PAID', 'PAID'].includes(invoice.status)) {
      const balance = await currentBalance(tx, invoice.supplierId);
      await tx.apLedgerEntry.create({
        data: {
          supplierId: invoice.supplierId,
          invoiceId: id,
          entryType: 'INVOICE_VOIDED',
          amount: Number(invoice.amount) * -1,
          balance: Number(balance) - Number(invoice.amount),
          description: `Invoice ${invoice.invoiceNumber} voided: ${reason}`,
        },
      });
    }
    await logEvent({
      eventType: 'INVOICE_VOIDED',
      entityType: 'SupplierInvoice',
      entityId: id,
      actorId: actor?.id,
      payload: { reason, priorStatus: invoice.status },
      sourceIp,
    }, tx);
  });
  return getInvoiceById(id);
}

// ─── Helpers (used by payment.service too) ───────────────────────────────────

async function currentBalance(tx, supplierId) {
  const agg = await tx.apLedgerEntry.aggregate({
    where: { supplierId },
    _sum: { amount: true },
  });
  return Number(agg._sum.amount ?? 0);
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

module.exports = {
  listInvoices,
  getInvoiceById,
  getKpis,
  createInvoice,
  submitForMatching,
  rematch,
  approveInvoice,
  voidInvoice,
  currentBalance,
  agingBucketFor,
  STATUSES,
};
