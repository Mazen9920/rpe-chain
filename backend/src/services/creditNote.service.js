/**
 * Credit note service — Section 5.
 * Thin wrapper over apInvoice.createInvoice with invoiceType=CREDIT_NOTE.
 */
const prisma = require('../lib/prisma');
const apInvoice = require('./apInvoice.service');

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

async function createCreditNote(data, actor, sourceIp) {
  if (!data.creditedInvoiceId) bad('creditedInvoiceId required');
  const credited = await prisma.supplierInvoice.findUnique({ where: { id: data.creditedInvoiceId }, select: { id: true, supplierId: true, currency: true, purchaseOrderId: true } });
  if (!credited) bad('Credited invoice not found', 404);
  return apInvoice.createInvoice(
    {
      ...data,
      invoiceType: 'CREDIT_NOTE',
      supplierId: credited.supplierId,
      purchaseOrderId: data.purchaseOrderId || credited.purchaseOrderId || null,
      currency: data.currency || credited.currency || 'USD',
    },
    actor,
    sourceIp,
  );
}

async function listCreditNotes(filters = {}) {
  return apInvoice.listInvoices({ ...filters, invoiceType: 'CREDIT_NOTE' });
}

module.exports = { createCreditNote, listCreditNotes };
