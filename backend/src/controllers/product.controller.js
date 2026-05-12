const prisma = require('../lib/prisma');
const { logEvent } = require('../services/audit.service');

/**
 * Product controller for the new (master-plan-aligned) schema.
 * Stock lives in StockLevel per warehouse, NOT on the product row.
 */

async function list(req, res) {
  const { search, categoryId, supplierId } = req.query;
  const where = { isActive: true, deletedAt: null };
  if (search) where.name = { contains: search, mode: 'insensitive' };
  if (categoryId) where.categoryId = categoryId;
  if (supplierId) {
    where.supplierProducts = { some: { supplierId } };
  }

  const products = await prisma.product.findMany({
    where,
    include: {
      category: true,
      stockLevels: { include: { warehouse: { select: { id: true, code: true, name: true } } } },
    },
    orderBy: { name: 'asc' },
  });

  // Roll up stock for convenience.
  const result = products.map((p) => ({
    ...p,
    totalOnHand: p.stockLevels.reduce((s, sl) => s + sl.onHand, 0),
    totalReserved: p.stockLevels.reduce((s, sl) => s + sl.reserved, 0),
    isLowStock:
      p.stockLevels.reduce((s, sl) => s + sl.onHand - sl.reserved, 0) <= p.reorderPoint,
  }));
  res.json(result);
}

async function lowStock(_req, res) {
  const products = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null },
    include: { category: true, stockLevels: true },
  });
  const low = products
    .map((p) => ({
      ...p,
      totalOnHand: p.stockLevels.reduce((s, sl) => s + sl.onHand, 0),
      totalReserved: p.stockLevels.reduce((s, sl) => s + sl.reserved, 0),
    }))
    .filter((p) => p.totalOnHand - p.totalReserved <= p.reorderPoint);
  res.json(low);
}

async function getById(req, res) {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: {
      category: true,
      stockLevels: { include: { warehouse: true } },
      supplierProducts: { include: { supplier: { select: { id: true, name: true, code: true } } } },
      stockMovements: { orderBy: { createdAt: 'desc' }, take: 20, include: { warehouse: true } },
      lots: { orderBy: { receivedDate: 'desc' }, take: 20 },
    },
  });
  if (!product) return res.status(404).json({ error: 'Product not found' });
  res.json(product);
}

async function create(req, res) {
  const product = await prisma.product.create({ data: req.body });
  await logEvent({
    eventType: 'PRODUCT_CREATED',
    entityType: 'Product',
    entityId: product.id,
    actorId: req.user?.id,
    payload: { after: product },
    sourceIp: req.ip,
  });
  res.status(201).json(product);
}

async function update(req, res) {
  const before = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!before || before.deletedAt) return res.status(404).json({ error: 'Product not found' });

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: { ...req.body, version: { increment: 1 } },
  });
  await logEvent({
    eventType: 'PRODUCT_UPDATED',
    entityType: 'Product',
    entityId: product.id,
    actorId: req.user?.id,
    payload: { before, after: product },
    sourceIp: req.ip,
  });
  res.json(product);
}

async function remove(req, res) {
  const before = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!before || before.deletedAt) return res.status(404).json({ error: 'Product not found' });

  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await logEvent({
    eventType: 'PRODUCT_DELETED',
    entityType: 'Product',
    entityId: product.id,
    actorId: req.user?.id,
    payload: { before, after: product },
    sourceIp: req.ip,
  });
  res.status(204).send();
}

module.exports = { list, lowStock, getById, create, update, remove };
