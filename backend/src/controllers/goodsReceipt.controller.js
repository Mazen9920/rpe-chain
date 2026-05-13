const svc = require('../services/goodsReceipt.service');
const prisma = require('../lib/prisma');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  const where = {};
  if (req.query.warehouseId) where.warehouseId = req.query.warehouseId;
  if (req.query.poId) where.purchaseOrderId = req.query.poId;
  if (req.query.status) where.status = req.query.status;
  if (req.query.dateFrom || req.query.dateTo) {
    where.receivedAt = {};
    if (req.query.dateFrom) where.receivedAt.gte = new Date(req.query.dateFrom);
    if (req.query.dateTo) where.receivedAt.lte = new Date(req.query.dateTo);
  }
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const offset = Number(req.query.offset) || 0;
  const [rows, total] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      include: {
        purchaseOrder: { select: { id: true, poNumber: true, supplier: { select: { id: true, name: true } } } },
        warehouse: { select: { id: true, name: true, code: true } },
        receivedBy: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    prisma.goodsReceipt.count({ where }),
  ]);
  res.json({ rows, total, limit, offset });
});

const getById = wrap(async (req, res) => {
  const grn = await prisma.goodsReceipt.findUnique({
    where: { id: req.params.id },
    include: {
      purchaseOrder: {
        include: {
          supplier: { select: { id: true, name: true, code: true } },
          landedCostAllocations: { orderBy: { createdAt: 'asc' } },
        },
      },
      warehouse: { select: { id: true, name: true, code: true } },
      receivedBy: { select: { id: true, name: true } },
      reversedBy: { select: { id: true, name: true } },
      lines: {
        include: {
          poLine: { include: { product: { select: { id: true, sku: true, name: true, uom: true } } } },
          lot: true,
          qaActionedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!grn) return res.status(404).json({ error: 'Goods receipt not found' });
  // Expose PO-scoped landed cost allocations as `landedCosts` on the GRN for convenience.
  grn.landedCosts = grn.purchaseOrder?.landedCostAllocations ?? [];
  res.json(grn);
});

const reverse = wrap(async (req, res) => {
  const reason = req.body?.reason;
  if (!reason) return res.status(400).json({ error: 'reason is required' });
  res.json(await svc.reverseReceipt(req.params.id, reason, req.user, req.ip));
});

const qaAction = wrap(async (req, res) => {
  const { action, reason } = req.body || {};
  if (!action || !['RELEASE', 'REJECT'].includes(action)) {
    return res.status(400).json({ error: 'action must be RELEASE or REJECT' });
  }
  res.json(await svc.qaAction(req.params.lineId, action, reason, req.user, req.ip));
});

const addLandedCost = wrap(async (req, res) => {
  const { costType, amount, allocationMethod } = req.body || {};
  res.status(201).json(
    await svc.addLandedCost(
      req.params.id,
      { costType, amount, allocationMethod },
      req.user,
      req.ip
    )
  );
});

const removeLandedCost = wrap(async (req, res) => {
  res.json(await svc.removeLandedCost(req.params.allocationId, req.user, req.ip));
});

module.exports = { list, getById, reverse, qaAction, addLandedCost, removeLandedCost };
