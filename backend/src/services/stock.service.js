/**
 * Stock movement service — every change to physical stock goes through here.
 * Writes the append-only StockMovement ledger AND updates the StockLevel snapshot.
 *
 * Per master plan: "no direct edits to balances ever" — all changes flow through movements.
 */
const prisma = require('../lib/prisma');

const DIRECTION = {
  RECEIPT: 'IN',
  RETURN: 'IN',
  QA_RELEASE: 'IN',
  PRODUCTION_OUTPUT: 'IN',
  SHIPMENT: 'OUT',
  SCRAP: 'OUT',
  QA_HOLD: 'OUT',
  PRODUCTION_CONSUME: 'OUT',
  ADJUSTMENT: 'IN', // sign of qty determines direction
  TRANSFER: 'IN', // sign of qty determines direction
};

/**
 * Record a stock movement and update the per-warehouse StockLevel snapshot.
 * Atomic.
 */
async function recordMovement(params, tx) {
  const exec = async (client) => {
    const {
      productId,
      warehouseId,
      binId,
      lotId,
      qty,
      reasonCode,
      sourceDocType,
      sourceDocId,
      operatorId,
      notes,
    } = params;

    const direction = ['ADJUSTMENT', 'TRANSFER'].includes(reasonCode)
      ? (qty >= 0 ? 'IN' : 'OUT')
      : DIRECTION[reasonCode] || 'IN';
    const signedQty = direction === 'OUT' ? -Math.abs(qty) : Math.abs(qty);

    // Upsert the StockLevel snapshot.
    const existing = await client.stockLevel.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    });

    if (existing) {
      const newOnHand = existing.onHand + signedQty;
      if (newOnHand < 0) {
        throw new Error(
          `Stock movement would cause negative on-hand for product ${productId} at warehouse ${warehouseId}`
        );
      }
      await client.stockLevel.update({
        where: { id: existing.id },
        data: { onHand: newOnHand, version: { increment: 1 } },
      });
    } else {
      if (signedQty < 0) {
        throw new Error('Cannot remove stock from a warehouse with no record');
      }
      await client.stockLevel.create({
        data: { productId, warehouseId, onHand: signedQty },
      });
    }

    if (binId) {
      const existingBin = await client.binStockLevel.findUnique({
        where: { productId_binId: { productId, binId } },
      });

      if (existingBin) {
        const newBinOnHand = existingBin.onHand + signedQty;
        if (newBinOnHand < 0) {
          throw new Error(
            `Stock movement would cause negative bin on-hand for product ${productId} at bin ${binId}`
          );
        }
        await client.binStockLevel.update({
          where: { id: existingBin.id },
          data: { onHand: newBinOnHand, version: { increment: 1 } },
        });
      } else {
        if (signedQty < 0) {
          throw new Error('Cannot remove stock from a bin with no record');
        }
        await client.binStockLevel.create({
          data: { productId, warehouseId, binId, onHand: signedQty },
        });
      }
    }

    // Append the movement.
    return client.stockMovement.create({
      data: {
        productId,
        warehouseId,
        binId,
        lotId,
        qty: signedQty,
        direction,
        reasonCode,
        sourceDocType,
        sourceDocId,
        operatorId,
        notes,
      },
    });
  };

  return tx ? exec(tx) : prisma.$transaction(exec);
}

/**
 * Move stock from one bin to another within the SAME warehouse.
 * - Does NOT change the per-warehouse StockLevel total.
 * - Updates BinStockLevel for both bins.
 * - Appends two StockMovement rows with reasonCode BIN_MOVE:
 *     leg 1: -qty on fromBin
 *     leg 2: +qty on toBin
 * - If a lot is provided, that lot's currentBinId is updated to the destination bin.
 */
async function binMove(params, tx) {
  const exec = async (client) => {
    const {
      productId,
      warehouseId,
      fromBinId,
      toBinId,
      lotId,
      qty,
      operatorId,
      notes,
    } = params;

    if (!productId || !warehouseId || !fromBinId || !toBinId) {
      throw new Error('productId, warehouseId, fromBinId, and toBinId are required');
    }
    if (fromBinId === toBinId) {
      throw new Error('Source and destination bins must differ');
    }
    const moveQty = Math.abs(Number(qty));
    if (!Number.isFinite(moveQty) || moveQty <= 0) {
      throw new Error('qty must be a positive number');
    }

    const [fromBin, toBin] = await Promise.all([
      client.binLocation.findUnique({ where: { id: fromBinId } }),
      client.binLocation.findUnique({ where: { id: toBinId } }),
    ]);
    if (!fromBin || !toBin) throw new Error('Bin not found');
    if (fromBin.warehouseId !== warehouseId || toBin.warehouseId !== warehouseId) {
      throw new Error('Both bins must belong to the same warehouse as the move');
    }

    const fromLevel = await client.binStockLevel.findUnique({
      where: { productId_binId: { productId, binId: fromBinId } },
    });
    if (!fromLevel || fromLevel.onHand < moveQty) {
      throw new Error('Insufficient stock in source bin');
    }

    // Decrement source bin
    await client.binStockLevel.update({
      where: { id: fromLevel.id },
      data: { onHand: fromLevel.onHand - moveQty, version: { increment: 1 } },
    });

    // Increment destination bin (upsert)
    const toLevel = await client.binStockLevel.findUnique({
      where: { productId_binId: { productId, binId: toBinId } },
    });
    if (toLevel) {
      await client.binStockLevel.update({
        where: { id: toLevel.id },
        data: { onHand: toLevel.onHand + moveQty, version: { increment: 1 } },
      });
    } else {
      await client.binStockLevel.create({
        data: { productId, warehouseId, binId: toBinId, onHand: moveQty },
      });
    }

    // Append two ledger entries
    const sourceDocId = `BMV-${Date.now()}`;
    const outMove = await client.stockMovement.create({
      data: {
        productId,
        warehouseId,
        binId: fromBinId,
        lotId: lotId || null,
        qty: -moveQty,
        direction: 'OUT',
        reasonCode: 'BIN_MOVE',
        sourceDocType: 'BIN_MOVE',
        sourceDocId,
        operatorId,
        notes,
      },
    });
    const inMove = await client.stockMovement.create({
      data: {
        productId,
        warehouseId,
        binId: toBinId,
        lotId: lotId || null,
        qty: moveQty,
        direction: 'IN',
        reasonCode: 'BIN_MOVE',
        sourceDocType: 'BIN_MOVE',
        sourceDocId,
        operatorId,
        notes,
      },
    });

    // If a lot moved entirely, update its currentBinId to destination.
    if (lotId) {
      await client.lot.update({
        where: { id: lotId },
        data: { currentBinId: toBinId },
      });
    }

    return { sourceDocId, outMove, inMove };
  };

  return tx ? exec(tx) : prisma.$transaction(exec);
}

module.exports = { recordMovement, binMove };
