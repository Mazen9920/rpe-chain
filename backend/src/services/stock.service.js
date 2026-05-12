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
  SHIPMENT: 'OUT',
  SCRAP: 'OUT',
  QA_HOLD: 'OUT',
  ADJUSTMENT: 'IN', // sign of qty determines direction
  TRANSFER: 'TRANSFER',
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
      lotId,
      qty,
      reasonCode,
      sourceDocType,
      sourceDocId,
      operatorId,
      notes,
    } = params;

    const direction =
      reasonCode === 'ADJUSTMENT' ? (qty >= 0 ? 'IN' : 'OUT') : DIRECTION[reasonCode] || 'IN';
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

    // Append the movement.
    return client.stockMovement.create({
      data: {
        productId,
        warehouseId,
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

module.exports = { recordMovement };
