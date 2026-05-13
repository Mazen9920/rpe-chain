/**
 * Production service — Production Order workflow.
 *
 * State machine: DRAFT -> RELEASED -> IN_PROGRESS -> COMPLETED
 *                                     |          \-> (any) -> CANCELLED (from DRAFT/RELEASED only, no consumption)
 *
 * Operations:
 *   planOrder          - Create DRAFT from active BOM, snapshot planned line qtys, return shortfalls.
 *   releaseOrder       - DRAFT -> RELEASED, snapshot FIFO unit cost per line.
 *   consumeComponents  - RELEASED -> IN_PROGRESS, deplete FIFO + write PRODUCTION_CONSUME movements.
 *   postOutput         - IN_PROGRESS -> COMPLETED, create finished Lot + CostLayer + PRODUCTION_OUTPUT movement.
 *   cancelOrder        - Allowed only when DRAFT or RELEASED-without-consumption.
 *
 * Architecture compliance:
 *   - All physical stock changes flow through stock.service.recordMovement (no parallel ledger).
 *   - Finished-good cost lands in a fifo.service.createCostLayer call so downstream COGS sees it.
 *   - Per-component lot genealogy persisted to ProductionConsumptionLot.
 */
const prisma = require('../lib/prisma');
const { recordMovement } = require('./stock.service');
const fifo = require('./fifo.service');
const bomService = require('./bom.service');
const { logEvent } = require('./audit.service');

async function nextOrderNumber(tx) {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const last = await tx.productionOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  const seq = last ? parseInt(last.orderNumber.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(5, '0')}`;
}

/**
 * Create a DRAFT production order from a product's active BOM.
 * Computes planned consumption per top-level line (sub-assemblies are leaves at this layer
 * — they are consumed from stock, not auto-manufactured).
 *
 * @returns {{ order, shortfalls: Array }}
 */
async function planOrder({ productId, plannedQty, warehouseId, bomId, notes, createdById }) {
  if (!productId || !warehouseId || !plannedQty || plannedQty <= 0) {
    throw new Error('productId, warehouseId, and positive plannedQty are required');
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) throw new Error('Finished-good product not found');

  const bom = bomId
    ? await prisma.billOfMaterials.findUnique({ where: { id: bomId }, include: { lines: true } })
    : await prisma.billOfMaterials.findFirst({
        where: { productId, isActive: true, archivedAt: null },
        include: { lines: true },
      });
  if (!bom) throw new Error('No active BOM for product');
  if (bom.productId !== productId) throw new Error('BOM does not belong to this product');

  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new Error('Warehouse not found');

  // Build planned lines and shortfall report.
  const plannedLines = [];
  const shortfalls = [];
  for (const line of bom.lines) {
    const qty = Number(line.qtyPer) * plannedQty * (1 + Number(line.scrapFactorPct) / 100);
    plannedLines.push({
      componentProductId: line.componentProductId,
      plannedQty: qty,
      uom: line.uom,
    });

    const sl = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId: line.componentProductId, warehouseId } },
    });
    const onHand = sl ? sl.onHand : 0;
    if (onHand < qty) {
      const componentProduct = await prisma.product.findUnique({ where: { id: line.componentProductId }, select: { sku: true, name: true } });
      shortfalls.push({
        componentProductId: line.componentProductId,
        sku: componentProduct?.sku,
        name: componentProduct?.name,
        required: qty,
        onHand,
        shortBy: qty - onHand,
      });
    }
  }

  const order = await prisma.$transaction(async (tx) => {
    const orderNumber = await nextOrderNumber(tx);
    return tx.productionOrder.create({
      data: {
        orderNumber,
        productId,
        bomId: bom.id,
        warehouseId,
        plannedQty,
        status: 'DRAFT',
        notes: notes || null,
        createdById: createdById || null,
        lines: { create: plannedLines },
      },
      include: { lines: { include: { componentProduct: { select: { id: true, sku: true, name: true, uom: true } } } }, product: true, warehouse: true, bom: { select: { id: true, version: true } } },
    });
  });

  await logEvent({ eventType: 'PRODUCTION_PLANNED', entityType: 'ProductionOrder', entityId: order.id, actorId: createdById, payload: { productId, plannedQty, warehouseId, shortfallCount: shortfalls.length } });

  return { order, shortfalls };
}

/**
 * Release a DRAFT order. Snapshots FIFO weighted-avg unit cost per line at this moment.
 */
async function releaseOrder(orderId, userId) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  if (!order) throw new Error('Production order not found');
  if (order.status !== 'DRAFT') throw new Error(`Cannot release order in status ${order.status}`);

  const updated = await prisma.$transaction(async (tx) => {
    for (const line of order.lines) {
      const cost = await bomService.rollupFifoCost(line.componentProductId, order.warehouseId, { client: tx });
      await tx.productionOrderLine.update({
        where: { id: line.id },
        data: { unitCostSnapshot: cost.unitCost.toFixed(4) },
      });
    }
    return tx.productionOrder.update({
      where: { id: orderId },
      data: { status: 'RELEASED', releasedAt: new Date() },
      include: { lines: true },
    });
  });

  await logEvent({ eventType: 'PRODUCTION_RELEASED', entityType: 'ProductionOrder', entityId: orderId, actorId: userId });
  return updated;
}

/**
 * Consume planned components.
 * For each line: deplete FIFO at the warehouse, record PRODUCTION_CONSUME movements,
 * persist per-lot genealogy rows. Sums totalComponentCost across all lines.
 *
 * Idempotency: this should be called once per order. If retried after partial completion
 * (consumedQty > 0 on some lines), it will skip already-fully-consumed lines.
 */
async function consumeComponents(orderId, userId) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  if (!order) throw new Error('Production order not found');
  if (!['RELEASED', 'IN_PROGRESS'].includes(order.status)) {
    throw new Error(`Cannot consume in status ${order.status}`);
  }

  let totalComponentCost = 0;
  const perLineCosts = [];

  for (const line of order.lines) {
    const remainingQty = Number(line.plannedQty) - Number(line.consumedQty);
    if (remainingQty <= 0) continue;
    const qtyInt = Math.ceil(remainingQty); // physical movements are integers

    // Snapshot FIFO layers BEFORE depletion to know which lots get consumed.
    const layersBefore = await prisma.costLayer.findMany({
      where: {
        productId: line.componentProductId,
        warehouseId: order.warehouseId,
        status: 'ACTIVE',
        qtyRemaining: { gt: 0 },
      },
      orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, lotId: true, qtyRemaining: true, functionalUnitCost: true },
    });

    // Pre-compute which lots will be touched and how much.
    let need = qtyInt;
    const lotConsumption = []; // [{ lotId, qty, unitCost }]
    for (const l of layersBefore) {
      if (need <= 0) break;
      const take = Math.min(need, l.qtyRemaining);
      if (l.lotId) lotConsumption.push({ lotId: l.lotId, qty: take, unitCost: Number(l.functionalUnitCost) });
      need -= take;
    }

    // Deplete FIFO (own transaction). Will throw if insufficient.
    const result = await fifo.depleteFifo({
      productId: line.componentProductId,
      warehouseId: order.warehouseId,
      qty: qtyInt,
    });

    totalComponentCost += result.totalCogs;
    perLineCosts.push({ lineId: line.id, cost: result.totalCogs });

    // Record physical movement(s) — one PRODUCTION_CONSUME per lot (or one if no lot).
    if (lotConsumption.length === 0) {
      await recordMovement({
        productId: line.componentProductId,
        warehouseId: order.warehouseId,
        qty: qtyInt,
        reasonCode: 'PRODUCTION_CONSUME',
        sourceDocType: 'PRODUCTION_ORDER',
        sourceDocId: orderId,
        operatorId: userId,
      });
    } else {
      for (const lot of lotConsumption) {
        await recordMovement({
          productId: line.componentProductId,
          warehouseId: order.warehouseId,
          lotId: lot.lotId,
          qty: lot.qty,
          reasonCode: 'PRODUCTION_CONSUME',
          sourceDocType: 'PRODUCTION_ORDER',
          sourceDocId: orderId,
          operatorId: userId,
        });
        // Decrement lot.qtyRemaining
        await prisma.lot.update({
          where: { id: lot.lotId },
          data: { qtyRemaining: { decrement: lot.qty } },
        });
        // Persist genealogy.
        await prisma.productionConsumptionLot.create({
          data: {
            productionOrderId: orderId,
            lotId: lot.lotId,
            qtyConsumed: lot.qty,
            unitCost: lot.unitCost.toFixed(4),
          },
        });
      }
    }

    await prisma.productionOrderLine.update({
      where: { id: line.id },
      data: { consumedQty: { increment: qtyInt } },
    });
  }

  const updated = await prisma.productionOrder.update({
    where: { id: orderId },
    data: { status: 'IN_PROGRESS' },
    include: { lines: true },
  });

  await logEvent({
    eventType: 'PRODUCTION_CONSUMED',
    entityType: 'ProductionOrder',
    entityId: orderId,
    actorId: userId,
    payload: { totalComponentCost: totalComponentCost.toFixed(2), lineCount: perLineCosts.length },
  });

  return { order: updated, totalComponentCost, perLineCosts };
}

/**
 * Post finished-good output. Creates a new Lot + CostLayer for the finished good,
 * appends a PRODUCTION_OUTPUT movement, and (if scrapQty>0) a SCRAP movement.
 *
 * unitCost = (totalComponentCost + qty*labor + qty*overhead) / qty
 * Where totalComponentCost is rebuilt by summing PRODUCTION_CONSUME-related cogs postings.
 */
async function postOutput({ orderId, qty, scrapQty = 0, lotNumber, expiryDate, userId }) {
  if (!qty || qty <= 0) throw new Error('Output qty must be positive');
  if (scrapQty < 0) throw new Error('scrapQty cannot be negative');

  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { product: true, lines: true },
  });
  if (!order) throw new Error('Production order not found');
  if (order.status !== 'IN_PROGRESS') {
    throw new Error(`Cannot post output in status ${order.status}`);
  }

  // Sum component costs from genealogy (for accurate per-lot output cost).
  const consumptions = await prisma.productionConsumptionLot.findMany({
    where: { productionOrderId: orderId },
  });
  const totalComponentCost = consumptions.reduce((s, c) => s + c.qtyConsumed * Number(c.unitCost), 0);

  const labor = Number(order.product.standardLaborCost) * qty;
  const overhead = Number(order.product.standardOverheadCost) * qty;
  const totalCost = totalComponentCost + labor + overhead;
  const unitCost = totalCost / qty;

  // Generate lot number if not given.
  const finalLotNumber = lotNumber || `LOT-${order.orderNumber}-${Date.now().toString(36).toUpperCase()}`;

  const result = await prisma.$transaction(async (tx) => {
    const lot = await tx.lot.create({
      data: {
        lotNumber: finalLotNumber,
        productId: order.productId,
        receivedDate: new Date(),
        expiryDate: expiryDate ? new Date(expiryDate) : null,
        qtyReceived: qty,
        qtyRemaining: qty,
        qaStatus: 'RELEASED',
      },
    });

    await fifo.createCostLayer(
      {
        productId: order.productId,
        warehouseId: order.warehouseId,
        lotId: lot.id,
        qty,
        unitCost,
        landedCostPerUnit: 0,
        currency: 'USD',
        fxRate: 1,
        receivedDate: new Date(),
      },
      tx
    );

    const output = await tx.productionOutput.create({
      data: {
        productionOrderId: orderId,
        lotId: lot.id,
        qty,
        totalComponentCost: totalComponentCost.toFixed(2),
        laborCost: labor.toFixed(2),
        overheadCost: overhead.toFixed(2),
        unitCost: unitCost.toFixed(4),
      },
    });

    return { lot, output };
  });

  // Record the physical IN movement.
  await recordMovement({
    productId: order.productId,
    warehouseId: order.warehouseId,
    lotId: result.lot.id,
    qty,
    reasonCode: 'PRODUCTION_OUTPUT',
    sourceDocType: 'PRODUCTION_ORDER',
    sourceDocId: orderId,
    operatorId: userId,
  });

  // Optional scrap movement on the finished good.
  if (scrapQty > 0) {
    // Scrap reduces stock — we recorded a smaller qty in IN; here we record OUT for scrap.
    // To represent scrap that never made it to inventory, we'd skip the IN but then there'd be
    // no traceable lot. Instead: post the full produced qty IN, then a SCRAP movement OUT.
    await recordMovement({
      productId: order.productId,
      warehouseId: order.warehouseId,
      lotId: result.lot.id,
      qty: scrapQty,
      reasonCode: 'SCRAP',
      sourceDocType: 'PRODUCTION_ORDER',
      sourceDocId: orderId,
      operatorId: userId,
    });
    await prisma.lot.update({
      where: { id: result.lot.id },
      data: { qtyRemaining: { decrement: scrapQty } },
    });
  }

  const updated = await prisma.productionOrder.update({
    where: { id: orderId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      producedQty: { increment: qty },
      scrapQty: { increment: scrapQty },
    },
    include: { lines: true, outputs: true },
  });

  await logEvent({
    eventType: 'PRODUCTION_COMPLETED',
    entityType: 'ProductionOrder',
    entityId: orderId,
    actorId: userId,
    payload: { qty, scrapQty, unitCost: unitCost.toFixed(4), lotNumber: finalLotNumber },
  });

  return { order: updated, output: result.output, lot: result.lot, unitCost };
}

async function cancelOrder(orderId, userId, reason) {
  const order = await prisma.productionOrder.findUnique({
    where: { id: orderId },
    include: { lines: true },
  });
  if (!order) throw new Error('Production order not found');
  if (!['DRAFT', 'RELEASED'].includes(order.status)) {
    throw new Error(`Cannot cancel order in status ${order.status}`);
  }
  const anyConsumed = order.lines.some((l) => Number(l.consumedQty) > 0);
  if (anyConsumed) throw new Error('Cannot cancel — components have already been consumed');

  const updated = await prisma.productionOrder.update({
    where: { id: orderId },
    data: { status: 'CANCELLED', cancelledAt: new Date(), notes: reason ? `${order.notes ? order.notes + ' | ' : ''}Cancelled: ${reason}` : order.notes },
  });

  await logEvent({ eventType: 'PRODUCTION_CANCELLED', entityType: 'ProductionOrder', entityId: orderId, actorId: userId, payload: { reason: reason || null } });
  return updated;
}

module.exports = { planOrder, releaseOrder, consumeComponents, postOutput, cancelOrder };
