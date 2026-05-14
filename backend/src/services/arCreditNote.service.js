/**
 * AR Credit Note service — Tier 4 #14.
 * Thin wrapper over arInvoice.createInvoice with invoiceType=CREDIT_NOTE.
 */
const prisma = require('../lib/prisma');
const arInvoice = require('./arInvoice.service');

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

async function createCreditNote(data, actor, sourceIp) {
  if (!data.creditedInvoiceId) bad('creditedInvoiceId required');
  const credited = await prisma.customerInvoice.findUnique({
    where: { id: data.creditedInvoiceId },
    select: { id: true, customerId: true, currency: true, salesOrderId: true },
  });
  if (!credited) bad('Credited invoice not found', 404);
  return arInvoice.createInvoice(
    {
      ...data,
      invoiceType: 'CREDIT_NOTE',
      customerId: credited.customerId,
      salesOrderId: data.salesOrderId || credited.salesOrderId || null,
      currency: data.currency || credited.currency,
    },
    actor,
    sourceIp,
  );
}

async function listCreditNotes(filters = {}) {
  return arInvoice.listInvoices({ ...filters, invoiceType: 'CREDIT_NOTE' });
}

module.exports = { createCreditNote, listCreditNotes };
