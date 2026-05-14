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

function buildEmptyDays(days) {
  const out = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(today.getTime() - i * 86400000);
    out.push({ date: d.toISOString().slice(0, 10), value: 0 });
  }
  return out;
}

function dateKey(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

async function salesTrend(req, res) {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const orders = await prisma.salesOrder.findMany({
    where: { orderedAt: { gte: since } },
    select: { orderedAt: true, totalAmount: true, status: true },
  });
  const revenueByDay = Object.fromEntries(buildEmptyDays(days).map((d) => [d.date, 0]));
  const countByDay = Object.fromEntries(buildEmptyDays(days).map((d) => [d.date, 0]));
  for (const o of orders) {
    const k = dateKey(o.orderedAt);
    if (revenueByDay[k] != null) {
      revenueByDay[k] += Number(o.totalAmount);
      countByDay[k] += 1;
    }
  }
  res.json({
    days,
    series: Object.entries(revenueByDay).map(([date, revenue]) => ({
      date,
      revenue: Number(revenue.toFixed(2)),
      orderCount: countByDay[date],
    })),
  });
}

async function inventoryTrend(req, res) {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const movements = await prisma.stockMovement.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, qty: true, direction: true },
  });
  const inByDay = Object.fromEntries(buildEmptyDays(days).map((d) => [d.date, 0]));
  const outByDay = Object.fromEntries(buildEmptyDays(days).map((d) => [d.date, 0]));
  for (const m of movements) {
    const k = dateKey(m.createdAt);
    if (inByDay[k] == null) continue;
    if (m.direction === 'IN') inByDay[k] += Math.abs(m.qty);
    else if (m.direction === 'OUT') outByDay[k] += Math.abs(m.qty);
  }
  res.json({
    days,
    series: Object.keys(inByDay).map((date) => ({
      date,
      inQty: inByDay[date],
      outQty: outByDay[date],
      netQty: inByDay[date] - outByDay[date],
    })),
  });
}

async function alertsTrend(req, res) {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const alerts = await prisma.alert.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, severity: true },
  });
  const empty = buildEmptyDays(days);
  const buckets = Object.fromEntries(empty.map((d) => [d.date, { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }]));
  for (const a of alerts) {
    const k = dateKey(a.createdAt);
    if (buckets[k]) buckets[k][a.severity] = (buckets[k][a.severity] || 0) + 1;
  }
  res.json({
    days,
    series: Object.entries(buckets).map(([date, sev]) => ({ date, ...sev, total: sev.CRITICAL + sev.HIGH + sev.MEDIUM + sev.LOW })),
  });
}

// ─── Margin trend ────────────────────────────────────────────────────────────
// Per-day weighted realized margin: Σ(qty * (unitPrice - costPrice)) / Σ(qty * unitPrice).
async function marginTrend(req, res) {
  const days = Math.min(Math.max(Number(req.query.days) || 30, 7), 180);
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrder: { shippedAt: { gte: since } } },
    select: {
      qty: true, unitPrice: true,
      salesOrder: { select: { shippedAt: true } },
      product: { select: { costPrice: true } },
    },
  });

  const revenueByDay = Object.fromEntries(buildEmptyDays(days).map((d) => [d.date, 0]));
  const profitByDay = Object.fromEntries(buildEmptyDays(days).map((d) => [d.date, 0]));
  for (const ln of lines) {
    if (!ln.product || ln.product.costPrice == null) continue;
    const k = dateKey(ln.salesOrder.shippedAt);
    if (revenueByDay[k] == null) continue;
    const qty = Number(ln.qty);
    const price = Number(ln.unitPrice);
    const cost = Number(ln.product.costPrice);
    if (qty <= 0 || price <= 0) continue;
    revenueByDay[k] += qty * price;
    profitByDay[k] += qty * (price - cost);
  }
  res.json({
    days,
    series: Object.keys(revenueByDay).map((date) => {
      const rev = revenueByDay[date];
      const profit = profitByDay[date];
      return {
        date,
        revenue: Number(rev.toFixed(2)),
        profit: Number(profit.toFixed(2)),
        marginPct: rev > 0 ? Number(((profit / rev) * 100).toFixed(2)) : null,
      };
    }),
  });
}

module.exports = { summary, salesTrend, inventoryTrend, alertsTrend, marginTrend };
