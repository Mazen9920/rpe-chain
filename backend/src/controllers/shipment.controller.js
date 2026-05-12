const prisma = require('../lib/prisma');
const { depleteFifo } = require('../services/fifo.service');
const { recordMovement } = require('../services/stock.service');
const { logEvent } = require('../services/audit.service');

function generateShipmentNumber() {
  return `SHP-${Date.now()}`;
}

async function list(req, res) {
  const { status } = req.query;
  const where = status ? { status } : {};
  const shipments = await prisma.shipment.findMany({
    where,
    include: {
      createdBy: { select: { id: true, name: true } },
      lines: { include: { product: { select: { id: true, sku: true, name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(shipments);
}

async function getById(req, res) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: req.params.id },
    include: {
      createdBy: { select: { id: true, name: true } },
      lines: { include: { product: true } },
      trackingEvents: { orderBy: { occurredAt: 'desc' } },
    },
  });
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  res.json(shipment);
}

/**
 * Create a shipment. Body: { warehouseId, lines: [{ productId, qty }], carrier?, ... }
 * This is the outbound path that triggers FIFO depletion + stock movement.
 */
async function create(req, res) {
  const { warehouseId, lines, carrier, trackingNumber, estimatedArrival, notes, salesOrderId } =
    req.body;
  if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'At least one shipment line required' });
  }

  const shipment = await prisma.$transaction(async (tx) => {
    const created = await tx.shipment.create({
      data: {
        shipmentNumber: generateShipmentNumber(),
        salesOrderId,
        carrier,
        trackingNumber,
        estimatedArrival: estimatedArrival ? new Date(estimatedArrival) : undefined,
        notes,
        createdById: req.user.id,
        lines: { create: lines.map((l) => ({ productId: l.productId, qty: l.qty })) },
      },
      include: { lines: true },
    });
    return created;
  });

  // FIFO deplete + record movement for each line (outside the create transaction
  // so each depletion gets its own row-locked transaction).
  for (const line of shipment.lines) {
    await depleteFifo({
      productId: line.productId,
      warehouseId,
      qty: line.qty,
      shipmentId: shipment.id,
      salesOrderId,
    });
    await recordMovement({
      productId: line.productId,
      warehouseId,
      qty: line.qty,
      reasonCode: 'SHIPMENT',
      sourceDocType: 'SHIPMENT',
      sourceDocId: shipment.id,
      operatorId: req.user.id,
    });
  }

  await logEvent({
    eventType: 'SHIPMENT_CREATED',
    entityType: 'Shipment',
    entityId: shipment.id,
    actorId: req.user.id,
    payload: { shipmentNumber: shipment.shipmentNumber, lineCount: shipment.lines.length },
  });

  res.status(201).json(shipment);
}

async function updateStatus(req, res) {
  const { status, trackingNumber } = req.body;
  const data = { status };
  if (trackingNumber) data.trackingNumber = trackingNumber;
  if (status === 'IN_TRANSIT') data.dispatchedAt = new Date();
  if (status === 'DELIVERED') data.deliveredAt = new Date();

  const shipment = await prisma.shipment.update({ where: { id: req.params.id }, data });
  await logEvent({
    eventType: `SHIPMENT_${status}`,
    entityType: 'Shipment',
    entityId: shipment.id,
    actorId: req.user.id,
  });
  res.json(shipment);
}

module.exports = { list, getById, create, updateStatus };
