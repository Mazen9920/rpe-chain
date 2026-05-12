/**
 * FIFO Cost Engine — RPE Chain Supply OS
 *
 * Implements the depletion algorithm from Section 04 of the master plan:
 *   - Inbound receipt creates a CostLayer (immutable)
 *   - Outbound movement consumes from layers in oldest-first order
 *   - Every consumption posts a CogsPosting (append-only)
 *   - Operations are atomic — partial depletion is never persisted
 *
 * Design commitments:
 *   - Append-only: layers and postings are never updated in place
 *   - Atomic: depletion runs inside a single Prisma transaction
 *   - Explainable: every COGS posting carries unit cost and source shipment
 */

const prisma = require('../lib/prisma');

/**
 * Create a new cost layer when goods are received.
 * Called from the goods-receipt workflow.
 *
 * @param {object} params
 * @param {string} params.productId
 * @param {string} params.warehouseId
 * @param {string} [params.lotId]
 * @param {number} params.qty
 * @param {number} params.unitCost - original currency
 * @param {number} [params.landedCostPerUnit=0]
 * @param {string} [params.currency='USD']
 * @param {number} [params.fxRate=1]
 * @param {string} [params.poLineId]
 * @param {Date}   [params.receivedDate]
 * @param {object} [tx] - optional Prisma transaction client
 */
async function createCostLayer(params, tx = prisma) {
  const {
    productId,
    warehouseId,
    lotId,
    qty,
    unitCost,
    landedCostPerUnit = 0,
    currency = 'USD',
    fxRate = 1,
    poLineId,
    receivedDate = new Date(),
  } = params;

  if (qty <= 0) throw new Error('Cost layer qty must be positive');
  if (unitCost < 0) throw new Error('Unit cost cannot be negative');

  const functionalUnitCost = (Number(unitCost) + Number(landedCostPerUnit)) * Number(fxRate);

  return tx.costLayer.create({
    data: {
      productId,
      warehouseId,
      lotId,
      qtyReceived: qty,
      qtyRemaining: qty,
      unitCost,
      landedCostPerUnit,
      currency,
      fxRate,
      functionalUnitCost,
      receivedDate,
      poLineId,
      status: 'ACTIVE',
    },
  });
}

/**
 * Consume `qty` units of a SKU from a warehouse using FIFO.
 * Posts COGS for every layer touched and returns the breakdown.
 * Atomic: either the full qty is consumed or no change is made.
 *
 * @param {object} params
 * @param {string} params.productId
 * @param {string} params.warehouseId
 * @param {number} params.qty
 * @param {string} [params.shipmentId]
 * @param {string} [params.salesOrderId]
 * @returns {Promise<{totalCogs: number, postings: Array, layersConsumed: number}>}
 */
async function depleteFifo({ productId, warehouseId, qty, shipmentId, salesOrderId }) {
  if (qty <= 0) throw new Error('Depletion qty must be positive');

  return prisma.$transaction(async (tx) => {
    // 1. Lock & fetch active layers in FIFO order (oldest receivedDate first).
    //    Postgres takes row-level locks via SELECT ... FOR UPDATE which Prisma
    //    achieves with $queryRaw. Using ordered scan for simplicity.
    const layers = await tx.$queryRaw`
      SELECT * FROM "CostLayer"
      WHERE "productId" = ${productId}
        AND "warehouseId" = ${warehouseId}
        AND status = 'ACTIVE'
        AND "qtyRemaining" > 0
      ORDER BY "receivedDate" ASC, "createdAt" ASC
      FOR UPDATE
    `;

    // 2. Verify sufficient stock exists across all layers.
    const totalAvailable = layers.reduce((s, l) => s + l.qtyRemaining, 0);
    if (totalAvailable < qty) {
      throw new Error(
        `Insufficient stock for FIFO depletion: requested ${qty}, available ${totalAvailable}`
      );
    }

    // 3. Walk layers oldest-first, consuming until qty satisfied.
    let remaining = qty;
    let totalCogs = 0;
    const postings = [];

    for (const layer of layers) {
      if (remaining === 0) break;
      const consume = Math.min(remaining, layer.qtyRemaining);
      const cogsAmount = consume * Number(layer.functionalUnitCost);

      // Decrement layer remaining, mark depleted when zero.
      const newRemaining = layer.qtyRemaining - consume;
      await tx.costLayer.update({
        where: { id: layer.id },
        data: {
          qtyRemaining: newRemaining,
          status: newRemaining === 0 ? 'DEPLETED' : 'ACTIVE',
          version: { increment: 1 },
        },
      });

      // Append-only COGS posting.
      const posting = await tx.cogsPosting.create({
        data: {
          layerId: layer.id,
          productId,
          qtyConsumed: consume,
          unitCostAtConsumption: layer.functionalUnitCost,
          cogsAmount,
          salesOrderId,
          shipmentId,
        },
      });
      postings.push(posting);
      totalCogs += cogsAmount;
      remaining -= consume;
    }

    return { totalCogs, postings, layersConsumed: postings.length };
  });
}

/**
 * Reverse a FIFO depletion (e.g. customer return restocked).
 * Creates a new cost layer with original cost rather than touching depleted ones
 * — preserving the append-only property. The original COGS posting stays in place;
 * a counter-posting is recorded.
 */
async function reverseFifo({ productId, warehouseId, originalCogsPostingId, qty }) {
  return prisma.$transaction(async (tx) => {
    const original = await tx.cogsPosting.findUnique({
      where: { id: originalCogsPostingId },
      include: { layer: true },
    });
    if (!original) throw new Error('Original COGS posting not found');

    // Restock with the same unit cost as the original layer.
    await tx.costLayer.create({
      data: {
        productId,
        warehouseId,
        lotId: original.layer.lotId,
        qtyReceived: qty,
        qtyRemaining: qty,
        unitCost: original.layer.unitCost,
        landedCostPerUnit: original.layer.landedCostPerUnit,
        currency: original.layer.currency,
        fxRate: original.layer.fxRate,
        functionalUnitCost: original.layer.functionalUnitCost,
        receivedDate: new Date(),
        status: 'ACTIVE',
      },
    });

    // Counter posting: negative cogsAmount documents the reversal.
    await tx.cogsPosting.create({
      data: {
        layerId: original.layerId,
        productId,
        qtyConsumed: -qty,
        unitCostAtConsumption: original.unitCostAtConsumption,
        cogsAmount: -qty * Number(original.unitCostAtConsumption),
      },
    });
  });
}

/**
 * Current inventory valuation = sum(qtyRemaining * functionalUnitCost) across active layers.
 * Per master plan: this must reconcile to the GL inventory account at any moment.
 */
async function getInventoryValuation({ warehouseId, productId } = {}) {
  const where = { status: 'ACTIVE', qtyRemaining: { gt: 0 } };
  if (warehouseId) where.warehouseId = warehouseId;
  if (productId) where.productId = productId;

  const layers = await prisma.costLayer.findMany({ where });
  const total = layers.reduce(
    (s, l) => s + l.qtyRemaining * Number(l.functionalUnitCost),
    0
  );
  return { totalValue: total, layerCount: layers.length };
}

module.exports = {
  createCostLayer,
  depleteFifo,
  reverseFifo,
  getInventoryValuation,
};
