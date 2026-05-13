// Section 7 — Forecasting service.
// Two simple models implemented in-process (no ML dependency):
//   - MOVING_AVG (default) — window=14 days
//   - EXP_SMOOTH — single exponential smoothing, alpha=0.3
// Confidence band: ±30% (predicted * 0.7 / 1.3).
// MAPE back-test: split last 14d as test, train on prior, compute |actual-pred|/actual.

const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const DEFAULT_WINDOW = 14;
const DEFAULT_HORIZON = 30;
const DEFAULT_ALPHA = 0.3;
const CONF_LOW = 0.7;
const CONF_HIGH = 1.3;

function startOfDay(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x;
}

// Build per-day OUT (shipment) qty series for the trailing `days` days, ending today (UTC).
function buildDailySeries(movements, days) {
  const today = startOfDay(new Date());
  const series = new Array(days).fill(0);
  for (const m of movements) {
    const d = startOfDay(m.createdAt);
    const idx = days - 1 - Math.round((today.getTime() - d.getTime()) / 86400000);
    if (idx < 0 || idx >= days) continue;
    series[idx] += Math.abs(m.qty);
  }
  return series;
}

function movingAverage(series, window) {
  if (!series.length) return 0;
  const slice = series.slice(-window);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function expSmooth(series, alpha) {
  if (!series.length) return 0;
  let s = series[0];
  for (let i = 1; i < series.length; i += 1) {
    s = alpha * series[i] + (1 - alpha) * s;
  }
  return s;
}

// Returns MAPE across a hold-out window (last `testLen` days vs forecast from prior series).
function backtest(series, model) {
  const testLen = Math.min(7, Math.floor(series.length / 4));
  if (testLen < 2) return null;
  const train = series.slice(0, series.length - testLen);
  const test = series.slice(series.length - testLen);
  const predDaily = model === 'EXP_SMOOTH' ? expSmooth(train, DEFAULT_ALPHA) : movingAverage(train, DEFAULT_WINDOW);
  let errs = 0;
  let n = 0;
  for (const actual of test) {
    if (actual <= 0) continue;
    errs += Math.abs(actual - predDaily) / actual;
    n += 1;
  }
  return n > 0 ? errs / n : null;
}

async function forecastProduct(productId, { warehouseId = null, model = 'MOVING_AVG', horizonDays = DEFAULT_HORIZON } = {}) {
  const since = new Date(Date.now() - 60 * 86400000);
  const where = {
    productId,
    direction: 'OUT',
    reasonCode: { in: ['SHIPMENT', 'SCRAP'] },
    createdAt: { gte: since },
  };
  if (warehouseId) where.warehouseId = warehouseId;

  const movements = await prisma.stockMovement.findMany({
    where,
    select: { qty: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  const series = buildDailySeries(movements, 60);

  const dailyPred = model === 'EXP_SMOOTH' ? expSmooth(series, DEFAULT_ALPHA) : movingAverage(series, DEFAULT_WINDOW);
  const predictedQty = Math.round(dailyPred * horizonDays);
  const mape = backtest(series, model);

  return {
    productId,
    warehouseId,
    modelUsed: model,
    dailyPred,
    predictedQty,
    confidenceLow: Math.max(0, Math.round(predictedQty * CONF_LOW)),
    confidenceHigh: Math.round(predictedQty * CONF_HIGH),
    mape,
    sampleSize: movements.length,
  };
}

async function generateForecasts({ model = 'MOVING_AVG', horizonDays = DEFAULT_HORIZON, actorId = null } = {}) {
  const products = await prisma.product.findMany({ where: { isActive: true }, select: { id: true } });
  const today = startOfDay(new Date());
  const summary = { total: products.length, written: 0, skipped: 0 };

  for (const p of products) {
    try {
      const f = await forecastProduct(p.id, { model, horizonDays });
      if (f.sampleSize === 0) {
        summary.skipped += 1;
        continue;
      }
      const existing = await prisma.forecast.findFirst({
        where: { productId: p.id, warehouseId: null, periodStart: today },
        select: { id: true },
      });
      if (existing) {
        await prisma.forecast.update({
          where: { id: existing.id },
          data: {
            horizonDays,
            predictedQty: f.predictedQty,
            confidenceLow: f.confidenceLow,
            confidenceHigh: f.confidenceHigh,
            modelUsed: f.modelUsed,
            mape: f.mape,
          },
        });
      } else {
        await prisma.forecast.create({
          data: {
            productId: p.id,
            warehouseId: null,
            periodStart: today,
            horizonDays,
            predictedQty: f.predictedQty,
            confidenceLow: f.confidenceLow,
            confidenceHigh: f.confidenceHigh,
            modelUsed: f.modelUsed,
            mape: f.mape,
          },
        });
      }
      summary.written += 1;
    } catch (e) {
      summary.skipped += 1;
    }
  }

  await logEvent({ eventType: 'FORECASTS_GENERATED', entityType: 'Forecast', entityId: 'batch', actorId, payload: summary });
  return summary;
}

async function listForecasts({ productId, limit = 100 } = {}) {
  const where = {};
  if (productId) where.productId = productId;
  return prisma.forecast.findMany({
    where,
    orderBy: { periodStart: 'desc' },
    take: Math.min(Number(limit) || 100, 500),
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
}

module.exports = {
  DEFAULT_WINDOW,
  DEFAULT_HORIZON,
  DEFAULT_ALPHA,
  forecastProduct,
  generateForecasts,
  listForecasts,
  movingAverage,
  expSmooth,
};
