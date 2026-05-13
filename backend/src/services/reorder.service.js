// Section 7 — Reorder recommendation service.
// Persists ReorderRecommendation rows when stock falls at/below reorderPoint.
// Optionally augments suggested qty using forecasted demand over the supplier lead-time + horizon.

const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

function urgencyFor(totalOnHand, reorderPoint) {
  if (totalOnHand <= 0) return 'CRITICAL';
  if (totalOnHand < reorderPoint / 4) return 'HIGH';
  if (totalOnHand < reorderPoint / 2) return 'MEDIUM';
  return 'LOW';
}

async function generateReorderRecommendations({ actorId = null, useForecast = false, sourceIp = null } = {}) {
  const stockLevels = await prisma.stockLevel.findMany({
    include: {
      product: {
        include: {
          supplierProducts: { orderBy: { priority: 'asc' }, take: 1, include: { supplier: true } },
        },
      },
    },
  });

  // Aggregate on-hand per product across all warehouses.
  const byProduct = new Map();
  for (const sl of stockLevels) {
    if (!sl.product?.isActive || sl.product.reorderPoint == null) continue;
    const cur = byProduct.get(sl.productId) || { product: sl.product, totalOnHand: 0 };
    cur.totalOnHand += sl.onHand;
    byProduct.set(sl.productId, cur);
  }

  // Latest forecast per product (today).
  let forecastByProduct = new Map();
  if (useForecast) {
    const productIds = [...byProduct.keys()];
    if (productIds.length) {
      const forecasts = await prisma.forecast.findMany({
        where: { productId: { in: productIds } },
        orderBy: { periodStart: 'desc' },
      });
      for (const f of forecasts) {
        if (!forecastByProduct.has(f.productId)) forecastByProduct.set(f.productId, f);
      }
    }
  }

  const existingPending = await prisma.reorderRecommendation.findMany({ where: { status: 'PENDING' } });
  const pendingByProduct = new Set(existingPending.map((r) => r.productId));

  let created = 0;
  let updated = 0;
  for (const [productId, { product, totalOnHand }] of byProduct.entries()) {
    if (totalOnHand > product.reorderPoint) continue;

    const supplierLink = product.supplierProducts?.[0];
    const leadTimeDays = supplierLink?.supplier?.leadTimeDays || supplierLink?.leadTimeDays || 14;
    const shortfall = product.reorderPoint - totalOnHand;
    const forecast = forecastByProduct.get(productId) || null;

    // Suggested qty: max(reorderQty, expected demand over leadTime + safety horizon).
    let suggestedQty = product.reorderQty || shortfall;
    let forecastNote = null;
    if (forecast && forecast.horizonDays > 0) {
      const dailyDemand = forecast.predictedQty / forecast.horizonDays;
      const coverDays = leadTimeDays + 14; // lead time + 2-week safety buffer
      const forecastQty = Math.ceil(dailyDemand * coverDays);
      if (forecastQty > suggestedQty) {
        suggestedQty = forecastQty;
        forecastNote = `Forecast: ${forecast.predictedQty} units/${forecast.horizonDays}d (${forecast.modelUsed}); cover=${coverDays}d`;
      }
    }

    const urgency = urgencyFor(totalOnHand, product.reorderPoint);
    const reasoning = {
      totalOnHand,
      reorderPoint: product.reorderPoint,
      shortfall,
      reorderQty: product.reorderQty || null,
      supplierName: supplierLink?.supplier?.name || null,
      leadTimeDays,
      forecast: forecast ? {
        predictedQty: forecast.predictedQty,
        horizonDays: forecast.horizonDays,
        model: forecast.modelUsed,
        mape: forecast.mape,
      } : null,
      forecastNote,
    };

    if (pendingByProduct.has(productId)) {
      const existing = existingPending.find((r) => r.productId === productId);
      if (existing && (existing.suggestedQty !== suggestedQty || existing.urgency !== urgency)) {
        await prisma.reorderRecommendation.update({
          where: { id: existing.id },
          data: { suggestedQty, urgency, reasoning },
        });
        updated += 1;
      }
      continue;
    }

    await prisma.reorderRecommendation.create({
      data: {
        productId,
        suggestedQty,
        targetSupplierId: supplierLink?.supplierId || null,
        urgency,
        reasoning,
        status: 'PENDING',
      },
    });
    created += 1;
  }

  await logEvent({
    eventType: 'REORDER_GENERATED',
    entityType: 'ReorderRecommendation',
    entityId: 'batch',
    actorId,
    payload: { created, updated, useForecast },
    sourceIp,
  });
  return { created, updated, useForecast };
}

module.exports = { generateReorderRecommendations };
