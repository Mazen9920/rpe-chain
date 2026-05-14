/**
 * Shipment service — Section 6 (Fulfillment).
 * Shipments are CREATED via `salesOrder.shipOrder`. This service owns the
 * read endpoints + status transitions (deliver / void).
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');
const { reverseFifo } = require('./fifo.service');
const { recordMovement } = require('./stock.service');

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

const SHIPMENT_INCLUDE = {
  salesOrder: {
    select: { id: true, orderNumber: true, status: true, customerName: true, customerId: true },
  },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
    },
  },
  trackingEvents: { orderBy: { occurredAt: 'desc' } },
};

async function listShipments(params = {}) {
  const { search, status, salesOrderId, carrier, limit = 100, offset = 0 } = params;
  const where = {};
  if (status) where.status = status;
  if (salesOrderId) where.salesOrderId = salesOrderId;
  if (carrier) where.carrier = carrier;
  if (search) {
    where.OR = [
      { shipmentNumber: { contains: search, mode: 'insensitive' } },
      { trackingNumber: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      include: {
        salesOrder: { select: { id: true, orderNumber: true, customerName: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true, trackingEvents: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    }),
  ]);
  return { total, items };
}

async function getShipmentById(id) {
  const s = await prisma.shipment.findUnique({ where: { id }, include: SHIPMENT_INCLUDE });
  if (!s) bad('Shipment not found', 404);
  return s;
}

async function markDelivered(id, data, actor, sourceIp) {
  const s = await prisma.shipment.findUnique({ where: { id }, include: { salesOrder: true } });
  if (!s) bad('Shipment not found', 404);
  if (s.status === 'DELIVERED') return s;
  if (s.status === 'VOIDED') bad('Cannot deliver a voided shipment', 409, 'INVALID_STATUS');
  if (!['PENDING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'].includes(s.status)) {
    bad(`Cannot mark delivered from status ${s.status}`, 409, 'BAD_STATUS_TRANSITION');
  }
  const deliveredAt = data?.deliveredAt ? new Date(data.deliveredAt) : new Date();

  const updated = await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id },
      data: { status: 'DELIVERED', deliveredAt },
    });
    await tx.trackingEvent.create({
      data: {
        shipmentId: id,
        eventType: 'DELIVERED',
        occurredAt: deliveredAt,
        location: data?.location || null,
      },
    });
    // If all shipments of the SO are delivered → SO.status = DELIVERED
    if (s.salesOrderId) {
      const siblings = await tx.shipment.findMany({
        where: { salesOrderId: s.salesOrderId, status: { not: 'VOIDED' } },
      });
      if (siblings.every((x) => x.id === id || x.status === 'DELIVERED')) {
        await tx.salesOrder.update({
          where: { id: s.salesOrderId },
          data: { status: 'DELIVERED', deliveredAt },
        });
      }
    }
    return tx.shipment.findUnique({ where: { id }, include: SHIPMENT_INCLUDE });
  });
  await logEvent({
    eventType: 'SHIPMENT_DELIVERED',
    entityType: 'Shipment',
    entityId: id,
    actorId: actor?.id,
    payload: { shipmentNumber: s.shipmentNumber, salesOrderId: s.salesOrderId },
    sourceIp,
  });

  // Auto-generate AR invoice from this shipment. Idempotent; failure must not roll back delivery.
  try {
    const arBilling = require('./arBilling.service');
    await arBilling.generateFromShipment(id, actor, sourceIp);
  } catch (e) {
    // Permissible failures: NO_SALES_ORDER, NO_CUSTOMER, EMPTY_SHIPMENT, CURRENCY_REQUIRED.
    // Anything else is logged but doesn't fail the delivery.
    console.error(`[shipment] auto-invoice for ${s.shipmentNumber} failed: ${e.message} (${e.code || 'UNKNOWN'})`);
  }
  return updated;
}

async function voidShipment(id, data, actor, sourceIp) {
  const s = await prisma.shipment.findUnique({
    where: { id },
    include: { lines: true, salesOrder: true },
  });
  if (!s) bad('Shipment not found', 404);
  if (s.status === 'VOIDED') bad('Shipment already voided', 409, 'INVALID_STATUS');
  if (s.status === 'DELIVERED') bad('Cannot void a delivered shipment', 409, 'INVALID_STATUS');
  if (!s.warehouseId) bad('Shipment has no warehouse', 400);
  const reason = data?.reason || 'No reason provided';

  const updated = await prisma.$transaction(async (tx) => {
    // For each line, reverse FIFO + restore stock onHand + bump SO line.qtyShipped down
    for (const line of s.lines) {
      // Find the original cogs postings for this shipment+product to reverse
      const postings = await tx.cogsPosting.findMany({
        where: { shipmentId: id, productId: line.productId },
        orderBy: { createdAt: 'asc' },
      });
      let remaining = line.qty;
      for (const p of postings) {
        if (remaining <= 0) break;
        const reverseQty = Math.min(remaining, Math.abs(p.qtyConsumed));
        if (reverseQty <= 0) continue;
        await reverseFifo(
          { productId: line.productId, warehouseId: s.warehouseId, originalCogsPostingId: p.id, qty: reverseQty },
          tx,
        );
        remaining -= reverseQty;
      }

      // Restock the physical movement (positive qty — using ADJUSTMENT direction by sign)
      await recordMovement(
        {
          productId: line.productId,
          warehouseId: s.warehouseId,
          qty: line.qty,
          reasonCode: 'ADJUSTMENT',
          sourceDocType: 'SHIPMENT_VOID',
          sourceDocId: id,
          operatorId: actor.id,
          notes: `Shipment ${s.shipmentNumber} voided: ${reason}`,
        },
        tx,
      );

      // Decrement SO line.qtyShipped
      if (line.salesOrderLineId) {
        await tx.salesOrderLine.update({
          where: { id: line.salesOrderLineId },
          data: { qtyShipped: { decrement: line.qty } },
        });
      }
    }

    await tx.shipment.update({
      where: { id },
      data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
    });

    // If SO was SHIPPED and now has fewer shipped lines, roll it back to PACKED
    if (s.salesOrderId) {
      const so = await tx.salesOrder.findUnique({
        where: { id: s.salesOrderId },
        include: { lines: true },
      });
      if (so && (so.status === 'SHIPPED' || so.status === 'DELIVERED')) {
        const anyShipped = so.lines.some((l) => l.qtyShipped > 0);
        await tx.salesOrder.update({
          where: { id: s.salesOrderId },
          data: {
            status: anyShipped ? 'PACKED' : 'PACKED',
            shippedAt: null,
            deliveredAt: null,
          },
        });
      }
    }

    return tx.shipment.findUnique({ where: { id }, include: SHIPMENT_INCLUDE });
  });

  await logEvent({
    eventType: 'SHIPMENT_VOIDED',
    entityType: 'Shipment',
    entityId: id,
    actorId: actor?.id,
    payload: { shipmentNumber: s.shipmentNumber, reason, salesOrderId: s.salesOrderId },
    sourceIp,
  });
  return updated;
}

module.exports = {
  listShipments,
  getShipmentById,
  markDelivered,
  voidShipment,
};
