const express = require('express');
const router = express.Router();
const prisma = require('../lib/prisma');
const { authenticate } = require('../middleware/auth.middleware');
const { getInventoryValuation } = require('../services/fifo.service');

router.use(authenticate);

// List warehouses
router.get('/warehouses', async (_req, res) => {
  const warehouses = await prisma.warehouse.findMany({ where: { isActive: true } });
  res.json(warehouses);
});

// Stock levels (optionally filtered by warehouse)
router.get('/stock-levels', async (req, res) => {
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
  });
  res.json(levels);
});

// Lots — full traceability list, sortable by expiry
router.get('/lots', async (req, res) => {
  const { expiringInDays } = req.query;
  const where = { qtyRemaining: { gt: 0 } };
  if (expiringInDays) {
    const cutoff = new Date(Date.now() + Number(expiringInDays) * 24 * 60 * 60 * 1000);
    where.expiryDate = { lte: cutoff };
  }
  const lots = await prisma.lot.findMany({
    where,
    include: { product: { select: { id: true, sku: true, name: true } } },
    orderBy: { expiryDate: 'asc' },
  });
  res.json(lots);
});

// FIFO inventory valuation
router.get('/valuation', async (req, res) => {
  const { warehouseId, productId } = req.query;
  const result = await getInventoryValuation({ warehouseId, productId });
  res.json(result);
});

// Recent stock movements
router.get('/movements', async (req, res) => {
  const { productId, warehouseId, limit = 50 } = req.query;
  const where = {};
  if (productId) where.productId = productId;
  if (warehouseId) where.warehouseId = warehouseId;
  const movements = await prisma.stockMovement.findMany({
    where,
    take: Number(limit),
    orderBy: { createdAt: 'desc' },
    include: {
      product: { select: { id: true, sku: true, name: true } },
      warehouse: { select: { id: true, code: true } },
      lot: { select: { id: true, lotNumber: true } },
    },
  });
  res.json(movements);
});

module.exports = router;
