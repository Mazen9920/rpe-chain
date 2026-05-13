/**
 * Lot number generator.
 * Format: `${warehouse.lotPrefix||warehouse.code}-YYYYMMDD-####`
 * The 4-digit sequence is per-warehouse-per-day; resets each calendar day in
 * the server's local timezone. User-supplied lot numbers always win and are
 * validated for uniqueness by the caller.
 */
const prisma = require('../lib/prisma');

function pad(n, w = 4) {
  return String(n).padStart(w, '0');
}

function todayBounds(now = new Date()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * Generate a fresh lot number for a warehouse.
 * @param {string} warehouseId
 * @param {object} [tx] - Prisma transaction client (recommended for atomicity)
 * @returns {Promise<string>}
 */
async function generateLotNumber(warehouseId, tx) {
  const client = tx || prisma;
  const wh = await client.warehouse.findUnique({
    where: { id: warehouseId },
    select: { id: true, code: true, lotPrefix: true },
  });
  if (!wh) {
    const err = new Error(`Warehouse ${warehouseId} not found`);
    err.status = 404;
    throw err;
  }
  const prefix = (wh.lotPrefix || wh.code).toUpperCase().replace(/\s+/g, '');
  const now = new Date();
  const { start, end } = todayBounds(now);
  // Count lots created today linked to this warehouse via any of their cost layers
  // OR via a stock movement (the most reliable hook). Simpler: count lots that
  // already have today's date prefix in their lotNumber for this warehouse.
  const datePart = ymd(now);
  const samePrefix = `${prefix}-${datePart}-`;
  const taken = await client.lot.count({
    where: {
      lotNumber: { startsWith: samePrefix },
      receivedDate: { gte: start, lt: end },
    },
  });
  let seq = taken + 1;
  // Guard against rare collisions (parallel transactions) by probing.
  // Bound the loop so we never spin forever.
  for (let i = 0; i < 50; i++) {
    const candidate = `${samePrefix}${pad(seq)}`;
    const clash = await client.lot.findUnique({ where: { lotNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
    seq += 1;
  }
  // Final fallback: append timestamp suffix.
  return `${samePrefix}${pad(seq)}-${Date.now().toString().slice(-4)}`;
}

module.exports = { generateLotNumber };
