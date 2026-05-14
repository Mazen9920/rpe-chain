/**
 * Three-way match service — Section 5.
 * Compares invoice lines against PO line (unit price) and GRN line (quantity).
 * Tolerances resolve per-supplier first, then global AlertRule, then hardcoded defaults.
 */
const DEFAULT_QTY_TOLERANCE_PCT = 2;   // ±2%
const DEFAULT_PRICE_TOLERANCE_PCT = 1; // ±1%
const MIN_PCT = 0;
const MAX_PCT = 20;

function dec(n) { return Number(n ?? 0); }

function withinPct(actual, expected, pct) {
  if (Number(expected) === 0) return Number(actual) === 0;
  const diffPct = Math.abs((Number(actual) - Number(expected)) / Number(expected)) * 100;
  return diffPct <= pct;
}

/**
 * Resolve tolerances for a supplier: per-supplier override → global AlertRule → hardcoded default.
 * Returns { qtyPct, pricePct, source: { qty: 'supplier'|'global'|'default', price: ... } }.
 */
async function resolveTolerances(supplierId, tx) {
  const client = tx || require('../lib/prisma');
  let supplierQty = null;
  let supplierPrice = null;
  if (supplierId) {
    const sup = await client.supplier.findUnique({
      where: { id: supplierId },
      select: { qtyTolerancePct: true, priceTolerancePct: true },
    });
    if (sup) {
      supplierQty = sup.qtyTolerancePct != null ? Number(sup.qtyTolerancePct) : null;
      supplierPrice = sup.priceTolerancePct != null ? Number(sup.priceTolerancePct) : null;
    }
  }
  const rules = await client.alertRule.findMany({
    where: { type: { in: ['MATCH_QTY_TOLERANCE_PCT', 'MATCH_PRICE_TOLERANCE_PCT'] } },
    select: { type: true, params: true },
  });
  const ruleMap = {};
  for (const r of rules) {
    const pct = r.params && typeof r.params === 'object' ? Number(r.params.pct) : NaN;
    if (!Number.isNaN(pct)) ruleMap[r.type] = pct;
  }
  const globalQty = ruleMap.MATCH_QTY_TOLERANCE_PCT;
  const globalPrice = ruleMap.MATCH_PRICE_TOLERANCE_PCT;

  const qtyPct = supplierQty != null ? supplierQty : (globalQty != null ? globalQty : DEFAULT_QTY_TOLERANCE_PCT);
  const pricePct = supplierPrice != null ? supplierPrice : (globalPrice != null ? globalPrice : DEFAULT_PRICE_TOLERANCE_PCT);

  return {
    qtyPct,
    pricePct,
    source: {
      qty: supplierQty != null ? 'supplier' : (globalQty != null ? 'global' : 'default'),
      price: supplierPrice != null ? 'supplier' : (globalPrice != null ? 'global' : 'default'),
    },
  };
}

/**
 * Re-evaluate the match for every line on the invoice and write per-line status,
 * variances, and the parent invoice status/matchedAmount/varianceAmount.
 * Returns { status, lineStatuses, varianceAmount }.
 */
async function match(invoiceId, tx) {
  const invoice = await tx.supplierInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      lines: {
        include: {
          poLine: true,
          grnLine: true,
        },
      },
    },
  });
  if (!invoice) {
    const err = new Error('Invoice not found');
    err.status = 404;
    throw err;
  }

  const tolerances = await resolveTolerances(invoice.supplierId, tx);

  const lineStatuses = [];
  let matchedAmount = 0;
  let varianceAmount = 0;

  for (const line of invoice.lines) {
    const invQty = dec(line.quantity);
    const invUnit = dec(line.unitPrice);

    let matchStatus = 'PENDING';
    let qtyVariance = null;
    let priceVariance = null;

    if (!line.poLineId) {
      // Non-PO line — accept by default; finance must approve manually.
      matchStatus = 'NO_PO';
    } else {
      const poUnit = dec(line.poLine?.unitPrice);
      const grnQty = line.grnLine ? dec(line.grnLine.qtyReceived) : null;
      const poQty = dec(line.poLine?.qtyOrdered);

      priceVariance = invUnit - poUnit;
      const priceOk = withinPct(invUnit, poUnit, tolerances.pricePct);

      if (grnQty === null) {
        matchStatus = 'NO_RECEIPT';
        qtyVariance = invQty - poQty;
      } else {
        qtyVariance = invQty - grnQty;
        const qtyOk = withinPct(invQty, grnQty, tolerances.qtyPct);
        if (qtyOk && priceOk) matchStatus = 'MATCHED';
        else if (!qtyOk && priceOk) matchStatus = 'QTY_VARIANCE';
        else if (qtyOk && !priceOk) matchStatus = 'PRICE_VARIANCE';
        else matchStatus = 'QTY_VARIANCE'; // both off → call it qty for simplicity
      }
    }

    if (matchStatus === 'MATCHED') matchedAmount += dec(line.lineTotal);
    if (matchStatus !== 'MATCHED' && matchStatus !== 'NO_PO') {
      varianceAmount += Math.abs(dec(line.lineTotal) - (line.grnLine ? dec(line.grnLine.qtyReceived) * dec(line.poLine?.unitPrice) : dec(line.poLine?.qtyOrdered) * dec(line.poLine?.unitPrice)));
    }

    await tx.supplierInvoiceLine.update({
      where: { id: line.id },
      data: { matchStatus, qtyVariance, priceVariance },
    });
    lineStatuses.push({ lineId: line.id, matchStatus, qtyVariance, priceVariance });
  }

  const allClean = lineStatuses.every((l) => l.matchStatus === 'MATCHED' || l.matchStatus === 'NO_PO');
  const newStatus = allClean ? 'MATCHED' : 'EXCEPTION';

  await tx.supplierInvoice.update({
    where: { id: invoiceId },
    data: {
      status: newStatus,
      matchedAt: new Date(),
      matchedAmount,
      varianceAmount,
    },
  });

  return { status: newStatus, lineStatuses, matchedAmount, varianceAmount, tolerances };
}

module.exports = {
  match,
  resolveTolerances,
  DEFAULT_QTY_TOLERANCE_PCT,
  DEFAULT_PRICE_TOLERANCE_PCT,
  MIN_PCT,
  MAX_PCT,
  // Backwards-compat aliases (used by some legacy callsites)
  QTY_TOLERANCE_PCT: DEFAULT_QTY_TOLERANCE_PCT,
  PRICE_TOLERANCE_PCT: DEFAULT_PRICE_TOLERANCE_PCT,
};
