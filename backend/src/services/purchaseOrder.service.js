/**
 * Purchase Order service — Section 4.
 * Owns the entire PO lifecycle: draft → submit → approve → send → receive → close.
 * All write paths emit audit events; status transitions raise 409 BAD_STATUS_TRANSITION.
 */
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'];
const OPEN_PO_STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'];

function bad(message, status = 400, code) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  throw err;
}

function genPoNumber() {
  return `PO-${Date.now()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

function assertTransition(current, next) {
  const ok = {
    DRAFT: ['PENDING_APPROVAL', 'CANCELLED'],
    PENDING_APPROVAL: ['APPROVED', 'DRAFT', 'CANCELLED'],
    APPROVED: ['SENT', 'CANCELLED'],
    SENT: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
    PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
    RECEIVED: [],
    CANCELLED: [],
  };
  if (!ok[current] || !ok[current].includes(next)) {
    bad(`Cannot transition PO from ${current} to ${next}`, 409, 'BAD_STATUS_TRANSITION');
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

async function listPOs(filters = {}) {
  const { status, supplierId, warehouseId, search, dateFrom, dateTo, limit = 100, offset = 0 } = filters;
  const where = { deletedAt: null };
  if (status) where.status = status;
  if (supplierId) where.supplierId = supplierId;
  if (search) {
    where.OR = [
      { poNumber: { contains: search, mode: 'insensitive' } },
      { supplier: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }
  // warehouseId filter — POs themselves don't carry a warehouse; filter by any receipt's warehouse
  if (warehouseId) {
    where.goodsReceipts = { some: { warehouseId } };
  }

  const [rows, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, name: true } },
        approvedBy: { select: { id: true, name: true } },
        _count: { select: { lines: true, goodsReceipts: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(limit) || 100, 500),
      skip: Number(offset) || 0,
    }),
    prisma.purchaseOrder.count({ where }),
  ]);
  return { rows, total };
}

async function getPO(id) {
  const po = await prisma.purchaseOrder.findFirst({
    where: { id, deletedAt: null },
    include: {
      supplier: true,
      createdBy: { select: { id: true, name: true, email: true } },
      approvedBy: { select: { id: true, name: true, email: true } },
      requestedBy: { select: { id: true, name: true, email: true } },
      lines: {
        include: { product: { select: { id: true, sku: true, name: true, uom: true } } },
        orderBy: { id: 'asc' },
      },
      goodsReceipts: {
        include: {
          warehouse: { select: { id: true, code: true, name: true } },
          receivedBy: { select: { id: true, name: true } },
          reversedBy: { select: { id: true, name: true } },
          lines: {
            include: {
              poLine: { include: { product: { select: { id: true, sku: true, name: true } } } },
              qaActionedBy: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { receivedAt: 'desc' },
      },
      landedCostAllocations: { orderBy: { createdAt: 'asc' } },
    },
  });
  return po;
}

async function getKpis() {
  const [draft, pending, approved, sent, partial, receivedThisMonth, cancelled, totalThisMonth] = await Promise.all([
    prisma.purchaseOrder.count({ where: { deletedAt: null, status: 'DRAFT' } }),
    prisma.purchaseOrder.count({ where: { deletedAt: null, status: 'PENDING_APPROVAL' } }),
    prisma.purchaseOrder.count({ where: { deletedAt: null, status: 'APPROVED' } }),
    prisma.purchaseOrder.count({ where: { deletedAt: null, status: 'SENT' } }),
    prisma.purchaseOrder.count({ where: { deletedAt: null, status: 'PARTIALLY_RECEIVED' } }),
    prisma.purchaseOrder.count({
      where: {
        deletedAt: null,
        status: 'RECEIVED',
        updatedAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
    prisma.purchaseOrder.count({ where: { deletedAt: null, status: 'CANCELLED' } }),
    prisma.purchaseOrder.count({
      where: {
        deletedAt: null,
        createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      },
    }),
  ]);
  const inTransit = sent + partial;
  const openValueAgg = await prisma.purchaseOrder.aggregate({
    where: { deletedAt: null, status: { in: ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } },
    _sum: { totalAmount: true },
  });
  const cancelRate = totalThisMonth > 0 ? cancelled / totalThisMonth : 0;
  return {
    draft,
    pendingApproval: pending,
    approved,
    sent,
    partiallyReceived: partial,
    inTransit,
    receivedThisMonth,
    cancelled,
    cancelRate,
    openValue: Number(openValueAgg._sum.totalAmount || 0),
  };
}

async function listActivity(id, { limit = 50 } = {}) {
  return prisma.eventLog.findMany({
    where: { entityType: 'PurchaseOrder', entityId: id },
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Number(limit) || 50, 200),
    include: { actor: { select: { id: true, name: true, email: true } } },
  });
}

// ─── Writes ───────────────────────────────────────────────────────────────────

function validatePOInput(data, { partial = false } = {}) {
  if (!partial) {
    if (!data.supplierId) bad('supplierId is required');
    if (!Array.isArray(data.lines) || data.lines.length === 0) {
      bad('PO must contain at least one line');
    }
  }
  if (data.lines) {
    for (const l of data.lines) {
      if (!l.productId) bad('Line productId is required');
      if (!(Number(l.qtyOrdered) > 0)) bad('Line qtyOrdered must be > 0');
      if (Number(l.unitPrice) < 0) bad('Line unitPrice must be >= 0');
    }
  }
}

function calcTotal(lines) {
  return lines.reduce((s, l) => s + Number(l.qtyOrdered) * Number(l.unitPrice), 0);
}

async function createPO(data, actor, sourceIp) {
  validatePOInput(data, { partial: false });
  const supplier = await prisma.supplier.findFirst({
    where: { id: data.supplierId, deletedAt: null },
    select: { id: true, currency: true, isActive: true },
  });
  if (!supplier) bad('Supplier not found', 404);
  if (!supplier.isActive) bad('Supplier is inactive', 409);

  const po = await prisma.purchaseOrder.create({
    data: {
      poNumber: data.poNumber || genPoNumber(),
      supplierId: data.supplierId,
      currency: (() => {
        const c = data.currency || supplier.currency;
        if (!c) bad('currency required (no supplier default)', 400, 'CURRENCY_REQUIRED');
        return String(c).toUpperCase();
      })(),
      expectedDate: data.expectedDate ? new Date(data.expectedDate) : null,
      notes: data.notes || null,
      requestedById: data.requestedById || actor.id,
      createdById: actor.id,
      totalAmount: calcTotal(data.lines),
      lines: {
        create: data.lines.map((l) => ({
          productId: l.productId,
          qtyOrdered: Number(l.qtyOrdered),
          unitPrice: Number(l.unitPrice),
          expectedDate: l.expectedDate ? new Date(l.expectedDate) : null,
          notes: l.notes || null,
        })),
      },
    },
    include: { lines: true },
  });

  await logEvent({
    eventType: 'PO_CREATED',
    entityType: 'PurchaseOrder',
    entityId: po.id,
    actorId: actor.id,
    payload: { poNumber: po.poNumber, supplierId: po.supplierId, totalAmount: Number(po.totalAmount), currency: po.currency },
    sourceIp,
  });
  return po;
}

async function updateDraft(id, data, actor, sourceIp) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
  if (!po) bad('Purchase order not found', 404);
  if (po.status !== 'DRAFT') bad(`Cannot edit PO in status ${po.status}`, 409, 'BAD_STATUS_TRANSITION');
  validatePOInput(data, { partial: true });

  const newLines = Array.isArray(data.lines) ? data.lines : null;

  const updated = await prisma.$transaction(async (tx) => {
    if (newLines) {
      const incomingIds = new Set(newLines.filter((l) => l.id).map((l) => l.id));
      // Delete lines that were removed
      const toDelete = po.lines.filter((l) => !incomingIds.has(l.id)).map((l) => l.id);
      if (toDelete.length) {
        await tx.purchaseOrderLine.deleteMany({ where: { id: { in: toDelete } } });
      }
      // Upsert provided lines
      for (const l of newLines) {
        if (l.id && po.lines.some((p) => p.id === l.id)) {
          await tx.purchaseOrderLine.update({
            where: { id: l.id },
            data: {
              productId: l.productId,
              qtyOrdered: Number(l.qtyOrdered),
              unitPrice: Number(l.unitPrice),
              expectedDate: l.expectedDate ? new Date(l.expectedDate) : null,
              notes: l.notes ?? null,
            },
          });
        } else {
          await tx.purchaseOrderLine.create({
            data: {
              purchaseOrderId: id,
              productId: l.productId,
              qtyOrdered: Number(l.qtyOrdered),
              unitPrice: Number(l.unitPrice),
              expectedDate: l.expectedDate ? new Date(l.expectedDate) : null,
              notes: l.notes ?? null,
            },
          });
        }
      }
    }
    const headerData = {};
    if (data.supplierId !== undefined) headerData.supplierId = data.supplierId;
    if (data.currency !== undefined) headerData.currency = data.currency;
    if (data.expectedDate !== undefined) headerData.expectedDate = data.expectedDate ? new Date(data.expectedDate) : null;
    if (data.notes !== undefined) headerData.notes = data.notes;
    if (data.requestedById !== undefined) headerData.requestedById = data.requestedById;

    // Recompute total from latest lines
    const lines = await tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: id } });
    headerData.totalAmount = lines.reduce((s, l) => s + Number(l.qtyOrdered) * Number(l.unitPrice), 0);
    return tx.purchaseOrder.update({ where: { id }, data: headerData, include: { lines: true } });
  });

  await logEvent({
    eventType: 'PO_UPDATED',
    entityType: 'PurchaseOrder',
    entityId: id,
    actorId: actor.id,
    payload: { totalAmount: Number(updated.totalAmount) },
    sourceIp,
  });
  return updated;
}

async function submitForApproval(id, actor, sourceIp) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
  if (!po) bad('Purchase order not found', 404);
  assertTransition(po.status, 'PENDING_APPROVAL');
  if (!po.lines.length) bad('PO must have at least one line before submission', 400);
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'PENDING_APPROVAL', submittedAt: new Date() },
  });
  await logEvent({
    eventType: 'PO_SUBMITTED',
    entityType: 'PurchaseOrder',
    entityId: id,
    actorId: actor.id,
    sourceIp,
  });
  return updated;
}

async function approvePO(id, actor, sourceIp) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) bad('Purchase order not found', 404);
  assertTransition(po.status, 'APPROVED');
  // Same-user approval blocked unless ADMIN.
  if (actor.role !== 'ADMIN' && po.createdById === actor.id) {
    bad('Cannot approve your own purchase order', 403, 'SELF_APPROVAL_FORBIDDEN');
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() },
  });
  await logEvent({
    eventType: 'PO_APPROVED',
    entityType: 'PurchaseOrder',
    entityId: id,
    actorId: actor.id,
    sourceIp,
  });
  return updated;
}

async function sendPO(id, actor, sourceIp) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) bad('Purchase order not found', 404);
  assertTransition(po.status, 'SENT');
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'SENT', sentAt: new Date() },
  });
  await logEvent({
    eventType: 'PO_SENT',
    entityType: 'PurchaseOrder',
    entityId: id,
    actorId: actor.id,
    sourceIp,
  });
  return updated;
}

async function cancelPO(id, reason, actor, sourceIp) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) bad('Purchase order not found', 404);
  if (!OPEN_PO_STATUSES.includes(po.status)) {
    bad(`Cannot cancel PO in status ${po.status}`, 409, 'BAD_STATUS_TRANSITION');
  }
  // Cancelling after APPROVED/SENT/PARTIALLY_RECEIVED requires ADMIN.
  if (['APPROVED', 'SENT', 'PARTIALLY_RECEIVED'].includes(po.status) && actor.role !== 'ADMIN') {
    bad('Only ADMIN can cancel a PO after approval', 403);
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason || null },
  });
  await logEvent({
    eventType: 'PO_CANCELLED',
    entityType: 'PurchaseOrder',
    entityId: id,
    actorId: actor.id,
    payload: { reason: reason || null, previousStatus: po.status },
    sourceIp,
  });
  return updated;
}

async function closePO(id, actor, sourceIp) {
  const po = await prisma.purchaseOrder.findFirst({ where: { id, deletedAt: null } });
  if (!po) bad('Purchase order not found', 404);
  if (po.status !== 'PARTIALLY_RECEIVED' && po.status !== 'RECEIVED') {
    bad(`Cannot close PO in status ${po.status}`, 409, 'BAD_STATUS_TRANSITION');
  }
  const updated = await prisma.purchaseOrder.update({
    where: { id },
    data: { status: 'RECEIVED' },
  });
  await logEvent({
    eventType: 'PO_CLOSED',
    entityType: 'PurchaseOrder',
    entityId: id,
    actorId: actor.id,
    sourceIp,
  });
  return updated;
}

module.exports = {
  PO_STATUSES,
  OPEN_PO_STATUSES,
  listPOs,
  getPO,
  getKpis,
  listActivity,
  createPO,
  updateDraft,
  submitForApproval,
  approvePO,
  sendPO,
  cancelPO,
  closePO,
};
