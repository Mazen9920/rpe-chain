// Tier 3 — Phase B: ABC/XYZ classification + dynamic reorder point.
//
// ABC (revenue-Pareto over 90 days):
//   A = top 80% of cumulative revenue
//   B = next 15% (80–95%)
//   C = remaining 5% (95–100%) — also catches zero-revenue SKUs
//
// XYZ (demand variability, coefficient of variation over 90 days):
//   X = CoV < 0.5  (stable)
//   Y = 0.5 ≤ CoV < 1.0 (variable)
//   Z = CoV ≥ 1.0 or no demand (erratic)
//
// Dynamic ROP:
//   avgDailyDemand × leadTimeDays + safetyStock
//   safetyStock = serviceFactor × stdDailyDemand × √leadTimeDays
//   serviceFactor by ABC: A=2.33 (99%), B=1.96 (97.5%), C=1.65 (95%)
//   Product.reorderPoint is auto-updated only when |new − old| / max(old, 1) > 10%.
//   Every change emits an EventLog row for audit.

const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const SERVICE_FACTOR = { A: 2.33, B: 1.96, C: 1.65 };
const ABC_THRESHOLDS = { A: 0.80, B: 0.95 }; // cumulative revenue cutoffs
const XYZ_THRESHOLDS = { X: 0.5, Y: 1.0 };   // CoV cutoffs
const ROP_DELTA_THRESHOLD = 0.10;            // 10% drift triggers an update

function dateKey(d) {
  const x = new Date(d);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}

// Internal: build per-product { revenue90, dailyDemand[90] } from shipped SO lines.
async function loadDemandStats({ days = 90 } = {}) {
  const since = new Date(Date.now() - days * 86400000);
  since.setUTCHours(0, 0, 0, 0);

  const lines = await prisma.salesOrderLine.findMany({
    where: { salesOrder: { shippedAt: { gte: since } } },
    select: {
      productId: true,
      qty: true,
      unitPrice: true,
      salesOrder: { select: { shippedAt: true } },
    },
  });

  const dayList = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(since.getTime() + (days - 1 - i) * 86400000);
    dayList.push(dateKey(d));
  }

  const stats = new Map(); // productId -> { revenue, dailyByKey: Map }
  for (const ln of lines) {
    let s = stats.get(ln.productId);
    if (!s) { s = { revenue: 0, dailyByKey: new Map() }; stats.set(ln.productId, s); }
    const qty = Number(ln.qty);
    const price = Number(ln.unitPrice);
    if (qty <= 0) continue;
    s.revenue += qty * price;
    const k = dateKey(ln.salesOrder.shippedAt);
    s.dailyByKey.set(k, (s.dailyByKey.get(k) || 0) + qty);
  }

  const finalStats = new Map();
  for (const [productId, s] of stats) {
    const daily = dayList.map((k) => s.dailyByKey.get(k) || 0);
    finalStats.set(productId, { revenue: s.revenue, daily });
  }
  return finalStats;
}

function classifyXyz(daily) {
  if (!daily || daily.length === 0) return { xyz: 'Z', mean: 0, std: 0, cov: null };
  const nonZeroCount = daily.filter((x) => x > 0).length;
  if (nonZeroCount === 0) return { xyz: 'Z', mean: 0, std: 0, cov: null };
  const mean = daily.reduce((a, b) => a + b, 0) / daily.length;
  const variance = daily.reduce((a, v) => a + (v - mean) ** 2, 0) / daily.length;
  const std = Math.sqrt(variance);
  const cov = mean > 0 ? std / mean : Infinity;
  let xyz;
  if (cov < XYZ_THRESHOLDS.X) xyz = 'X';
  else if (cov < XYZ_THRESHOLDS.Y) xyz = 'Y';
  else xyz = 'Z';
  return { xyz, mean, std, cov };
}

function computeDynamicRop({ mean, std, leadTimeDays, abc }) {
  if (!leadTimeDays || leadTimeDays <= 0) return null;
  const factor = SERVICE_FACTOR[abc] ?? SERVICE_FACTOR.C;
  const cycleStock = mean * leadTimeDays;
  const safetyStock = factor * std * Math.sqrt(leadTimeDays);
  return Math.max(0, Math.ceil(cycleStock + safetyStock));
}

async function runClassification({ actorId = null, sourceIp = null, dryRun = false } = {}) {
  const products = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true, sku: true, name: true, reorderPoint: true, abcClass: true, xyzClass: true,
      supplierProducts: {
        orderBy: { priority: 'asc' }, take: 1,
        select: { leadTimeDays: true, supplier: { select: { leadTimeDays: true } } },
      },
    },
  });

  const stats = await loadDemandStats({ days: 90 });

  // ABC step: rank products by revenue desc, assign letters by cumulative %.
  const ranked = products.map((p) => ({
    id: p.id,
    revenue: stats.get(p.id)?.revenue || 0,
  })).sort((a, b) => b.revenue - a.revenue);
  const totalRevenue = ranked.reduce((a, r) => a + r.revenue, 0);
  const abcById = new Map();
  if (totalRevenue <= 0) {
    for (const r of ranked) abcById.set(r.id, 'C');
  } else {
    let cum = 0;
    for (const r of ranked) {
      cum += r.revenue;
      const pct = cum / totalRevenue;
      let cls;
      if (r.revenue === 0) cls = 'C';
      else if (pct <= ABC_THRESHOLDS.A) cls = 'A';
      else if (pct <= ABC_THRESHOLDS.B) cls = 'B';
      else cls = 'C';
      abcById.set(r.id, cls);
    }
  }

  const summary = {
    total: products.length,
    classified: 0,
    classChanges: 0,
    ropUpdates: 0,
    distribution: {},
    skipped: 0,
    dryRun,
  };

  const writes = [];
  for (const p of products) {
    const s = stats.get(p.id);
    const daily = s?.daily || [];
    const { xyz, mean, std } = classifyXyz(daily);
    const abc = abcById.get(p.id) || 'C';

    const supplierLink = p.supplierProducts?.[0];
    const leadTimeDays = supplierLink?.leadTimeDays || supplierLink?.supplier?.leadTimeDays || 14;

    const dynamicRop = computeDynamicRop({ mean, std, leadTimeDays, abc });

    const matrixKey = `${abc}${xyz}`;
    summary.distribution[matrixKey] = (summary.distribution[matrixKey] || 0) + 1;

    const classChanged = p.abcClass !== abc || p.xyzClass !== xyz;
    const oldRop = Number(p.reorderPoint || 0);
    const newRop = dynamicRop ?? oldRop;
    const ropDelta = Math.abs(newRop - oldRop) / Math.max(oldRop, 1);
    const shouldUpdateRop = dynamicRop != null && ropDelta > ROP_DELTA_THRESHOLD;

    if (!dryRun && (classChanged || shouldUpdateRop)) {
      const data = {};
      if (classChanged) { data.abcClass = abc; data.xyzClass = xyz; summary.classChanges += 1; }
      if (shouldUpdateRop) { data.reorderPoint = newRop; summary.ropUpdates += 1; }
      writes.push(
        prisma.product.update({ where: { id: p.id }, data })
          .then(() => logEvent({
            eventType: 'PRODUCT_CLASSIFICATION_UPDATED',
            entityType: 'Product',
            entityId: p.id,
            actorId,
            sourceIp,
            payload: {
              sku: p.sku,
              abc: { from: p.abcClass, to: abc },
              xyz: { from: p.xyzClass, to: xyz },
              rop: { from: oldRop, to: shouldUpdateRop ? newRop : oldRop, changed: shouldUpdateRop },
              demand: { mean: Number(mean.toFixed(2)), std: Number(std.toFixed(2)), leadTimeDays },
            },
          })),
      );
    }
    summary.classified += 1;
  }

  await Promise.all(writes);

  await logEvent({
    eventType: 'PRODUCT_CLASSIFICATION_RUN',
    entityType: 'Product',
    entityId: 'all',
    actorId,
    sourceIp,
    payload: summary,
  });

  return summary;
}

// 3×3 ABC×XYZ matrix with product counts + on-hand stock value.
async function getClassificationMatrix() {
  const products = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null },
    select: {
      id: true, abcClass: true, xyzClass: true, costPrice: true,
      stockLevels: { select: { onHand: true } },
    },
  });

  const matrix = {};
  const letters = ['A', 'B', 'C'];
  const numbers = ['X', 'Y', 'Z'];
  for (const a of letters) {
    matrix[a] = {};
    for (const x of numbers) matrix[a][x] = { count: 0, onHandValue: 0 };
  }
  matrix.unclassified = { count: 0, onHandValue: 0 };

  for (const p of products) {
    const onHand = (p.stockLevels || []).reduce((a, sl) => a + sl.onHand, 0);
    const value = onHand * Number(p.costPrice || 0);
    const a = letters.includes(p.abcClass) ? p.abcClass : null;
    const x = numbers.includes(p.xyzClass) ? p.xyzClass : null;
    if (!a || !x) {
      matrix.unclassified.count += 1;
      matrix.unclassified.onHandValue += value;
    } else {
      matrix[a][x].count += 1;
      matrix[a][x].onHandValue += value;
    }
  }

  // Round values.
  for (const a of letters) {
    for (const x of numbers) {
      matrix[a][x].onHandValue = Number(matrix[a][x].onHandValue.toFixed(2));
    }
  }
  matrix.unclassified.onHandValue = Number(matrix.unclassified.onHandValue.toFixed(2));

  return { matrix, totalProducts: products.length };
}

// Paged per-product classification list (for the matrix drilldown).
async function listClassifiedProducts({ abc, xyz, limit = 100, offset = 0 } = {}) {
  const where = { isActive: true, deletedAt: null };
  if (abc) where.abcClass = abc;
  if (xyz) where.xyzClass = xyz;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      take: Math.min(Number(limit) || 100, 500),
      skip: Number(offset) || 0,
      orderBy: [{ abcClass: 'asc' }, { xyzClass: 'asc' }, { sku: 'asc' }],
      select: {
        id: true, sku: true, name: true,
        abcClass: true, xyzClass: true, reorderPoint: true, reorderQty: true,
        stockLevels: { select: { onHand: true } },
      },
    }),
    prisma.product.count({ where }),
  ]);

  return {
    total,
    rows: products.map((p) => ({
      id: p.id, sku: p.sku, name: p.name,
      abcClass: p.abcClass, xyzClass: p.xyzClass,
      reorderPoint: p.reorderPoint, reorderQty: p.reorderQty,
      onHand: (p.stockLevels || []).reduce((a, sl) => a + sl.onHand, 0),
    })),
  };
}

module.exports = {
  runClassification,
  getClassificationMatrix,
  listClassifiedProducts,
  // exported for unit-test access:
  classifyXyz,
  computeDynamicRop,
};
