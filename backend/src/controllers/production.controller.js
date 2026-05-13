/**
 * Production controller — Production Order REST surface.
 *
 * GET    /api/production-orders                     ?status,productId,warehouseId
 * GET    /api/production-orders/:id
 * POST   /api/production-orders/plan                { productId, plannedQty, warehouseId, bomId?, notes? }
 * POST   /api/production-orders/:id/release
 * POST   /api/production-orders/:id/consume
 * POST   /api/production-orders/:id/output          { qty, scrapQty?, lotNumber?, expiryDate? }
 * POST   /api/production-orders/:id/cancel          { reason? }
 */
const prisma = require('../lib/prisma');
const production = require('../services/production.service');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const list = wrap(async (req, res) => {
  const { status, productId, warehouseId } = req.query;
  const where = {};
  if (status) where.status = status;
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;

  const orders = await prisma.productionOrder.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      bom: { select: { id: true, version: true } },
      _count: { select: { lines: true, outputs: true } },
    },
    orderBy: [{ createdAt: 'desc' }],
  });
  res.json(orders);
});

const get = wrap(async (req, res) => {
  const order = await prisma.productionOrder.findUnique({
    where: { id: req.params.id },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, standardLaborCost: true, standardOverheadCost: true } },
      warehouse: { select: { id: true, code: true, name: true, currency: true } },
      bom: { select: { id: true, version: true } },
      createdBy: { select: { id: true, name: true } },
      lines: {
        include: { componentProduct: { select: { id: true, sku: true, name: true, uom: true } } },
      },
      outputs: { include: { lot: { select: { id: true, lotNumber: true, qtyRemaining: true, expiryDate: true } } }, orderBy: { createdAt: 'desc' } },
      consumptions: { include: { lot: { select: { id: true, lotNumber: true } } } },
    },
  });
  if (!order) return res.status(404).json({ error: 'Production order not found' });
  res.json(order);
});

const plan = wrap(async (req, res) => {
  try {
    const { productId, plannedQty, warehouseId, bomId, notes } = req.body;
    const result = await production.planOrder({
      productId,
      plannedQty: Number(plannedQty),
      warehouseId,
      bomId,
      notes,
      createdById: req.user?.id,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const release = wrap(async (req, res) => {
  try {
    const order = await production.releaseOrder(req.params.id, req.user?.id);
    res.json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const consume = wrap(async (req, res) => {
  try {
    const result = await production.consumeComponents(req.params.id, req.user?.id);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const output = wrap(async (req, res) => {
  try {
    const { qty, scrapQty, lotNumber, expiryDate } = req.body;
    const result = await production.postOutput({
      orderId: req.params.id,
      qty: Number(qty),
      scrapQty: Number(scrapQty || 0),
      lotNumber,
      expiryDate,
      userId: req.user?.id,
    });
    res.status(201).json(result);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const cancel = wrap(async (req, res) => {
  try {
    const order = await production.cancelOrder(req.params.id, req.user?.id, req.body?.reason);
    res.json(order);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = { list, get, plan, release, consume, output, cancel };
