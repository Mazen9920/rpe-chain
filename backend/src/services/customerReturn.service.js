/**
 * Customer Return (RMA) service — v2.0.0.
 *
 * Lifecycle: REQUESTED → APPROVED → RECEIVED → REFUNDED.
 * Alt path: REQUESTED → REJECTED.
 *
 * RECEIVED creates IN stock movements (reasonCode RETURN) into the target warehouse.
 * REFUNDED creates a CREDIT_NOTE CustomerInvoice (via arInvoice.createInvoice) referencing
 * the original invoice. Idempotent: re-calling receive/refund/approve from a terminal
 * state throws INVALID_STATUS (409).
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');
const stock = require('./stock.service');
const arInvoice = require('./arInvoice.service');

const INCLUDE = {
  customer: { select: { id: true, code: true, name: true, currency: true } },
  customerInvoice: { select: { id: true, invoiceNumber: true, currency: true, amount: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  creditNote: { select: { id: true, invoiceNumber: true, amount: true } },
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
    },
  },
};

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function dec(v) {
  return typeof v === 'number' ? v : Number(v || 0);
}

async function nextReturnNumber(tx) {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const prefix = `RMA-${ym}-`;
  const last = await tx.customerReturn.findFirst({
    where: { returnNumber: { startsWith: prefix } },
    orderBy: { returnNumber: 'desc' },
    select: { returnNumber: true },
  });
  const next = last ? Number(last.returnNumber.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(next).padStart(4, '0')}`;
}

async function createReturn(data, actor, sourceIp) {
  const { customerInvoiceId, warehouseId, reason, notes, lines = [] } = data;
  if (!customerInvoiceId) bad('customerInvoiceId required');
  if (!warehouseId) bad('warehouseId required');
  if (!Array.isArray(lines) || lines.length === 0) bad('At least one return line required');

  const invoice = await prisma.customerInvoice.findUnique({
    where: { id: customerInvoiceId },
    include: { lines: true },
  });
  if (!invoice) bad('Customer invoice not found', 404);
  if (invoice.status === 'VOID') bad('Cannot return against a void invoice', 409, 'INVOICE_VOID');
  if (invoice.invoiceType === 'CREDIT_NOTE') bad('Cannot return against a credit note', 400, 'INVALID_INVOICE_TYPE');

  // Build per-product invoiced quantities for validation.
  const invoicedByProduct = new Map();
  for (const il of invoice.lines) {
    if (!il.productId) continue;
    invoicedByProduct.set(il.productId, dec(invoicedByProduct.get(il.productId) || 0) + dec(il.quantity));
  }
  // Existing non-rejected returns against this invoice — for cumulative cap.
  const existing = await prisma.customerReturn.findMany({
    where: { customerInvoiceId, status: { not: 'REJECTED' } },
    include: { lines: { select: { productId: true, qty: true } } },
  });
  const returnedByProduct = new Map();
  for (const r of existing) {
    for (const l of r.lines) {
      returnedByProduct.set(l.productId, dec(returnedByProduct.get(l.productId) || 0) + dec(l.qty));
    }
  }

  let total = 0;
  const normLines = lines.map((l) => {
    if (!l.productId) bad('productId required on each line');
    const qty = dec(l.qty);
    if (qty <= 0) bad('qty must be > 0');
    const invoicedQty = dec(invoicedByProduct.get(l.productId) || 0);
    if (invoicedQty <= 0) bad(`Product ${l.productId} was not on invoice`, 400, 'PRODUCT_NOT_ON_INVOICE');
    const alreadyReturned = dec(returnedByProduct.get(l.productId) || 0);
    if (alreadyReturned + qty > invoicedQty) {
      bad(
        `Return qty for ${l.productId} exceeds invoiced (${invoicedQty}) minus already-returned (${alreadyReturned})`,
        400,
        'QTY_EXCEEDS_INVOICED',
      );
    }
    const unitPrice = l.unitPrice != null
      ? dec(l.unitPrice)
      : dec(invoice.lines.find((il) => il.productId === l.productId)?.unitPrice || 0);
    total += qty * unitPrice;
    return { productId: l.productId, qty, unitPrice, reason: l.reason || null };
  });

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId }, select: { id: true } });
  if (!warehouse) bad('Warehouse not found', 404);

  const created = await prisma.$transaction(async (tx) => {
    const returnNumber = await nextReturnNumber(tx);
    const cr = await tx.customerReturn.create({
      data: {
        returnNumber,
        customerId: invoice.customerId,
        customerInvoiceId,
        warehouseId,
        status: 'REQUESTED',
        reason: reason || null,
        notes: notes || null,
        totalAmount: total,
        currency: invoice.currency,
        createdById: actor?.id || null,
        lines: { create: normLines },
      },
      include: INCLUDE,
    });
    await logEvent({
      eventType: 'CUSTOMER_RETURN_CREATED',
      entityType: 'CustomerReturn',
      entityId: cr.id,
      actorId: actor?.id,
      payload: { returnNumber: cr.returnNumber, customerInvoiceId, total },
      sourceIp,
    }, tx);
    return cr;
  });
  return created;
}

async function approveReturn(id, actor, sourceIp) {
  const cr = await prisma.customerReturn.findUnique({ where: { id } });
  if (!cr) bad('Return not found', 404);
  if (cr.status !== 'REQUESTED') bad(`Cannot approve return in status ${cr.status}`, 409, 'INVALID_STATUS');

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.customerReturn.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: actor?.id || null },
      include: INCLUDE,
    });
    await logEvent({
      eventType: 'CUSTOMER_RETURN_APPROVED',
      entityType: 'CustomerReturn',
      entityId: id,
      actorId: actor?.id,
      payload: { returnNumber: next.returnNumber },
      sourceIp,
    }, tx);
    return next;
  });
  return updated;
}

async function rejectReturn(id, { reason } = {}, actor, sourceIp) {
  if (!reason) bad('rejectReason required');
  const cr = await prisma.customerReturn.findUnique({ where: { id } });
  if (!cr) bad('Return not found', 404);
  if (cr.status !== 'REQUESTED') bad(`Cannot reject return in status ${cr.status}`, 409, 'INVALID_STATUS');

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.customerReturn.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectReason: reason },
      include: INCLUDE,
    });
    await logEvent({
      eventType: 'CUSTOMER_RETURN_REJECTED',
      entityType: 'CustomerReturn',
      entityId: id,
      actorId: actor?.id,
      payload: { reason },
      sourceIp,
    }, tx);
    return next;
  });
  return updated;
}

async function receiveReturn(id, actor, sourceIp) {
  const cr = await prisma.customerReturn.findUnique({
    where: { id },
    include: { lines: true },
  });
  if (!cr) bad('Return not found', 404);
  if (cr.status !== 'APPROVED') bad(`Cannot receive return in status ${cr.status}`, 409, 'INVALID_STATUS');

  const updated = await prisma.$transaction(async (tx) => {
    for (const l of cr.lines) {
      await stock.recordMovement(
        {
          productId: l.productId,
          warehouseId: cr.warehouseId,
          qty: dec(l.qty),
          reasonCode: 'RETURN',
          sourceDocType: 'CustomerReturn',
          sourceDocId: cr.id,
          operatorId: actor?.id,
          notes: `RMA ${cr.returnNumber}`,
        },
        tx,
      );
    }
    const next = await tx.customerReturn.update({
      where: { id },
      data: { status: 'RECEIVED', receivedAt: new Date() },
      include: INCLUDE,
    });
    await logEvent({
      eventType: 'CUSTOMER_RETURN_RECEIVED',
      entityType: 'CustomerReturn',
      entityId: id,
      actorId: actor?.id,
      payload: { returnNumber: next.returnNumber, lineCount: cr.lines.length },
      sourceIp,
    }, tx);
    return next;
  });
  return updated;
}

async function refundReturn(id, actor, sourceIp) {
  const cr = await prisma.customerReturn.findUnique({
    where: { id },
    include: { lines: true, customerInvoice: true },
  });
  if (!cr) bad('Return not found', 404);
  if (cr.status !== 'RECEIVED') bad(`Cannot refund return in status ${cr.status}`, 409, 'INVALID_STATUS');
  if (cr.creditNoteId) bad('Return already refunded', 409, 'ALREADY_REFUNDED');

  // Create credit note (signed negative inside arInvoice.createInvoice).
  const creditNote = await arInvoice.createInvoice(
    {
      customerId: cr.customerId,
      invoiceType: 'CREDIT_NOTE',
      creditedInvoiceId: cr.customerInvoiceId,
      invoiceDate: new Date(),
      currency: cr.currency,
      notes: `Credit note for RMA ${cr.returnNumber}`,
      lines: cr.lines.map((l) => ({
        productId: l.productId,
        description: `RMA ${cr.returnNumber}`,
        quantity: dec(l.qty),
        unitPrice: dec(l.unitPrice),
      })),
    },
    actor,
    sourceIp,
  );

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.customerReturn.update({
      where: { id },
      data: { status: 'REFUNDED', refundedAt: new Date(), creditNoteId: creditNote.id },
      include: INCLUDE,
    });
    await logEvent({
      eventType: 'CUSTOMER_RETURN_REFUNDED',
      entityType: 'CustomerReturn',
      entityId: id,
      actorId: actor?.id,
      payload: { returnNumber: next.returnNumber, creditNoteId: creditNote.id, creditNoteNumber: creditNote.invoiceNumber },
      sourceIp,
    }, tx);
    return next;
  });
  return updated;
}

async function listReturns(filters = {}) {
  const { customerId, status, customerInvoiceId, limit = 50, offset = 0 } = filters;
  const where = {};
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;
  if (customerInvoiceId) where.customerInvoiceId = customerInvoiceId;
  const [items, total] = await Promise.all([
    prisma.customerReturn.findMany({
      where,
      include: INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    }),
    prisma.customerReturn.count({ where }),
  ]);
  return { items, total };
}

async function getReturn(id) {
  const cr = await prisma.customerReturn.findUnique({ where: { id }, include: INCLUDE });
  if (!cr) bad('Return not found', 404);
  return cr;
}

module.exports = {
  createReturn,
  approveReturn,
  rejectReturn,
  receiveReturn,
  refundReturn,
  listReturns,
  getReturn,
};
