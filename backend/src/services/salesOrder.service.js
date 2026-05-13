/**
 * Sales Order service — Section 6 (Fulfillment).
 *
 * Lifecycle:
 *   RECEIVED → CONFIRMED → ALLOCATED → PICKED → PACKED → SHIPPED → DELIVERED
 *   Any of {RECEIVED,CONFIRMED,ALLOCATED} can transition → CANCELLED (releases reservations).
 *
 * Stock model:
 *   ALLOCATE → increments StockLevel.reserved and SalesOrderLine.qtyAllocated.
 *   PICK     → records SalesOrderLine.qtyPicked (no stock effect; bin-level pick can be added later).
 *   PACK     → pure state transition.
 *   SHIP     → in single tx: depleteFifo() per line (FIFO cost layers + COGS),
 *              recordMovement(reasonCode='SHIPMENT') to reduce StockLevel.onHand,
 *              decrement StockLevel.reserved to release the reservation, update line.qtyShipped,
 *              create Shipment + ShipmentLine[], stamp SO.shippedAt + SO.status=SHIPPED.
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');
const { depleteFifo } = require('./fifo.service');
const { recordMovement } = require('./stock.service');

const STATUSES = ['RECEIVED', 'CONFIRMED', 'ALLOCATED', 'PICKED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'RETURNED'];

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function assertTransition(current, next) {
  const ok = {
    RECEIVED: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['ALLOCATED', 'CANCELLED'],
    ALLOCATED: ['PICKED', 'CANCELLED', 'CONFIRMED'], // allow de-allocate
    PICKED: ['PACKED', 'ALLOCATED'],
    PACKED: ['SHIPPED', 'PICKED'],
    SHIPPED: ['DELIVERED', 'RETURNED', 'PACKED'], // PACKED only via shipment void
    DELIVERED: ['RETURNED'],
    CANCELLED: [],
    RETURNED: [],
  };
  if (!ok[current] || !ok[current].includes(next)) {
    bad(`Cannot transition sales order from ${current} to ${next}`, 409, 'BAD_STATUS_TRANSITION');
  }
}

const SO_INCLUDE = {
  customer: { select: { id: true, code: true, name: true, currency: true, paymentTerms: true, email: true } },
  warehouse: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, type: true, sellingPrice: true } },
    },
    orderBy: { id: 'asc' },
  },
  shipments: {
    orderBy: { createdAt: 'desc' },
    include: {
      lines: true,
      createdBy: { select: { id: true, name: true } },
    },
  },
};

function dec(n) { return Number(n ?? 0); }

async function generateOrderNumber(tx) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const prefix = `SO-${y}${m}${d}-`;
  const last = await tx.salesOrder.findFirst({
    where: { orderNumber: { startsWith: prefix } },
    orderBy: { orderNumber: 'desc' },
    select: { orderNumber: true },
  });
  let seq = 1;
  if (last) {
    const n = parseInt(last.orderNumber.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ─── Reads ──────────────────────────────────────────────────────────────────

async function listSalesOrders(params = {}) {
  const { search, status, customerId, warehouseId, limit = 100, offset = 0 } = params;
  const where = {};
  if (status) where.status = status;
  if (customerId) where.customerId = customerId;
  if (warehouseId) where.warehouseId = warehouseId;
  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { customerName: { contains: search, mode: 'insensitive' } },
    ];
  }
  const [total, items] = await Promise.all([
    prisma.salesOrder.count({ where }),
    prisma.salesOrder.findMany({
      where,
      include: {
        customer: { select: { id: true, code: true, name: true } },
        warehouse: { select: { id: true, code: true, name: true } },
        _count: { select: { lines: true, shipments: true } },
      },
      orderBy: { orderedAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
    }),
  ]);
  return { total, items };
}

async function getSalesOrderById(id) {
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: SO_INCLUDE });
  if (!so) bad('Sales order not found', 404);
  return so;
}

async function kpis() {
  const rows = await prisma.salesOrder.groupBy({
    by: ['status'],
    _count: { _all: true },
    _sum: { totalAmount: true },
  });
  const byStatus = {};
  for (const s of STATUSES) byStatus[s] = { count: 0, totalAmount: 0 };
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = { count: r._count._all, totalAmount: dec(r._sum.totalAmount) };
    total += r._count._all;
  }
  const open = (byStatus.RECEIVED.count + byStatus.CONFIRMED.count + byStatus.ALLOCATED.count + byStatus.PICKED.count + byStatus.PACKED.count);
  const readyToShip = byStatus.PACKED.count;
  const inFulfillment = byStatus.ALLOCATED.count + byStatus.PICKED.count + byStatus.PACKED.count;
  const shipped = byStatus.SHIPPED.count + byStatus.DELIVERED.count;
  return { total, open, readyToShip, inFulfillment, shipped, byStatus };
}

// ─── Writes ─────────────────────────────────────────────────────────────────

async function createSalesOrder(data, actor, sourceIp) {
  if (!data || !Array.isArray(data.lines) || data.lines.length === 0) {
    bad('Order must include at least one line', 400, 'EMPTY_ORDER');
  }
  let customerSnap = { id: null, name: data.customerName, email: data.customerEmail || null, currency: data.currency || 'USD' };
  if (data.customerId) {
    const cust = await prisma.customer.findFirst({ where: { id: data.customerId, deletedAt: null } });
    if (!cust) bad('Customer not found', 404);
    if (!cust.isActive) bad('Customer is inactive', 409, 'CUSTOMER_INACTIVE');
    customerSnap = { id: cust.id, name: cust.name, email: cust.email, currency: cust.currency };
  } else {
    if (!data.customerName) bad('customerName or customerId required', 400);
  }

  if (data.warehouseId) {
    const wh = await prisma.warehouse.findFirst({ where: { id: data.warehouseId, isActive: true } });
    if (!wh) bad('Warehouse not found or inactive', 404);
  }

  // Validate lines + snapshot prices
  const productIds = [...new Set(data.lines.map((l) => l.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  const productMap = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  let total = 0;
  for (const l of data.lines) {
    const p = productMap.get(l.productId);
    if (!p) bad(`Product not found: ${l.productId}`, 404);
    if (!p.isActive) bad(`Product ${p.sku} is inactive`, 409, 'PRODUCT_NOT_SELLABLE');
    if (!['FINISHED', 'PACKAGING'].includes(p.type)) {
      bad(`Product ${p.sku} (${p.type}) is not sellable`, 409, 'PRODUCT_NOT_SELLABLE');
    }
    const qty = parseInt(l.qty, 10);
    if (!qty || qty <= 0) bad('Line qty must be positive', 400);
    const unitPrice = l.unitPrice != null ? dec(l.unitPrice) : dec(p.sellingPrice);
    total += qty * unitPrice;
    lines.push({
      productId: p.id,
      qty,
      unitPrice,
      notes: l.notes || null,
    });
  }

  const so = await prisma.$transaction(async (tx) => {
    const orderNumber = data.orderNumber || (await generateOrderNumber(tx));
    return tx.salesOrder.create({
      data: {
        orderNumber,
        source: data.source || 'MANUAL',
        externalId: data.externalId || null,
        customerId: customerSnap.id,
        customerName: customerSnap.name,
        customerEmail: customerSnap.email,
        warehouseId: data.warehouseId || null,
        status: 'RECEIVED',
        totalAmount: total,
        currency: customerSnap.currency,
        notes: data.notes || null,
        createdById: actor?.id || null,
        lines: { create: lines },
      },
      include: SO_INCLUDE,
    });
  });

  await logEvent({
    eventType: 'SO_CREATED',
    entityType: 'SalesOrder',
    entityId: so.id,
    actorId: actor?.id,
    payload: { orderNumber: so.orderNumber, lineCount: lines.length, totalAmount: total },
    sourceIp,
  });
  return so;
}

async function updateSalesOrder(id, data, actor, sourceIp) {
  const existing = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!existing) bad('Sales order not found', 404);
  if (existing.status !== 'RECEIVED') bad('Order can only be edited in RECEIVED status', 409, 'BAD_STATUS_TRANSITION');

  const patch = {};
  for (const f of ['customerName', 'customerEmail', 'warehouseId', 'notes', 'currency']) {
    if (data[f] !== undefined) patch[f] = data[f];
  }
  // Note: line edits not supported in v1.0; recommend cancel + new SO.
  const so = await prisma.salesOrder.update({ where: { id }, data: patch, include: SO_INCLUDE });
  await logEvent({
    eventType: 'SO_UPDATED',
    entityType: 'SalesOrder',
    entityId: id,
    actorId: actor?.id,
    payload: { fields: Object.keys(patch) },
    sourceIp,
  });
  return so;
}

async function confirmOrder(id, actor, sourceIp) {
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!so) bad('Sales order not found', 404);
  assertTransition(so.status, 'CONFIRMED');
  if (so.lines.length === 0) bad('Order has no lines', 409, 'EMPTY_ORDER');

  const updated = await prisma.salesOrder.update({
    where: { id },
    data: { status: 'CONFIRMED', confirmedAt: new Date() },
    include: SO_INCLUDE,
  });
  await logEvent({
    eventType: 'SO_CONFIRMED',
    entityType: 'SalesOrder',
    entityId: id,
    actorId: actor?.id,
    payload: { orderNumber: so.orderNumber },
    sourceIp,
  });
  return updated;
}

async function allocateOrder(id, actor, sourceIp) {
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!so) bad('Sales order not found', 404);
  assertTransition(so.status, 'ALLOCATED');
  if (!so.warehouseId) bad('Order has no warehouse assigned', 400);

  // Pre-validate availability for ALL lines (sum same products)
  const needByProduct = new Map();
  for (const line of so.lines) {
    const need = line.qty - line.qtyAllocated;
    if (need <= 0) continue;
    needByProduct.set(line.productId, (needByProduct.get(line.productId) || 0) + need);
  }

  const shortages = [];
  for (const [productId, need] of needByProduct) {
    const stock = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId, warehouseId: so.warehouseId } },
    });
    const available = stock ? stock.onHand - stock.reserved : 0;
    if (available < need) {
      const product = await prisma.product.findUnique({ where: { id: productId }, select: { sku: true, name: true } });
      shortages.push({ productId, sku: product?.sku, name: product?.name, need, available });
    }
  }
  if (shortages.length) {
    const err = new Error(`Insufficient stock for ${shortages.length} product(s)`);
    err.status = 409;
    err.code = 'INSUFFICIENT_STOCK';
    err.details = shortages;
    throw err;
  }

  const updated = await prisma.$transaction(async (tx) => {
    for (const line of so.lines) {
      const need = line.qty - line.qtyAllocated;
      if (need <= 0) continue;
      await tx.stockLevel.update({
        where: { productId_warehouseId: { productId: line.productId, warehouseId: so.warehouseId } },
        data: { reserved: { increment: need }, version: { increment: 1 } },
      });
      await tx.salesOrderLine.update({
        where: { id: line.id },
        data: { qtyAllocated: line.qty },
      });
    }
    return tx.salesOrder.update({
      where: { id },
      data: { status: 'ALLOCATED', allocatedAt: new Date() },
      include: SO_INCLUDE,
    });
  });
  await logEvent({
    eventType: 'SO_ALLOCATED',
    entityType: 'SalesOrder',
    entityId: id,
    actorId: actor?.id,
    payload: { orderNumber: so.orderNumber, warehouseId: so.warehouseId },
    sourceIp,
  });
  return updated;
}

async function pickOrder(id, data, actor, sourceIp) {
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!so) bad('Sales order not found', 404);
  assertTransition(so.status, 'PICKED');

  // Allow optional per-line picks; default = qtyAllocated
  const linePicks = new Map((data?.linePicks || []).map((lp) => [lp.lineId, parseInt(lp.qtyPicked, 10)]));
  const updated = await prisma.$transaction(async (tx) => {
    for (const line of so.lines) {
      let qtyPicked = linePicks.has(line.id) ? linePicks.get(line.id) : line.qtyAllocated;
      if (qtyPicked < 0) bad('qtyPicked must be non-negative', 400);
      if (qtyPicked > line.qtyAllocated) {
        bad(`qtyPicked (${qtyPicked}) exceeds qtyAllocated (${line.qtyAllocated}) on line ${line.id}`, 409, 'OVER_PICK');
      }
      await tx.salesOrderLine.update({ where: { id: line.id }, data: { qtyPicked } });
    }
    return tx.salesOrder.update({
      where: { id },
      data: { status: 'PICKED', pickedAt: new Date() },
      include: SO_INCLUDE,
    });
  });
  await logEvent({
    eventType: 'SO_PICKED',
    entityType: 'SalesOrder',
    entityId: id,
    actorId: actor?.id,
    payload: { orderNumber: so.orderNumber },
    sourceIp,
  });
  return updated;
}

async function packOrder(id, actor, sourceIp) {
  const so = await prisma.salesOrder.findUnique({ where: { id } });
  if (!so) bad('Sales order not found', 404);
  assertTransition(so.status, 'PACKED');
  const updated = await prisma.salesOrder.update({
    where: { id },
    data: { status: 'PACKED', packedAt: new Date() },
    include: SO_INCLUDE,
  });
  await logEvent({
    eventType: 'SO_PACKED',
    entityType: 'SalesOrder',
    entityId: id,
    actorId: actor?.id,
    payload: { orderNumber: so.orderNumber },
    sourceIp,
  });
  return updated;
}

async function generateShipmentNumber(tx) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  const prefix = `SHP-${y}${m}${d}-`;
  const last = await tx.shipment.findFirst({
    where: { shipmentNumber: { startsWith: prefix } },
    orderBy: { shipmentNumber: 'desc' },
    select: { shipmentNumber: true },
  });
  let seq = 1;
  if (last) {
    const n = parseInt(last.shipmentNumber.slice(prefix.length), 10);
    if (!isNaN(n)) seq = n + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

async function shipOrder(id, data, actor, sourceIp) {
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!so) bad('Sales order not found', 404);
  assertTransition(so.status, 'SHIPPED');
  if (!so.warehouseId) bad('Order has no warehouse assigned', 400);

  // What to ship: defaults to qtyPicked per line; allow override via data.lines [{ lineId, qty }]
  const overrides = new Map((data?.lines || []).map((l) => [l.lineId, parseInt(l.qty, 10)]));
  const toShip = [];
  for (const line of so.lines) {
    const qty = overrides.has(line.id) ? overrides.get(line.id) : line.qtyPicked;
    if (qty < 0) bad('Ship qty must be non-negative', 400);
    if (qty > line.qtyPicked) bad(`Ship qty (${qty}) exceeds qtyPicked (${line.qtyPicked})`, 409, 'OVER_SHIP');
    if (qty > 0) toShip.push({ line, qty });
  }
  if (toShip.length === 0) bad('Nothing to ship', 400, 'EMPTY_SHIPMENT');

  // Pre-validate stock (sum by product)
  const needByProduct = new Map();
  for (const { line, qty } of toShip) {
    needByProduct.set(line.productId, (needByProduct.get(line.productId) || 0) + qty);
  }
  for (const [productId, need] of needByProduct) {
    const stock = await prisma.stockLevel.findUnique({
      where: { productId_warehouseId: { productId, warehouseId: so.warehouseId } },
    });
    if (!stock || stock.onHand < need) {
      bad(`Insufficient stock for product ${productId} (need ${need}, have ${stock?.onHand || 0})`, 409, 'INSUFFICIENT_STOCK');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const shipmentNumber = data.shipmentNumber || (await generateShipmentNumber(tx));
    const shipment = await tx.shipment.create({
      data: {
        shipmentNumber,
        salesOrderId: so.id,
        warehouseId: so.warehouseId,
        carrier: data.carrier || null,
        carrierRef: data.carrierRef || null,
        trackingNumber: data.trackingNumber || null,
        status: data.markInTransit ? 'IN_TRANSIT' : 'PENDING',
        dispatchedAt: data.markInTransit ? new Date() : null,
        estimatedArrival: data.estimatedArrival ? new Date(data.estimatedArrival) : null,
        notes: data.notes || null,
        createdById: actor.id,
      },
    });

    for (const { line, qty } of toShip) {
      // FIFO deplete
      const { totalCogs } = await depleteFifo(
        { productId: line.productId, warehouseId: so.warehouseId, qty, shipmentId: shipment.id, salesOrderId: so.id },
        tx,
      );
      const unitCost = qty > 0 ? totalCogs / qty : 0;

      // Stock movement (decrement onHand)
      await recordMovement(
        {
          productId: line.productId,
          warehouseId: so.warehouseId,
          qty,
          reasonCode: 'SHIPMENT',
          sourceDocType: 'SHIPMENT',
          sourceDocId: shipment.id,
          operatorId: actor.id,
        },
        tx,
      );

      // Release reservation for shipped qty
      await tx.stockLevel.update({
        where: { productId_warehouseId: { productId: line.productId, warehouseId: so.warehouseId } },
        data: { reserved: { decrement: qty }, version: { increment: 1 } },
      });

      // Create shipment line + bump SO line.qtyShipped
      await tx.shipmentLine.create({
        data: {
          shipmentId: shipment.id,
          salesOrderLineId: line.id,
          productId: line.productId,
          qty,
          unitPrice: line.unitPrice,
          unitCost,
        },
      });
      await tx.salesOrderLine.update({
        where: { id: line.id },
        data: { qtyShipped: { increment: qty } },
      });
    }

    // Flip SO status: if any line still has remaining (qty > qtyShipped after this) we keep PACKED? In v1.0 require full ship.
    const refreshed = await tx.salesOrderLine.findMany({ where: { salesOrderId: so.id } });
    const fullyShipped = refreshed.every((l) => l.qtyShipped >= l.qty);
    const newStatus = fullyShipped ? 'SHIPPED' : 'PACKED'; // partials stay PACKED for more shipments
    await tx.salesOrder.update({
      where: { id: so.id },
      data: {
        status: newStatus,
        shippedAt: fullyShipped ? new Date() : so.shippedAt,
      },
    });

    return { shipment, fullyShipped };
  });

  await logEvent({
    eventType: 'SO_SHIPPED',
    entityType: 'SalesOrder',
    entityId: so.id,
    actorId: actor?.id,
    payload: {
      orderNumber: so.orderNumber,
      shipmentId: result.shipment.id,
      shipmentNumber: result.shipment.shipmentNumber,
      fullyShipped: result.fullyShipped,
    },
    sourceIp,
  });
  await logEvent({
    eventType: 'SHIPMENT_CREATED',
    entityType: 'Shipment',
    entityId: result.shipment.id,
    actorId: actor?.id,
    payload: { shipmentNumber: result.shipment.shipmentNumber, salesOrderId: so.id },
    sourceIp,
  });

  return getSalesOrderById(so.id);
}

async function cancelOrder(id, data, actor, sourceIp) {
  const so = await prisma.salesOrder.findUnique({ where: { id }, include: { lines: true } });
  if (!so) bad('Sales order not found', 404);
  if (!['RECEIVED', 'CONFIRMED', 'ALLOCATED'].includes(so.status)) {
    bad(`Cannot cancel order in status ${so.status}`, 409, 'BAD_STATUS_TRANSITION');
  }
  const reason = data?.reason || 'No reason provided';

  const updated = await prisma.$transaction(async (tx) => {
    // Release reservations if allocated
    if (so.status === 'ALLOCATED' && so.warehouseId) {
      for (const line of so.lines) {
        if (line.qtyAllocated > 0) {
          await tx.stockLevel.update({
            where: { productId_warehouseId: { productId: line.productId, warehouseId: so.warehouseId } },
            data: { reserved: { decrement: line.qtyAllocated }, version: { increment: 1 } },
          });
          await tx.salesOrderLine.update({ where: { id: line.id }, data: { qtyAllocated: 0 } });
        }
      }
    }
    return tx.salesOrder.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason },
      include: SO_INCLUDE,
    });
  });
  await logEvent({
    eventType: 'SO_CANCELLED',
    entityType: 'SalesOrder',
    entityId: id,
    actorId: actor?.id,
    payload: { orderNumber: so.orderNumber, reason, fromStatus: so.status },
    sourceIp,
  });
  return updated;
}

module.exports = {
  STATUSES,
  listSalesOrders,
  getSalesOrderById,
  kpis,
  createSalesOrder,
  updateSalesOrder,
  confirmOrder,
  allocateOrder,
  pickOrder,
  packOrder,
  shipOrder,
  cancelOrder,
};
