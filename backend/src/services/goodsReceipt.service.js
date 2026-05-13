/**
 * Goods Receipt service — Section 4.
 * Atomic receive-against-PO, reversal, QA actions, landed-cost allocation.
 */
const prisma = require('../lib/prisma');
const { createCostLayer } = require('./fifo.service');
const { recordMovement } = require('./stock.service');
const { generateLotNumber } = require('./lotNumber.service');
const { logEvent } = require('./audit.service');

const ALLOCATION_METHODS = ['VALUE', 'WEIGHT', 'VOLUME'];
const LANDED_COST_TYPES = ['FREIGHT', 'DUTY', 'INSURANCE', 'BROKERAGE', 'OTHER'];

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function genReceiptNumber() {
  return `GR-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

// ─── Reads ────────────────────────────────────────────────────────────────────

async function listGRNs(filters = {}) {
  const { warehouseId, poId, status, dateFrom, dateTo, limit = 100, offset = 0 } = filters;
  const where = {};
  if (warehouseId) where.warehouseId = warehouseId;
  if (poId) where.purchaseOrderId = poId;
  if (status) where.status = status;
  if (dateFrom || dateTo) {
    where.receivedAt = {};
    if (dateFrom) where.receivedAt.gte = new Date(dateFrom);
    if (dateTo) where.receivedAt.lte = new Date(dateTo);
  }

  const [rows, total] = await Promise.all([
    prisma.goodsReceipt.findMany({
      where,
      include: {
        purchaseOrder: { select: { id: true, poNumber: true, supplierId: true, supplier: { select: { id: true, name: true, code: true } } } },
        warehouse: { select: { id: true, code: true, name: true } },
        receivedBy: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      skip: Number(offset) || 0,
    }),
    prisma.goodsReceipt.count({ where }),
  ]);
  return { rows, total };
}

async function getGRN(id) {
  return prisma.goodsReceipt.findUnique({
    where: { id },
    include: {
      purchaseOrder: { include: { supplier: { select: { id: true, name: true, code: true } } } },
      warehouse: true,
      receivedBy: { select: { id: true, name: true } },
      reversedBy: { select: { id: true, name: true } },
      lines: {
        include: {
          poLine: { include: { product: { select: { id: true, sku: true, name: true, uom: true, weightKg: true } } } },
          qaActionedBy: { select: { id: true, name: true } },
        },
      },
    },
  });
}

// ─── Receive against PO ───────────────────────────────────────────────────────

async function receiveAgainstPO(input, actor, sourceIp) {
  const { poId, warehouseId, fxRate, notes, lines } = input;
  if (!poId) bad('poId is required');
  if (!warehouseId) bad('warehouseId is required');
  if (!Array.isArray(lines) || lines.length === 0) bad('At least one receipt line required');

  const fxNum = fxRate != null ? Number(fxRate) : 1;
  if (!Number.isFinite(fxNum) || fxNum <= 0) bad('fxRate must be > 0');

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({
      where: { id: poId, deletedAt: null },
      include: { lines: true, supplier: true },
    });
    if (!po) bad('Purchase order not found', 404);
    if (!['SENT', 'PARTIALLY_RECEIVED'].includes(po.status)) {
      bad(`Cannot receive PO in status ${po.status}`, 409, 'BAD_STATUS_TRANSITION');
    }

    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, defaultReceivingBinId: true },
    });
    if (!warehouse) bad('Warehouse not found', 404);

    const receipt = await tx.goodsReceipt.create({
      data: {
        receiptNumber: genReceiptNumber(),
        purchaseOrderId: poId,
        warehouseId,
        receivedById: actor.id,
        fxRateAtReceipt: fxNum,
        notes: notes || null,
      },
    });

    const createdLines = [];

    for (const line of lines) {
      const poLine = po.lines.find((l) => l.id === line.poLineId);
      if (!poLine) bad(`PO line ${line.poLineId} not found`, 400);
      const qty = Math.trunc(Number(line.qtyReceived));
      if (!Number.isFinite(qty) || qty <= 0) bad('qtyReceived must be > 0');
      const remaining = poLine.qtyOrdered - poLine.qtyReceived;
      if (qty > remaining) {
        bad(`Over-receipt on line ${poLine.id}: ordered ${poLine.qtyOrdered}, already received ${poLine.qtyReceived}, attempted ${qty}`, 409, 'OVER_RECEIPT');
      }

      // Lot number: user input wins; otherwise generate.
      let lotNumber = line.lotNumber && String(line.lotNumber).trim();
      if (lotNumber) {
        const clash = await tx.lot.findUnique({ where: { lotNumber }, select: { id: true } });
        if (clash) bad(`Lot number ${lotNumber} already exists`, 409, 'DUPLICATE_LOT');
      } else {
        lotNumber = await generateLotNumber(warehouseId, tx);
      }

      const lot = await tx.lot.create({
        data: {
          lotNumber,
          productId: poLine.productId,
          supplierId: po.supplierId,
          expiryDate: line.expiryDate ? new Date(line.expiryDate) : null,
          qtyReceived: qty,
          qtyRemaining: qty,
          qaStatus: line.qaStatus || 'RELEASED',
          currentBinId: warehouse.defaultReceivingBinId || null,
        },
      });

      await createCostLayer(
        {
          productId: poLine.productId,
          warehouseId,
          lotId: lot.id,
          qty,
          unitCost: Number(poLine.unitPrice),
          currency: po.currency,
          fxRate: fxNum,
          poLineId: poLine.id,
          receivedDate: new Date(),
        },
        tx
      );

      await recordMovement(
        {
          productId: poLine.productId,
          warehouseId,
          binId: warehouse.defaultReceivingBinId || null,
          lotId: lot.id,
          qty,
          reasonCode: 'RECEIPT',
          sourceDocType: 'PO',
          sourceDocId: poId,
          operatorId: actor.id,
        },
        tx
      );

      const grLine = await tx.goodsReceiptLine.create({
        data: {
          receiptId: receipt.id,
          poLineId: poLine.id,
          qtyReceived: qty,
          lotId: lot.id,
          qaStatus: line.qaStatus || 'RELEASED',
        },
      });
      createdLines.push(grLine);

      const newReceived = poLine.qtyReceived + qty;
      await tx.purchaseOrderLine.update({
        where: { id: poLine.id },
        data: {
          qtyReceived: newReceived,
          status: newReceived >= poLine.qtyOrdered ? 'COMPLETED' : 'PARTIAL',
        },
      });
    }

    // Update PO status
    const refreshedLines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: poId } });
    const allDone = refreshedLines.every((l) => l.qtyReceived >= l.qtyOrdered);
    const anyDone = refreshedLines.some((l) => l.qtyReceived > 0);
    await tx.purchaseOrder.update({
      where: { id: poId },
      data: { status: allDone ? 'RECEIVED' : anyDone ? 'PARTIALLY_RECEIVED' : po.status },
    });

    return { receipt, lines: createdLines };
  });

  await logEvent({
    eventType: 'GOODS_RECEIVED',
    entityType: 'GoodsReceipt',
    entityId: result.receipt.id,
    actorId: actor.id,
    payload: { poId, receiptNumber: result.receipt.receiptNumber, lineCount: result.lines.length, fxRate: fxNum },
    sourceIp,
  });
  await logEvent({
    eventType: 'PO_GOODS_RECEIVED',
    entityType: 'PurchaseOrder',
    entityId: poId,
    actorId: actor.id,
    payload: { receiptId: result.receipt.id, receiptNumber: result.receipt.receiptNumber },
    sourceIp,
  });

  return result.receipt;
}

// ─── Reverse receipt ──────────────────────────────────────────────────────────

async function reverseReceipt(grnId, reason, actor, sourceIp) {
  const result = await prisma.$transaction(async (tx) => {
    const grn = await tx.goodsReceipt.findUnique({
      where: { id: grnId },
      include: {
        lines: true,
        purchaseOrder: true,
      },
    });
    if (!grn) bad('Goods receipt not found', 404);
    if (grn.status === 'REVERSED') bad('Goods receipt is already reversed', 409);

    // Gather the cost layers created by this receipt.
    const lotIds = grn.lines.map((l) => l.lotId).filter(Boolean);
    const layers = await tx.costLayer.findMany({ where: { lotId: { in: lotIds } } });

    // Block if any of them has been depleted.
    const depleted = layers.find((l) => l.qtyRemaining < l.qtyReceived);
    if (depleted) {
      bad(`Cannot reverse: cost layer ${depleted.id} has been partially consumed`, 409, 'RECEIPT_DEPLETED');
    }

    for (const line of grn.lines) {
      const layer = layers.find((l) => l.lotId === line.lotId);
      if (layer) {
        await tx.costLayer.update({
          where: { id: layer.id },
          data: { status: 'LOCKED', qtyRemaining: 0, version: { increment: 1 } },
        });
      }
      const poLine = await tx.purchaseOrderLine.findUnique({ where: { id: line.poLineId } });
      const lot = line.lotId ? await tx.lot.findUnique({ where: { id: line.lotId } }) : null;

      // Reverse stock movement.
      await recordMovement(
        {
          productId: poLine.productId,
          warehouseId: grn.warehouseId,
          binId: lot?.currentBinId || null,
          lotId: line.lotId,
          qty: line.qtyReceived,
          reasonCode: 'RECEIPT_REVERSAL',
          sourceDocType: 'GRN',
          sourceDocId: grn.id,
          operatorId: actor.id,
          notes: reason || 'Reversed',
        },
        tx
      );
      // Quarantine the lot and zero remaining (it's been removed).
      if (line.lotId) {
        await tx.lot.update({
          where: { id: line.lotId },
          data: { qaStatus: 'QUARANTINED', qtyRemaining: 0 },
        });
      }
      // Restore PO line received qty.
      if (poLine) {
        const restored = poLine.qtyReceived - line.qtyReceived;
        await tx.purchaseOrderLine.update({
          where: { id: poLine.id },
          data: {
            qtyReceived: Math.max(0, restored),
            status: restored <= 0 ? 'OPEN' : restored < poLine.qtyOrdered ? 'PARTIAL' : 'COMPLETED',
          },
        });
      }
    }

    // Mark GRN reversed.
    const updated = await tx.goodsReceipt.update({
      where: { id: grn.id },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: actor.id, reverseReason: reason || null },
    });

    // Recompute PO status from refreshed lines.
    const refreshed = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: grn.purchaseOrderId } });
    const allDone = refreshed.every((l) => l.qtyReceived >= l.qtyOrdered);
    const anyDone = refreshed.some((l) => l.qtyReceived > 0);
    const newStatus = allDone ? 'RECEIVED' : anyDone ? 'PARTIALLY_RECEIVED' : 'SENT';
    await tx.purchaseOrder.update({ where: { id: grn.purchaseOrderId }, data: { status: newStatus } });

    return updated;
  });

  await logEvent({
    eventType: 'RECEIPT_REVERSED',
    entityType: 'GoodsReceipt',
    entityId: result.id,
    actorId: actor.id,
    payload: { reason: reason || null },
    sourceIp,
  });
  return result;
}

// ─── QA actions ───────────────────────────────────────────────────────────────

async function qaAction(grnLineId, action, reason, actor, sourceIp) {
  if (!['RELEASE', 'REJECT'].includes(action)) bad('action must be RELEASE or REJECT');

  const grnLine = await prisma.goodsReceiptLine.findUnique({
    where: { id: grnLineId },
    include: { receipt: { select: { warehouseId: true } }, poLine: { select: { productId: true } } },
  });
  if (!grnLine) bad('Goods receipt line not found', 404);
  if (!grnLine.lotId) bad('Receipt line has no associated lot', 400);

  const wantQa = action === 'RELEASE' ? 'RELEASED' : 'REJECTED';
  if (grnLine.qaStatus === wantQa) return grnLine;

  const result = await prisma.$transaction(async (tx) => {
    if (action === 'REJECT') {
      // Find a QA bin in this warehouse (binType=QA). If none, leave bin null.
      const qaBin = await tx.binLocation.findFirst({
        where: { warehouseId: grnLine.receipt.warehouseId, binType: 'QA', isActive: true },
        select: { id: true },
      });
      const lot = await tx.lot.findUnique({ where: { id: grnLine.lotId } });
      // Move out of current bin (if any) then into QA bin via stock movement.
      await recordMovement(
        {
          productId: grnLine.poLine.productId,
          warehouseId: grnLine.receipt.warehouseId,
          binId: lot?.currentBinId || null,
          lotId: grnLine.lotId,
          qty: grnLine.qtyReceived,
          reasonCode: 'QA_QUARANTINE',
          sourceDocType: 'GRN_LINE',
          sourceDocId: grnLine.id,
          operatorId: actor.id,
          notes: reason || 'QA reject',
        },
        tx
      );
      await tx.lot.update({
        where: { id: grnLine.lotId },
        data: { qaStatus: 'REJECTED', currentBinId: qaBin?.id || lot?.currentBinId || null },
      });
    } else {
      // RELEASE just updates qaStatus; stock stays where it is.
      await tx.lot.update({ where: { id: grnLine.lotId }, data: { qaStatus: 'RELEASED' } });
    }
    return tx.goodsReceiptLine.update({
      where: { id: grnLineId },
      data: { qaStatus: wantQa, qaActionedById: actor.id, qaActionedAt: new Date(), qaNotes: reason || null },
    });
  });

  await logEvent({
    eventType: action === 'RELEASE' ? 'QA_RELEASED' : 'QA_REJECTED',
    entityType: 'GoodsReceiptLine',
    entityId: grnLineId,
    actorId: actor.id,
    payload: { reason: reason || null, lotId: grnLine.lotId },
    sourceIp,
  });
  return result;
}

// ─── Landed costs ─────────────────────────────────────────────────────────────

async function addLandedCost(grnId, input, actor, sourceIp) {
  const { costType, amount, allocationMethod } = input;
  if (!LANDED_COST_TYPES.includes(costType)) bad(`costType must be one of: ${LANDED_COST_TYPES.join(', ')}`);
  const method = ALLOCATION_METHODS.includes(allocationMethod) ? allocationMethod : 'VALUE';
  const totalAmount = Number(amount);
  if (!Number.isFinite(totalAmount) || totalAmount <= 0) bad('amount must be > 0');

  const result = await prisma.$transaction(async (tx) => {
    const grn = await tx.goodsReceipt.findUnique({
      where: { id: grnId },
      include: { lines: { include: { poLine: { include: { product: { select: { id: true, weightKg: true } } } } } } },
    });
    if (!grn) bad('Goods receipt not found', 404);
    if (grn.status === 'REVERSED') bad('Cannot add landed cost to a reversed receipt', 409);

    // Layers for this receipt's lots.
    const lotIds = grn.lines.map((l) => l.lotId).filter(Boolean);
    const layers = await tx.costLayer.findMany({ where: { lotId: { in: lotIds } } });
    if (!layers.length) bad('No cost layers found for this receipt', 409);

    // Build a basis per layer.
    let basisMethod = method;
    let basis = [];
    if (basisMethod === 'VOLUME') {
      // No volume in schema — fall back to VALUE.
      basisMethod = 'VALUE';
    }
    if (basisMethod === 'WEIGHT') {
      const allHaveWeight = grn.lines.every((l) => l.poLine.product.weightKg != null);
      if (!allHaveWeight) basisMethod = 'VALUE';
    }
    for (const layer of layers) {
      const grLine = grn.lines.find((l) => l.lotId === layer.lotId);
      let weight = 0;
      if (basisMethod === 'WEIGHT') {
        weight = Number(grLine.poLine.product.weightKg || 0) * layer.qtyReceived;
      } else {
        // VALUE: extended cost (qty * unitCost original currency).
        weight = Number(layer.unitCost) * layer.qtyReceived;
      }
      basis.push({ layer, weight });
    }
    const totalWeight = basis.reduce((s, b) => s + b.weight, 0);
    if (totalWeight <= 0) bad('Allocation basis sums to zero — cannot allocate', 409);

    const allocations = [];
    let remaining = totalAmount;
    for (let i = 0; i < basis.length; i++) {
      const { layer, weight } = basis[i];
      let allocated;
      if (i === basis.length - 1) {
        allocated = remaining; // assign remainder to last to avoid rounding drift
      } else {
        allocated = Number(((weight / totalWeight) * totalAmount).toFixed(4));
        remaining -= allocated;
      }
      // Update layer landed cost + functional cost.
      const addPerUnit = Number((allocated / layer.qtyReceived).toFixed(4));
      const newLanded = Number(layer.landedCostPerUnit) + addPerUnit;
      const newFunctional = (Number(layer.unitCost) + newLanded) * Number(layer.fxRate);
      await tx.costLayer.update({
        where: { id: layer.id },
        data: {
          landedCostPerUnit: newLanded,
          functionalUnitCost: newFunctional,
          version: { increment: 1 },
        },
      });
      const row = await tx.landedCostAllocation.create({
        data: {
          purchaseOrderId: grn.purchaseOrderId,
          costType,
          totalAmount,
          allocationMethod: basisMethod,
          layerId: layer.id,
          allocatedAmount: allocated,
        },
      });
      allocations.push(row);
    }

    return { allocations, basisMethod, requestedMethod: method };
  });

  await logEvent({
    eventType: 'LANDED_COST_ADDED',
    entityType: 'GoodsReceipt',
    entityId: grnId,
    actorId: actor.id,
    payload: {
      costType,
      totalAmount,
      requestedMethod: result.requestedMethod,
      appliedMethod: result.basisMethod,
      fallback: result.requestedMethod !== result.basisMethod,
      layerCount: result.allocations.length,
    },
    sourceIp,
  });
  return result.allocations;
}

async function removeLandedCost(allocationId, actor, sourceIp) {
  const allocation = await prisma.landedCostAllocation.findUnique({ where: { id: allocationId } });
  if (!allocation) bad('Landed cost allocation not found', 404);

  await prisma.$transaction(async (tx) => {
    const layer = await tx.costLayer.findUnique({ where: { id: allocation.layerId } });
    if (layer) {
      const removedPerUnit = Number((Number(allocation.allocatedAmount) / layer.qtyReceived).toFixed(4));
      const newLanded = Math.max(0, Number(layer.landedCostPerUnit) - removedPerUnit);
      const newFunctional = (Number(layer.unitCost) + newLanded) * Number(layer.fxRate);
      await tx.costLayer.update({
        where: { id: layer.id },
        data: {
          landedCostPerUnit: newLanded,
          functionalUnitCost: newFunctional,
          version: { increment: 1 },
        },
      });
    }
    await tx.landedCostAllocation.delete({ where: { id: allocationId } });
  });

  await logEvent({
    eventType: 'LANDED_COST_REMOVED',
    entityType: 'LandedCostAllocation',
    entityId: allocationId,
    actorId: actor.id,
    payload: { layerId: allocation.layerId, costType: allocation.costType, amount: Number(allocation.allocatedAmount) },
    sourceIp,
  });
}

module.exports = {
  LANDED_COST_TYPES,
  ALLOCATION_METHODS,
  listGRNs,
  getGRN,
  receiveAgainstPO,
  reverseReceipt,
  qaAction,
  addLandedCost,
  removeLandedCost,
};
