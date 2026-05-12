const prisma = require('../lib/prisma');
const { getInventoryValuation } = require('../services/fifo.service');
const { logEvent } = require('../services/audit.service');
const { recordMovement } = require('../services/stock.service');

function pickWarehouseData(body) {
  return {
    code: body.code,
    name: body.name,
    address: body.address || null,
    taxJurisdiction: body.taxJurisdiction || null,
  };
}

async function listWarehouses(_req, res) {
  const warehouses = await prisma.warehouse.findMany({
    where: { isActive: true },
    orderBy: { code: 'asc' },
  });
  res.json(warehouses);
}

async function getWarehouse(req, res) {
  const warehouse = await prisma.warehouse.findFirst({
    where: { id: req.params.id, isActive: true },
    include: {
      stockLevels: {
        include: {
          product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true } },
        },
      },
    },
  });
  if (!warehouse) return res.status(404).json({ error: 'Warehouse not found' });
  res.json(warehouse);
}

async function createWarehouse(req, res) {
  const data = pickWarehouseData(req.body);
  if (!data.code || !data.name) {
    return res.status(400).json({ error: 'Warehouse code and name are required' });
  }

  const existing = await prisma.warehouse.findUnique({ where: { code: data.code } });
  if (existing) return res.status(409).json({ error: 'Warehouse code already exists' });

  const warehouse = await prisma.warehouse.create({ data });
  await logEvent({
    eventType: 'WAREHOUSE_CREATED',
    entityType: 'Warehouse',
    entityId: warehouse.id,
    actorId: req.user?.id,
    payload: { after: warehouse },
    sourceIp: req.ip,
  });
  res.status(201).json(warehouse);
}

async function updateWarehouse(req, res) {
  const before = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!before || !before.isActive) return res.status(404).json({ error: 'Warehouse not found' });

  const data = pickWarehouseData({ ...before, ...req.body });
  if (!data.code || !data.name) {
    return res.status(400).json({ error: 'Warehouse code and name are required' });
  }

  const codeOwner = await prisma.warehouse.findUnique({ where: { code: data.code } });
  if (codeOwner && codeOwner.id !== req.params.id) {
    return res.status(409).json({ error: 'Warehouse code already exists' });
  }

  const warehouse = await prisma.warehouse.update({
    where: { id: req.params.id },
    data,
  });
  await logEvent({
    eventType: 'WAREHOUSE_UPDATED',
    entityType: 'Warehouse',
    entityId: warehouse.id,
    actorId: req.user?.id,
    payload: { before, after: warehouse },
    sourceIp: req.ip,
  });
  res.json(warehouse);
}

async function deactivateWarehouse(req, res) {
  const before = await prisma.warehouse.findUnique({ where: { id: req.params.id } });
  if (!before || !before.isActive) return res.status(404).json({ error: 'Warehouse not found' });

  const warehouse = await prisma.warehouse.update({
    where: { id: req.params.id },
    data: { isActive: false },
  });
  await logEvent({
    eventType: 'WAREHOUSE_DEACTIVATED',
    entityType: 'Warehouse',
    entityId: warehouse.id,
    actorId: req.user?.id,
    payload: { before, after: warehouse },
    sourceIp: req.ip,
  });
  res.status(204).send();
}

async function listStockLevels(req, res) {
  const { warehouseId, productId } = req.query;
  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;

  const levels = await prisma.stockLevel.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, reorderPoint: true } },
      warehouse: { select: { id: true, code: true, name: true } },
    },
    orderBy: [{ warehouse: { code: 'asc' } }, { product: { sku: 'asc' } }],
  });
  res.json(levels);
}

async function listLots(req, res) {
  const { expiringInDays, productId } = req.query;
  const where = { qtyRemaining: { gt: 0 } };
  if (productId) where.productId = productId;
  if (expiringInDays) {
    const cutoff = new Date(Date.now() + Number(expiringInDays) * 24 * 60 * 60 * 1000);
    where.expiryDate = { lte: cutoff };
  }

  const lots = await prisma.lot.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
    },
    orderBy: { expiryDate: 'asc' },
  });
  res.json(lots);
}

async function getValuation(req, res) {
  const { warehouseId, productId } = req.query;
  const result = await getInventoryValuation({ warehouseId, productId });
  res.json(result);
}

async function listMovements(req, res) {
  const { productId, warehouseId, limit = 50 } = req.query;
  const where = {};
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;

  const movements = await prisma.stockMovement.findMany({
    where,
    take: Number(limit),
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true } },
      warehouse: { select: { id: true, code: true, name: true } },
      lot: { select: { id: true, lotNumber: true } },
    },
  });
  res.json(movements);
}

async function adjustStock(req, res) {
  const { productId, warehouseId, lotId, qty, notes } = req.body;
  const numericQty = Number(qty);

  if (!productId || !warehouseId || !Number.isFinite(numericQty) || numericQty === 0) {
    return res.status(400).json({ error: 'productId, warehouseId, and non-zero qty are required' });
  }

  try {
    const movement = await recordMovement({
      productId,
      warehouseId,
      lotId: lotId || null,
      qty: numericQty,
      reasonCode: 'ADJUSTMENT',
      sourceDocType: 'MANUAL',
      sourceDocId: `ADJ-${Date.now()}`,
      operatorId: req.user?.id,
      notes: notes || null,
    });
    await logEvent({
      eventType: 'STOCK_ADJUSTED',
      entityType: 'StockMovement',
      entityId: movement.id,
      actorId: req.user?.id,
      payload: { productId, warehouseId, lotId: lotId || null, qty: numericQty, notes: notes || null },
      sourceIp: req.ip,
    });
    res.status(201).json(movement);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Unable to adjust stock' });
  }
}

module.exports = {
  listWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  deactivateWarehouse,
  listStockLevels,
  listLots,
  getValuation,
  listMovements,
  adjustStock,
};
