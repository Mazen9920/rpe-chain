const prisma = require('../lib/prisma');
const { createCostLayer } = require('../services/fifo.service');
const { recordMovement } = require('../services/stock.service');
const { logEvent } = require('../services/audit.service');

function generatePONumber() {
  return `PO-${Date.now()}`;
}

async function list(req, res) {
  const { status } = req.query;
  const where = { deletedAt: null };
  if (status) where.status = status;
  const orders = await prisma.purchaseOrder.findMany({
    where,
    include: {
      supplier: { select: { id: true, name: true, code: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  res.json(orders);
}

async function getById(req, res) {
  const order = await prisma.purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: {
      supplier: true,
      createdBy: { select: { id: true, name: true } },
      approvedBy: { select: { id: true, name: true } },
      lines: {
        include: { product: { select: { id: true, sku: true, name: true, uom: true } } },
      },
      goodsReceipts: { include: { lines: true } },
    },
  });
  if (!order) return res.status(404).json({ error: 'Purchase order not found' });
  res.json(order);
}

async function create(req, res) {
  const { supplierId, lines, expectedDate, notes, currency } = req.body;
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'PO must contain at least one line' });
  }
  const totalAmount = lines.reduce((s, l) => s + Number(l.qtyOrdered) * Number(l.unitPrice), 0);

  const order = await prisma.purchaseOrder.create({
    data: {
      poNumber: generatePONumber(),
      supplierId,
      createdById: req.user.id,
      currency: currency || 'USD',
      expectedDate: expectedDate ? new Date(expectedDate) : undefined,
      notes,
      totalAmount,
      lines: {
        create: lines.map((l) => ({
          productId: l.productId,
          qtyOrdered: l.qtyOrdered,
          unitPrice: l.unitPrice,
          expectedDate: l.expectedDate ? new Date(l.expectedDate) : undefined,
        })),
      },
    },
    include: { lines: true },
  });
  await logEvent({
    eventType: 'PO_CREATED',
    entityType: 'PurchaseOrder',
    entityId: order.id,
    actorId: req.user.id,
    payload: { poNumber: order.poNumber, supplierId },
  });
  res.status(201).json(order);
}

async function updateStatus(req, res) {
  const { status } = req.body;
  const data = { status };
  if (status === 'APPROVED') {
    data.approvedById = req.user.id;
    data.approvedAt = new Date();
  }
  const order = await prisma.purchaseOrder.update({ where: { id: req.params.id }, data });
  await logEvent({
    eventType: `PO_${status}`,
    entityType: 'PurchaseOrder',
    entityId: order.id,
    actorId: req.user.id,
  });
  res.json(order);
}

/**
 * Goods receipt — the critical inflow.
 * For each line received: create a Lot, a CostLayer (FIFO), a StockMovement,
 * and a GoodsReceiptLine. All atomic.
 *
 * Body: { warehouseId, lines: [{ poLineId, qtyReceived, expiryDate?, qaStatus? }] }
 */
async function receiveGoods(req, res) {
  const { warehouseId, lines } = req.body;
  const poId = req.params.id;

  if (!warehouseId) return res.status(400).json({ error: 'warehouseId is required' });
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'At least one receipt line required' });
  }

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findUnique({
      where: { id: poId },
      include: { lines: true, supplier: true },
    });
    if (!po) throw new Error('Purchase order not found');

    const receipt = await tx.goodsReceipt.create({
      data: {
        receiptNumber: `GR-${Date.now()}`,
        purchaseOrderId: poId,
        warehouseId,
        receivedById: req.user.id,
      },
    });

    for (const line of lines) {
      const poLine = po.lines.find((l) => l.id === line.poLineId);
      if (!poLine) throw new Error(`PO line ${line.poLineId} not found`);

      const qty = Number(line.qtyReceived);
      if (qty <= 0) continue;

      // 1. Create lot.
      const lot = await tx.lot.create({
        data: {
          lotNumber: `${poLine.productId.slice(0, 8)}-${Date.now()}`,
          productId: poLine.productId,
          supplierId: po.supplierId,
          expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
          qtyReceived: qty,
          qtyRemaining: qty,
          qaStatus: line.qaStatus || 'RELEASED',
        },
      });

      // 2. Create cost layer (FIFO).
      await createCostLayer(
        {
          productId: poLine.productId,
          warehouseId,
          lotId: lot.id,
          qty,
          unitCost: Number(poLine.unitPrice),
          currency: po.currency,
          poLineId: poLine.id,
        },
        tx
      );

      // 3. Record stock movement and update StockLevel.
      await recordMovement(
        {
          productId: poLine.productId,
          warehouseId,
          lotId: lot.id,
          qty,
          reasonCode: 'RECEIPT',
          sourceDocType: 'PO',
          sourceDocId: poId,
          operatorId: req.user.id,
        },
        tx
      );

      // 4. Receipt line.
      await tx.goodsReceiptLine.create({
        data: {
          receiptId: receipt.id,
          poLineId: poLine.id,
          qtyReceived: qty,
          lotId: lot.id,
          qaStatus: line.qaStatus || 'RELEASED',
        },
      });

      // 5. Update PO line qtyReceived & status.
      const newReceived = poLine.qtyReceived + qty;
      await tx.purchaseOrderLine.update({
        where: { id: poLine.id },
        data: {
          qtyReceived: newReceived,
          status: newReceived >= poLine.qtyOrdered ? 'COMPLETED' : 'PARTIAL',
        },
      });
    }

    // 6. Update PO status.
    const refreshedLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId } });
    const allDone = refreshedLines.every((l) => l.qtyReceived >= l.qtyOrdered);
    const anyDone = refreshedLines.some((l) => l.qtyReceived > 0);
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: allDone ? 'RECEIVED' : anyDone ? 'PARTIALLY_RECEIVED' : po.status },
    });

    return receipt;
  });

  await logEvent({
    eventType: 'GOODS_RECEIVED',
    entityType: 'GoodsReceipt',
    entityId: result.id,
    actorId: req.user.id,
    payload: { poId },
  });

  res.status(201).json(result);
}

module.exports = { list, getById, create, updateStatus, receiveGoods };
