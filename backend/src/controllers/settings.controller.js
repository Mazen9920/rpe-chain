const prisma = require('../lib/prisma');
const { logEvent } = require('../services/audit.service');
const {
  resolveTolerances,
  DEFAULT_QTY_TOLERANCE_PCT,
  DEFAULT_PRICE_TOLERANCE_PCT,
  MIN_PCT,
  MAX_PCT,
} = require('../services/threeWayMatch.service');

function validatePct(v, field) {
  const n = Number(v);
  if (Number.isNaN(n) || n < MIN_PCT || n > MAX_PCT) {
    return { error: `${field} must be a number between ${MIN_PCT} and ${MAX_PCT}` };
  }
  return { value: n };
}

async function getMatchTolerances(_req, res) {
  const rules = await prisma.alertRule.findMany({
    where: { type: { in: ['MATCH_QTY_TOLERANCE_PCT', 'MATCH_PRICE_TOLERANCE_PCT'] } },
  });
  const ruleMap = {};
  for (const r of rules) {
    const pct = r.params && typeof r.params === 'object' ? Number(r.params.pct) : NaN;
    if (!Number.isNaN(pct)) ruleMap[r.type] = pct;
  }

  const suppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { qtyTolerancePct: { not: null } },
        { priceTolerancePct: { not: null } },
      ],
      isActive: true,
    },
    select: { id: true, code: true, name: true, qtyTolerancePct: true, priceTolerancePct: true },
    orderBy: { code: 'asc' },
  });

  res.json({
    global: {
      qtyPct: ruleMap.MATCH_QTY_TOLERANCE_PCT != null ? ruleMap.MATCH_QTY_TOLERANCE_PCT : DEFAULT_QTY_TOLERANCE_PCT,
      pricePct: ruleMap.MATCH_PRICE_TOLERANCE_PCT != null ? ruleMap.MATCH_PRICE_TOLERANCE_PCT : DEFAULT_PRICE_TOLERANCE_PCT,
      qtySource: ruleMap.MATCH_QTY_TOLERANCE_PCT != null ? 'global' : 'default',
      priceSource: ruleMap.MATCH_PRICE_TOLERANCE_PCT != null ? 'global' : 'default',
    },
    overrides: suppliers.map((s) => ({
      supplierId: s.id,
      supplierCode: s.code,
      supplierName: s.name,
      qtyPct: s.qtyTolerancePct != null ? Number(s.qtyTolerancePct) : null,
      pricePct: s.priceTolerancePct != null ? Number(s.priceTolerancePct) : null,
    })),
    bounds: { min: MIN_PCT, max: MAX_PCT },
  });
}

async function updateGlobalMatchTolerances(req, res) {
  const { qtyPct, pricePct } = req.body || {};
  if (qtyPct == null && pricePct == null) {
    return res.status(400).json({ error: 'qtyPct or pricePct required' });
  }
  const out = {};
  if (qtyPct != null) {
    const r = validatePct(qtyPct, 'qtyPct');
    if (r.error) return res.status(400).json({ error: r.error });
    await prisma.alertRule.upsert({
      where: { type: 'MATCH_QTY_TOLERANCE_PCT' },
      update: { params: { pct: r.value } },
      create: { type: 'MATCH_QTY_TOLERANCE_PCT', params: { pct: r.value }, enabled: true },
    });
    out.qtyPct = r.value;
  }
  if (pricePct != null) {
    const r = validatePct(pricePct, 'pricePct');
    if (r.error) return res.status(400).json({ error: r.error });
    await prisma.alertRule.upsert({
      where: { type: 'MATCH_PRICE_TOLERANCE_PCT' },
      update: { params: { pct: r.value } },
      create: { type: 'MATCH_PRICE_TOLERANCE_PCT', params: { pct: r.value }, enabled: true },
    });
    out.pricePct = r.value;
  }
  await logEvent({
    eventType: 'MATCH_TOLERANCES_GLOBAL_UPDATED',
    entityType: 'AlertRule',
    entityId: 'match-tolerances',
    actorId: req.user?.id,
    sourceIp: req.ip,
    payload: out,
  });
  res.json(out);
}

async function updateSupplierMatchTolerances(req, res) {
  const { id } = req.params;
  const { qtyPct, pricePct } = req.body || {};
  const data = {};
  if (qtyPct === null) data.qtyTolerancePct = null;
  else if (qtyPct !== undefined) {
    const r = validatePct(qtyPct, 'qtyPct');
    if (r.error) return res.status(400).json({ error: r.error });
    data.qtyTolerancePct = r.value;
  }
  if (pricePct === null) data.priceTolerancePct = null;
  else if (pricePct !== undefined) {
    const r = validatePct(pricePct, 'pricePct');
    if (r.error) return res.status(400).json({ error: r.error });
    data.priceTolerancePct = r.value;
  }

  if (Object.keys(data).length === 0) {
    return res.status(400).json({ error: 'qtyPct or pricePct required (use null to clear override)' });
  }

  const supplier = await prisma.supplier.update({
    where: { id },
    data,
    select: { id: true, code: true, name: true, qtyTolerancePct: true, priceTolerancePct: true },
  });

  await logEvent({
    eventType: 'MATCH_TOLERANCES_SUPPLIER_UPDATED',
    entityType: 'Supplier',
    entityId: id,
    actorId: req.user?.id,
    sourceIp: req.ip,
    payload: data,
  });

  res.json({
    supplierId: supplier.id,
    supplierCode: supplier.code,
    supplierName: supplier.name,
    qtyPct: supplier.qtyTolerancePct != null ? Number(supplier.qtyTolerancePct) : null,
    pricePct: supplier.priceTolerancePct != null ? Number(supplier.priceTolerancePct) : null,
  });
}

module.exports = {
  getMatchTolerances,
  updateGlobalMatchTolerances,
  updateSupplierMatchTolerances,
  resolveTolerances,
};
