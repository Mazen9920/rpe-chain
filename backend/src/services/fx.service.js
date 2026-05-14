// FX rate service — append-only registry with historical lookup, inverse, and USD-pivot.
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const PIVOT = 'USD';

class FxRateNotFound extends Error {
  constructor(from, to, at) {
    super(`No FX rate available for ${from}→${to} at ${at?.toISOString?.() || at}`);
    this.code = 'FX_RATE_NOT_FOUND';
    this.status = 400;
  }
}

// Lookup most-recent direct rate ≤ at; returns Decimal-as-Number or null.
async function lookupDirect(from, to, at, tx = prisma) {
  const row = await tx.fxRate.findFirst({
    where: {
      baseCurrency: from,
      quoteCurrency: to,
      effectiveAt: { lte: at },
    },
    orderBy: { effectiveAt: 'desc' },
  });
  return row ? Number(row.rate) : null;
}

/**
 * Resolve from→to rate at `at`. Tries: direct, inverse, then USD-pivot.
 * Returns 1 when from===to.
 */
async function getRate(from, to, at = new Date(), tx = prisma) {
  if (!from || !to) throw new FxRateNotFound(from, to, at);
  const F = String(from).toUpperCase();
  const T = String(to).toUpperCase();
  if (F === T) return 1;

  const atDate = at instanceof Date ? at : new Date(at);

  const direct = await lookupDirect(F, T, atDate, tx);
  if (direct != null) return direct;

  const inverse = await lookupDirect(T, F, atDate, tx);
  if (inverse != null && inverse !== 0) return 1 / inverse;

  if (F !== PIVOT && T !== PIVOT) {
    const fToPivot =
      (await lookupDirect(F, PIVOT, atDate, tx)) ??
      ((await lookupDirect(PIVOT, F, atDate, tx)) ? 1 / (await lookupDirect(PIVOT, F, atDate, tx)) : null);
    const pivotToT =
      (await lookupDirect(PIVOT, T, atDate, tx)) ??
      ((await lookupDirect(T, PIVOT, atDate, tx)) ? 1 / (await lookupDirect(T, PIVOT, atDate, tx)) : null);
    if (fToPivot != null && pivotToT != null) return fToPivot * pivotToT;
  }

  throw new FxRateNotFound(F, T, atDate);
}

async function convert(amount, from, to, at = new Date(), tx = prisma) {
  const r = await getRate(from, to, at, tx);
  return Number(amount) * r;
}

async function recordRate({ baseCurrency, quoteCurrency, rate, effectiveAt, source = 'manual', actorId = null, sourceIp = null }) {
  const base = String(baseCurrency || '').toUpperCase();
  const quote = String(quoteCurrency || '').toUpperCase();
  const r = Number(rate);
  if (!/^[A-Z]{3}$/.test(base) || !/^[A-Z]{3}$/.test(quote)) {
    const e = new Error('baseCurrency and quoteCurrency must be 3-letter ISO codes');
    e.status = 400;
    throw e;
  }
  if (base === quote) {
    const e = new Error('baseCurrency and quoteCurrency must differ');
    e.status = 400;
    throw e;
  }
  if (!Number.isFinite(r) || r <= 0) {
    const e = new Error('rate must be a positive number');
    e.status = 400;
    throw e;
  }
  const at = effectiveAt ? new Date(effectiveAt) : new Date();
  if (Number.isNaN(at.getTime())) {
    const e = new Error('effectiveAt must be a valid date');
    e.status = 400;
    throw e;
  }

  const row = await prisma.fxRate.create({
    data: { baseCurrency: base, quoteCurrency: quote, rate: r, effectiveAt: at, source, createdById: actorId },
  });

  await logEvent({
    eventType: 'FX_RATE_RECORDED',
    entityType: 'FxRate',
    entityId: row.id,
    actorId,
    sourceIp,
    payload: { baseCurrency: base, quoteCurrency: quote, rate: r, effectiveAt: at.toISOString(), source },
  });

  return row;
}

async function listRates({ base, quote, limit = 50 } = {}) {
  const where = {};
  if (base) where.baseCurrency = String(base).toUpperCase();
  if (quote) where.quoteCurrency = String(quote).toUpperCase();
  const rows = await prisma.fxRate.findMany({
    where,
    orderBy: { effectiveAt: 'desc' },
    take: Math.min(Number(limit) || 50, 500),
  });
  return rows.map((r) => ({
    id: r.id,
    baseCurrency: r.baseCurrency,
    quoteCurrency: r.quoteCurrency,
    rate: Number(r.rate),
    effectiveAt: r.effectiveAt,
    source: r.source,
    createdAt: r.createdAt,
    createdById: r.createdById,
  }));
}

module.exports = { getRate, convert, recordRate, listRates, FxRateNotFound, PIVOT };
