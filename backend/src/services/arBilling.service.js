/**
 * AR Billing service — Tier 4 #14.
 * Generates a CustomerInvoice from a delivered Shipment. Idempotent: re-running
 * for a shipment that already produced an invoice returns the existing one.
 */
const prisma = require('../lib/prisma');
const arInvoice = require('./arInvoice.service');

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function dec(n) { return Number(n ?? 0); }

/**
 * Generate (or fetch existing) CustomerInvoice for a shipment.
 * @returns {{ invoice: CustomerInvoice, created: boolean }}
 */
async function generateFromShipment(shipmentId, actor, sourceIp) {
  if (!shipmentId) bad('shipmentId required');

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      salesOrder: { select: { id: true, customerId: true, currency: true, customerName: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
  });
  if (!shipment) bad('Shipment not found', 404);

  // Idempotency: shipmentId is uniquely indexed on CustomerInvoice.
  const existing = await prisma.customerInvoice.findUnique({ where: { shipmentId } });
  if (existing) {
    return { invoice: await arInvoice.getInvoiceById(existing.id), created: false };
  }

  if (!shipment.salesOrderId || !shipment.salesOrder) {
    bad('Shipment has no linked sales order; cannot auto-invoice', 400, 'NO_SALES_ORDER');
  }
  if (!shipment.salesOrder.customerId) {
    bad('Sales order has no linked customer; cannot auto-invoice', 400, 'NO_CUSTOMER');
  }
  if (!shipment.lines || shipment.lines.length === 0) {
    bad('Shipment has no lines; nothing to invoice', 400, 'EMPTY_SHIPMENT');
  }

  // Build invoice lines from shipment lines, falling back to SO line price when unitPrice missing.
  const soLineIds = shipment.lines.map((l) => l.salesOrderLineId).filter(Boolean);
  const soLines = soLineIds.length
    ? await prisma.salesOrderLine.findMany({ where: { id: { in: soLineIds } } })
    : [];
  const soLineById = new Map(soLines.map((l) => [l.id, l]));

  const lines = shipment.lines.map((sl) => {
    const so = sl.salesOrderLineId ? soLineById.get(sl.salesOrderLineId) : null;
    const unitPrice = dec(sl.unitPrice ?? so?.unitPrice);
    return {
      productId: sl.productId,
      description: sl.product?.name || sl.product?.sku || 'Product',
      quantity: sl.qty,
      unitPrice,
    };
  });

  const invoice = await arInvoice.createInvoice(
    {
      customerId: shipment.salesOrder.customerId,
      salesOrderId: shipment.salesOrderId,
      shipmentId: shipment.id,
      invoiceDate: shipment.deliveredAt || new Date(),
      currency: shipment.salesOrder.currency,
      taxAmount: 0,
      notes: `Auto-generated from shipment ${shipment.shipmentNumber}`,
      lines,
    },
    actor,
    sourceIp,
  );
  return { invoice, created: true };
}

module.exports = { generateFromShipment };
