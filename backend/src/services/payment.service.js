/**
 * Payment service — Section 5.
 * Records supplier payments with explicit invoice applications; supports partial + multi-invoice payments.
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');
const apInvoice = require('./apInvoice.service');

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function dec(n) { return Number(n ?? 0); }

const PAYMENT_INCLUDE = {
  supplier: { select: { id: true, name: true, code: true, currency: true } },
  createdBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
  applications: {
    include: {
      invoice: { select: { id: true, invoiceNumber: true, amount: true, paidAmount: true, status: true, currency: true, dueDate: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
};

async function listPayments(filters = {}) {
  const where = {};
  if (filters.supplierId) where.supplierId = filters.supplierId;
  if (filters.method) where.method = filters.method;
  if (filters.status) where.status = filters.status;
  if (filters.fromDate || filters.toDate) {
    where.paymentDate = {};
    if (filters.fromDate) where.paymentDate.gte = new Date(filters.fromDate);
    if (filters.toDate) where.paymentDate.lte = new Date(filters.toDate);
  }
  const take = Math.min(parseInt(filters.limit ?? '50', 10), 200);
  const skip = Math.max(parseInt(filters.offset ?? '0', 10), 0);
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        _count: { select: { applications: true } },
      },
      orderBy: { paymentDate: 'desc' },
      take,
      skip,
    }),
    prisma.payment.count({ where }),
  ]);
  return { rows, total };
}

async function getPaymentById(id) {
  const payment = await prisma.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
  if (!payment) bad('Payment not found', 404);
  return payment;
}

async function recordPayment(data, actor, sourceIp) {
  const {
    supplierId, amount, currency, fxRate, paymentDate, method, reference, notes,
    applications = [],
  } = data;

  if (!supplierId) bad('supplierId required');
  if (!amount || dec(amount) <= 0) bad('amount must be positive');
  if (!method) bad('method required');
  if (!Array.isArray(applications) || applications.length === 0) bad('At least one application required');

  const totalApplied = applications.reduce((s, a) => s + dec(a.amountApplied), 0);
  if (totalApplied > dec(amount) + 0.001) bad('Sum of applications exceeds payment amount', 400, 'OVER_APPLICATION');

  // Pre-load all referenced invoices in one query.
  const invoiceIds = applications.map((a) => a.invoiceId);
  const invoices = await prisma.supplierInvoice.findMany({ where: { id: { in: invoiceIds } } });
  const map = new Map(invoices.map((i) => [i.id, i]));
  for (const app of applications) {
    const inv = map.get(app.invoiceId);
    if (!inv) bad(`Invoice ${app.invoiceId} not found`, 404);
    if (inv.supplierId !== supplierId) bad(`Invoice ${inv.invoiceNumber} does not belong to supplier`, 400);
    if (!['APPROVED', 'PARTIALLY_PAID'].includes(inv.status)) {
      bad(`Invoice ${inv.invoiceNumber} is not payable (status ${inv.status})`, 409, 'INVALID_STATUS');
    }
    const remaining = dec(inv.amount) - dec(inv.paidAmount);
    if (dec(app.amountApplied) > remaining + 0.001) {
      bad(`Application ${dec(app.amountApplied)} exceeds invoice ${inv.invoiceNumber} balance ${remaining}`, 409, 'OVER_APPLICATION');
    }
    if (dec(app.amountApplied) <= 0) bad('amountApplied must be positive');
  }

  const created = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        supplierId,
        amount: dec(amount),
        currency: currency || invoices[0]?.currency || 'USD',
        fxRate: fxRate ?? null,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        method,
        status: 'POSTED',
        reference: reference || null,
        notes: notes || null,
        createdById: actor?.id || null,
        applications: {
          create: applications.map((a) => ({
            invoiceId: a.invoiceId,
            amountApplied: dec(a.amountApplied),
          })),
        },
      },
      include: PAYMENT_INCLUDE,
    });

    // Apply to each invoice + post ledger entries.
    for (const app of applications) {
      const inv = map.get(app.invoiceId);
      const newPaid = dec(inv.paidAmount) + dec(app.amountApplied);
      const newStatus = newPaid + 0.001 >= dec(inv.amount) ? 'PAID' : 'PARTIALLY_PAID';
      await tx.supplierInvoice.update({
        where: { id: inv.id },
        data: {
          paidAmount: newPaid,
          status: newStatus,
          paidAt: newStatus === 'PAID' ? new Date() : null,
        },
      });
      const balance = await apInvoice.currentBalance(tx, supplierId);
      await tx.apLedgerEntry.create({
        data: {
          supplierId,
          invoiceId: inv.id,
          paymentId: payment.id,
          entryType: 'PAYMENT_APPLIED',
          amount: -dec(app.amountApplied),
          balance: balance - dec(app.amountApplied),
          description: `Payment ${payment.id.slice(0, 8)} applied to ${inv.invoiceNumber}`,
        },
      });
    }

    await logEvent({
      eventType: 'PAYMENT_RECORDED',
      entityType: 'Payment',
      entityId: payment.id,
      actorId: actor?.id,
      payload: { supplierId, amount: dec(amount), applications: applications.map((a) => ({ invoiceId: a.invoiceId, amountApplied: dec(a.amountApplied) })) },
      sourceIp,
    }, tx);
    return payment;
  });

  return getPaymentById(created.id);
}

async function voidPayment(id, { reason } = {}, actor, sourceIp) {
  if (!reason) bad('voidReason required');
  const payment = await prisma.payment.findUnique({
    where: { id },
    include: { applications: { include: { invoice: true } } },
  });
  if (!payment) bad('Payment not found', 404);
  if (payment.status === 'VOIDED') bad('Already voided', 409, 'INVALID_STATUS');

  // Block if any later payment touched the same invoices (no partial reversals).
  for (const app of payment.applications) {
    const later = await prisma.paymentApplication.findFirst({
      where: {
        invoiceId: app.invoiceId,
        payment: { paymentDate: { gt: payment.paymentDate }, status: 'POSTED' },
      },
    });
    if (later) bad(`Cannot void: invoice ${app.invoice.invoiceNumber} has a later payment`, 409, 'PAYMENT_LOCKED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id },
      data: { status: 'VOIDED', voidedAt: new Date(), voidedById: actor?.id || null, voidReason: reason },
    });
    for (const app of payment.applications) {
      const inv = app.invoice;
      const newPaid = Number(inv.paidAmount) - Number(app.amountApplied);
      let newStatus = 'APPROVED';
      if (newPaid > 0.001) newStatus = 'PARTIALLY_PAID';
      await tx.supplierInvoice.update({
        where: { id: inv.id },
        data: {
          paidAmount: newPaid,
          status: newStatus,
          paidAt: null,
        },
      });
      const balance = await apInvoice.currentBalance(tx, payment.supplierId);
      await tx.apLedgerEntry.create({
        data: {
          supplierId: payment.supplierId,
          invoiceId: inv.id,
          paymentId: payment.id,
          entryType: 'PAYMENT_VOIDED',
          amount: Number(app.amountApplied),
          balance: balance + Number(app.amountApplied),
          description: `Payment ${payment.id.slice(0, 8)} voided (reverses ${inv.invoiceNumber}): ${reason}`,
        },
      });
    }
    await logEvent({
      eventType: 'PAYMENT_VOIDED',
      entityType: 'Payment',
      entityId: id,
      actorId: actor?.id,
      payload: { reason, supplierId: payment.supplierId, amount: Number(payment.amount) },
      sourceIp,
    }, tx);
  });
  return getPaymentById(id);
}

module.exports = { listPayments, getPaymentById, recordPayment, voidPayment };
