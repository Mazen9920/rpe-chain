const prisma = require('../lib/prisma');
const { getInventoryValuation } = require('../services/fifo.service');

async function summary(_req, res) {
  const [
    totalProducts,
    totalSuppliers,
    pendingPOs,
    activeShipments,
    openAlerts,
    valuation,
    recentMovements,
    lowStockCount,
  ] = await Promise.all([
    prisma.product.count({ where: { isActive: true, deletedAt: null } }),
    prisma.supplier.count({ where: { isActive: true, deletedAt: null } }),
    prisma.purchaseOrder.count({
      where: { status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } },
    }),
    prisma.shipment.count({
      where: { status: { in: ['PENDING', 'IN_TRANSIT', 'OUT_FOR_DELIVERY'] } },
    }),
    prisma.alert.count({ where: { status: 'OPEN' } }),
    getInventoryValuation(),
    prisma.stockMovement.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, sku: true, name: true } },
        warehouse: { select: { id: true, code: true } },
      },
    }),
    prisma.product
      .findMany({ where: { isActive: true, deletedAt: null }, include: { stockLevels: true } })
      .then(
        (ps) =>
          ps.filter(
            (p) =>
              p.stockLevels.reduce((s, sl) => s + sl.onHand - sl.reserved, 0) <= p.reorderPoint
          ).length
      ),
  ]);

  res.json({
    totalProducts,
    lowStockProducts: lowStockCount,
    totalSuppliers,
    pendingPOs,
    activeShipments,
    openAlerts,
    inventoryValuation: valuation.totalValue,
    activeCostLayers: valuation.layerCount,
    recentMovements,
  });
}

module.exports = { summary };
