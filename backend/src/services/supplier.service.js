/**
 * Supplier domain service.
 * Single module owning supplier core, contacts, supplier-products, documents,
 * performance, and categories. Each section is grouped under its own namespace
 * for clarity. All write paths emit audit events via logEvent.
 */
const path = require('path');
const fs = require('fs/promises');
const fsSync = require('fs');
const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const APPROVAL_STATUSES = ['DRAFT', 'UNDER_REVIEW', 'APPROVED', 'PREFERRED', 'BLOCKED'];
const PAYMENT_TERMS = ['NET15', 'NET30', 'NET45', 'NET60', 'NET90', 'COD', 'PREPAID'];
const RISK_RATINGS = ['LOW', 'MEDIUM', 'HIGH'];
const DOCUMENT_CATEGORIES = ['CONTRACT', 'NDA', 'ISO_CERT', 'INSURANCE', 'TAX_CERT', 'BANK_LETTER', 'OTHER'];
const PERFORMANCE_SOURCES = ['MANUAL', 'AUTO'];
const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads', 'suppliers');

// ─── Validation helpers ──────────────────────────────────────────────────────

function reqString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    const err = new Error(`${field} is required`);
    err.status = 400;
    throw err;
  }
  return value.trim();
}

function ensureEnum(value, allowed, field) {
  if (value == null) return value;
  if (!allowed.includes(value)) {
    const err = new Error(`${field} must be one of: ${allowed.join(', ')}`);
    err.status = 400;
    throw err;
  }
  return value;
}

function validEmail(v) {
  if (v == null || v === '') return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function bad(message, status = 400) {
  const err = new Error(message);
  err.status = status;
  throw err;
}

// ─── Suppliers ───────────────────────────────────────────────────────────────

async function listSuppliers(params = {}) {
  const {
    search,
    approvalStatus,
    country,
    categoryId,
    riskRating,
    isActive,
    limit = 100,
    offset = 0,
    sortBy = 'name',
    sortDir = 'asc',
  } = params;

  const where = { deletedAt: null };
  if (typeof isActive === 'boolean') where.isActive = isActive;
  if (approvalStatus) where.approvalStatus = approvalStatus;
  if (country) where.country = country;
  if (riskRating) where.riskRating = riskRating;
  if (search) {
    where.OR = [
      { code: { contains: search, mode: 'insensitive' } },
      { name: { contains: search, mode: 'insensitive' } },
      { legalName: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }
  if (categoryId) {
    where.categoryLinks = { some: { categoryId } };
  }

  const allowedSort = new Set(['name', 'code', 'createdAt', 'leadTimeDays', 'approvalStatus']);
  const orderBy = { [allowedSort.has(sortBy) ? sortBy : 'name']: sortDir === 'desc' ? 'desc' : 'asc' };

  const [rows, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      orderBy,
      take: Math.min(Number(limit) || 100, 500),
      skip: Number(offset) || 0,
      include: {
        categoryLinks: { include: { category: true } },
        _count: { select: { supplierProducts: true, contacts: { where: { deletedAt: null } } } },
      },
    }),
    prisma.supplier.count({ where }),
  ]);

  return { rows, total };
}

async function getSupplier(id) {
  const supplier = await prisma.supplier.findFirst({
    where: { id, deletedAt: null },
    include: {
      contacts: { where: { deletedAt: null }, orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }] },
      categoryLinks: { include: { category: true } },
      supplierProducts: {
        orderBy: [{ priority: 'asc' }],
        include: { product: { select: { id: true, sku: true, name: true, type: true, costPrice: true } } },
      },
      documents: {
        where: { deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 50,
      },
      performance: { orderBy: { periodStart: 'desc' }, take: 12 },
      purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 10 },
      _count: { select: { purchaseOrders: true } },
    },
  });
  return supplier;
}

async function getKpis() {
  const [active, preferred, underReview, blocked, expiringSoon] = await Promise.all([
    prisma.supplier.count({ where: { deletedAt: null, isActive: true } }),
    prisma.supplier.count({ where: { deletedAt: null, approvalStatus: 'PREFERRED' } }),
    prisma.supplier.count({ where: { deletedAt: null, approvalStatus: 'UNDER_REVIEW' } }),
    prisma.supplier.count({ where: { deletedAt: null, approvalStatus: 'BLOCKED' } }),
    prisma.supplierDocument.count({
      where: {
        deletedAt: null,
        expiresAt: { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
    }),
  ]);
  return { active, preferred, underReview, blocked, documentsExpiringSoon: expiringSoon };
}

function sanitizeSupplierData(data, { partial = false } = {}) {
  const out = {};
  if (!partial || data.code !== undefined) {
    if (!partial) out.code = reqString(data.code, 'code');
    else if (data.code != null) out.code = reqString(data.code, 'code');
  }
  if (!partial || data.name !== undefined) {
    if (!partial) out.name = reqString(data.name, 'name');
    else if (data.name != null) out.name = reqString(data.name, 'name');
  }

  const passthrough = [
    'legalName', 'taxId', 'currency', 'paymentTerms', 'incoterms', 'leadTimeDays',
    'primaryContact', 'email', 'phone', 'website',
    'addressLine1', 'addressLine2', 'city', 'state', 'postalCode', 'country',
    'bankName', 'bankAccountNumber', 'iban', 'swift',
    'riskRating', 'approvalStatus', 'notes', 'taxRegistered', 'isActive',
  ];
  for (const k of passthrough) {
    if (data[k] !== undefined) out[k] = data[k];
  }

  if (out.email && !validEmail(out.email)) bad('email is not a valid address');
  if (out.paymentTerms !== undefined) ensureEnum(out.paymentTerms, PAYMENT_TERMS, 'paymentTerms');
  if (out.riskRating !== undefined && out.riskRating !== null) ensureEnum(out.riskRating, RISK_RATINGS, 'riskRating');
  if (out.approvalStatus !== undefined) ensureEnum(out.approvalStatus, APPROVAL_STATUSES, 'approvalStatus');
  if (out.iban !== undefined && out.iban) {
    const cleaned = String(out.iban).replace(/\s+/g, '').toUpperCase();
    if (!/^[A-Z0-9]{15,34}$/.test(cleaned)) bad('iban must be 15-34 alphanumeric characters');
    out.iban = cleaned;
  }
  if (out.leadTimeDays !== undefined && (Number(out.leadTimeDays) < 0 || !Number.isFinite(Number(out.leadTimeDays)))) {
    bad('leadTimeDays must be >= 0');
  }

  return out;
}

async function createSupplier(data, actorId, sourceIp) {
  const payload = sanitizeSupplierData(data, { partial: false });
  const exists = await prisma.supplier.findUnique({ where: { code: payload.code }, select: { id: true } });
  if (exists) bad(`Supplier code "${payload.code}" already exists`, 409);

  const supplier = await prisma.supplier.create({ data: payload });
  await logEvent({
    eventType: 'SUPPLIER_CREATED',
    entityType: 'Supplier',
    entityId: supplier.id,
    actorId,
    payload: { after: supplier },
    sourceIp,
  });
  return supplier;
}

async function updateSupplier(id, data, actorId, sourceIp) {
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) bad('Supplier not found', 404);

  const payload = sanitizeSupplierData(data, { partial: true });
  if (payload.code && payload.code !== before.code) {
    const dup = await prisma.supplier.findUnique({ where: { code: payload.code }, select: { id: true } });
    if (dup) bad(`Supplier code "${payload.code}" already exists`, 409);
  }

  const after = await prisma.supplier.update({ where: { id }, data: payload });
  await logEvent({
    eventType: 'SUPPLIER_UPDATED',
    entityType: 'Supplier',
    entityId: id,
    actorId,
    payload: { before, after },
    sourceIp,
  });
  return after;
}

async function deactivateSupplier(id, actorId, sourceIp) {
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) bad('Supplier not found', 404);

  // Block deactivation if open POs exist (PO module wires here once Section 4 lands).
  const openPoCount = await prisma.purchaseOrder.count({
    where: { supplierId: id, status: { in: ['DRAFT', 'APPROVED', 'SENT', 'PARTIALLY_RECEIVED'] } },
  }).catch(() => 0);
  if (openPoCount > 0) bad(`Cannot deactivate supplier with ${openPoCount} open purchase order(s)`, 409);

  const after = await prisma.supplier.update({
    where: { id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await logEvent({
    eventType: 'SUPPLIER_DEACTIVATED',
    entityType: 'Supplier',
    entityId: id,
    actorId,
    payload: { before, after },
    sourceIp,
  });
  return after;
}

async function setApprovalStatus(id, status, reason, actorId, sourceIp) {
  ensureEnum(status, APPROVAL_STATUSES, 'status');
  const before = await prisma.supplier.findFirst({ where: { id, deletedAt: null } });
  if (!before) bad('Supplier not found', 404);
  if (before.approvalStatus === status) return before;

  const after = await prisma.supplier.update({ where: { id }, data: { approvalStatus: status } });
  await logEvent({
    eventType: 'SUPPLIER_STATUS_CHANGED',
    entityType: 'Supplier',
    entityId: id,
    actorId,
    payload: { from: before.approvalStatus, to: status, reason: reason || null },
    sourceIp,
  });
  return after;
}

// ─── Contacts ────────────────────────────────────────────────────────────────

async function listContacts(supplierId) {
  return prisma.supplierContact.findMany({
    where: { supplierId, deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
  });
}

async function createContact(supplierId, data, actorId, sourceIp) {
  const name = reqString(data.name, 'name');
  if (data.email && !validEmail(data.email)) bad('email is not a valid address');
  const isPrimary = !!data.isPrimary;

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } });
  if (!supplier) bad('Supplier not found', 404);

  const created = await prisma.$transaction(async (tx) => {
    if (isPrimary) {
      await tx.supplierContact.updateMany({
        where: { supplierId, deletedAt: null, isPrimary: true },
        data: { isPrimary: false },
      });
    }
    return tx.supplierContact.create({
      data: {
        supplierId,
        name,
        role: data.role || null,
        email: data.email || null,
        phone: data.phone || null,
        isPrimary,
      },
    });
  });

  await logEvent({
    eventType: 'SUPPLIER_CONTACT_CREATED',
    entityType: 'SupplierContact',
    entityId: created.id,
    actorId,
    payload: { supplierId, after: created },
    sourceIp,
  });
  return created;
}

async function updateContact(supplierId, contactId, data, actorId, sourceIp) {
  const before = await prisma.supplierContact.findFirst({
    where: { id: contactId, supplierId, deletedAt: null },
  });
  if (!before) bad('Contact not found', 404);
  if (data.email && !validEmail(data.email)) bad('email is not a valid address');

  const patch = {};
  for (const k of ['name', 'role', 'email', 'phone', 'isPrimary']) {
    if (data[k] !== undefined) patch[k] = data[k];
  }
  if (patch.name != null) patch.name = reqString(patch.name, 'name');

  const after = await prisma.$transaction(async (tx) => {
    if (patch.isPrimary === true) {
      await tx.supplierContact.updateMany({
        where: { supplierId, deletedAt: null, isPrimary: true, id: { not: contactId } },
        data: { isPrimary: false },
      });
    }
    return tx.supplierContact.update({ where: { id: contactId }, data: patch });
  });

  await logEvent({
    eventType: 'SUPPLIER_CONTACT_UPDATED',
    entityType: 'SupplierContact',
    entityId: contactId,
    actorId,
    payload: { supplierId, before, after },
    sourceIp,
  });
  return after;
}

async function deleteContact(supplierId, contactId, actorId, sourceIp) {
  const before = await prisma.supplierContact.findFirst({
    where: { id: contactId, supplierId, deletedAt: null },
  });
  if (!before) bad('Contact not found', 404);
  await prisma.supplierContact.update({ where: { id: contactId }, data: { deletedAt: new Date() } });
  await logEvent({
    eventType: 'SUPPLIER_CONTACT_DELETED',
    entityType: 'SupplierContact',
    entityId: contactId,
    actorId,
    payload: { supplierId, before },
    sourceIp,
  });
}

// ─── Supplier Products ───────────────────────────────────────────────────────

async function listSupplierProducts(supplierId) {
  return prisma.supplierProduct.findMany({
    where: { supplierId },
    orderBy: [{ priority: 'asc' }, { product: { sku: 'asc' } }],
    include: { product: { select: { id: true, sku: true, name: true, type: true, costPrice: true, uom: true } } },
  });
}

async function listSuppliersForProduct(productId) {
  return prisma.supplierProduct.findMany({
    where: { productId, supplier: { deletedAt: null, isActive: true } },
    orderBy: [{ priority: 'asc' }],
    include: {
      supplier: {
        select: {
          id: true, code: true, name: true, country: true, leadTimeDays: true,
          paymentTerms: true, currency: true, approvalStatus: true, riskRating: true,
        },
      },
    },
  });
}

async function upsertSupplierProduct(supplierId, data, actorId, sourceIp) {
  const productId = reqString(data.productId, 'productId');
  const agreedPrice = Number(data.agreedPrice);
  if (!Number.isFinite(agreedPrice) || agreedPrice < 0) bad('agreedPrice must be a positive number');
  const moq = data.moq == null ? 1 : Number(data.moq);
  if (!Number.isInteger(moq) || moq < 1) bad('moq must be a positive integer');
  const priority = data.priority == null ? 1 : Number(data.priority);
  if (![1, 2, 3].includes(priority)) bad('priority must be 1, 2, or 3');
  const leadTimeDays = data.leadTimeDays == null ? null : Number(data.leadTimeDays);
  if (leadTimeDays != null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 0)) {
    bad('leadTimeDays must be a non-negative integer');
  }

  const existing = await prisma.supplierProduct.findUnique({
    where: { supplierId_productId: { supplierId, productId } },
  });
  const payload = {
    supplierSku: data.supplierSku || null,
    agreedPrice,
    moq,
    leadTimeDays,
    priority,
  };

  const row = existing
    ? await prisma.supplierProduct.update({
        where: { supplierId_productId: { supplierId, productId } },
        data: payload,
      })
    : await prisma.supplierProduct.create({ data: { supplierId, productId, ...payload } });

  await logEvent({
    eventType: existing ? 'SUPPLIER_PRODUCT_UPDATED' : 'SUPPLIER_PRODUCT_LINKED',
    entityType: 'SupplierProduct',
    entityId: row.id,
    actorId,
    payload: { supplierId, productId, before: existing || null, after: row },
    sourceIp,
  });
  return row;
}

async function removeSupplierProduct(supplierId, productId, actorId, sourceIp) {
  const before = await prisma.supplierProduct.findUnique({
    where: { supplierId_productId: { supplierId, productId } },
  });
  if (!before) bad('Supplier product link not found', 404);
  await prisma.supplierProduct.delete({ where: { supplierId_productId: { supplierId, productId } } });
  await logEvent({
    eventType: 'SUPPLIER_PRODUCT_UNLINKED',
    entityType: 'SupplierProduct',
    entityId: before.id,
    actorId,
    payload: { supplierId, productId, before },
    sourceIp,
  });
}

// ─── Documents ───────────────────────────────────────────────────────────────

async function listDocuments(supplierId, { category, includeExpired = true } = {}) {
  const where = { supplierId, deletedAt: null };
  if (category) where.category = category;
  if (!includeExpired) where.OR = [{ expiresAt: null }, { expiresAt: { gte: new Date() } }];
  return prisma.supplierDocument.findMany({ where, orderBy: { createdAt: 'desc' } });
}

async function ensureUploadDir(supplierId) {
  const dir = path.join(UPLOAD_ROOT, supplierId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function uploadDocument(supplierId, { category, title, expiresAt, file }, actorId, sourceIp) {
  ensureEnum(category, DOCUMENT_CATEGORIES, 'category');
  if (!file) bad('file is required');
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } });
  if (!supplier) bad('Supplier not found', 404);

  const dir = await ensureUploadDir(supplierId);
  const safeName = (file.originalname || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
  const storedName = `${crypto.randomUUID()}-${safeName}`;
  const target = path.join(dir, storedName);
  await fs.writeFile(target, file.buffer);

  const row = await prisma.supplierDocument.create({
    data: {
      supplierId,
      category,
      title: title || file.originalname || safeName,
      filename: file.originalname || safeName,
      storagePath: path.relative(path.resolve(__dirname, '..', '..'), target),
      mimeType: file.mimetype,
      sizeBytes: file.size,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      uploadedById: actorId || null,
    },
  });
  await logEvent({
    eventType: 'SUPPLIER_DOCUMENT_UPLOADED',
    entityType: 'SupplierDocument',
    entityId: row.id,
    actorId,
    payload: { supplierId, category, filename: row.filename, sizeBytes: row.sizeBytes },
    sourceIp,
  });
  return row;
}

async function getDocument(docId) {
  const doc = await prisma.supplierDocument.findFirst({ where: { id: docId, deletedAt: null } });
  if (!doc) bad('Document not found', 404);
  const abs = path.resolve(__dirname, '..', '..', doc.storagePath);
  if (!fsSync.existsSync(abs)) bad('Document file missing on disk', 410);
  return { doc, absolutePath: abs };
}

async function deleteDocument(docId, actorId, sourceIp) {
  const before = await prisma.supplierDocument.findFirst({ where: { id: docId, deletedAt: null } });
  if (!before) bad('Document not found', 404);
  await prisma.supplierDocument.update({ where: { id: docId }, data: { deletedAt: new Date() } });
  await logEvent({
    eventType: 'SUPPLIER_DOCUMENT_DELETED',
    entityType: 'SupplierDocument',
    entityId: docId,
    actorId,
    payload: { supplierId: before.supplierId, filename: before.filename },
    sourceIp,
  });
}

// ─── Performance ─────────────────────────────────────────────────────────────

function computeOverallScore(perf) {
  const onTime = perf.onTimeRate ?? null;
  const fill = perf.fillRate ?? null;
  const defectInv = perf.defectRate == null ? null : 1 - perf.defectRate;
  const parts = [];
  if (onTime != null) parts.push({ w: 0.4, v: onTime });
  if (fill != null) parts.push({ w: 0.3, v: fill });
  if (defectInv != null) parts.push({ w: 0.3, v: defectInv });
  if (parts.length === 0) return null;
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  return parts.reduce((s, p) => s + p.w * p.v, 0) / totalW;
}

async function listPerformance(supplierId, { from, to } = {}) {
  const where = { supplierId };
  if (from || to) {
    where.periodStart = {};
    if (from) where.periodStart.gte = new Date(from);
    if (to) where.periodStart.lte = new Date(to);
  }
  const rows = await prisma.supplierPerformance.findMany({ where, orderBy: { periodStart: 'desc' } });
  return rows.map((r) => ({ ...r, overallScore: computeOverallScore(r) }));
}

async function upsertPerformance(supplierId, data, actorId, sourceIp) {
  if (!data.periodStart || !data.periodEnd) bad('periodStart and periodEnd are required');
  const periodStart = new Date(data.periodStart);
  const periodEnd = new Date(data.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) bad('invalid period dates');
  if (periodEnd < periodStart) bad('periodEnd must be >= periodStart');

  const numFloat = (v, name, { min = 0, max = 1 } = {}) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) bad(`${name} must be between ${min} and ${max}`);
    return n;
  };

  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } });
  if (!supplier) bad('Supplier not found', 404);

  const payload = {
    onTimeRate: numFloat(data.onTimeRate, 'onTimeRate'),
    fillRate: numFloat(data.fillRate, 'fillRate'),
    defectRate: numFloat(data.defectRate, 'defectRate'),
    leadTimeMean: data.leadTimeMean == null || data.leadTimeMean === '' ? null : Number(data.leadTimeMean),
    leadTimeStd: data.leadTimeStd == null || data.leadTimeStd === '' ? null : Number(data.leadTimeStd),
    source: ensureEnum(data.source || 'MANUAL', PERFORMANCE_SOURCES, 'source'),
    notes: data.notes || null,
    periodEnd,
  };

  const row = await prisma.supplierPerformance.upsert({
    where: { supplierId_periodStart: { supplierId, periodStart } },
    update: payload,
    create: { supplierId, periodStart, ...payload },
  });

  await logEvent({
    eventType: 'SUPPLIER_PERFORMANCE_UPSERTED',
    entityType: 'SupplierPerformance',
    entityId: row.id,
    actorId,
    payload: { supplierId, periodStart, periodEnd, source: payload.source },
    sourceIp,
  });
  return { ...row, overallScore: computeOverallScore(row) };
}

async function recomputePerformance(supplierId, periodStart, periodEnd) {
  const supplier = await prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } });
  if (!supplier) bad('Supplier not found', 404);

  // Default the period to last 90 days if not provided.
  const end = periodEnd ? new Date(periodEnd) : new Date();
  const start = periodStart ? new Date(periodStart) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);

  const poCount = await prisma.purchaseOrder.count({
    where: { supplierId, createdAt: { gte: start, lte: end } },
  });
  const grnRows = await prisma.goodsReceipt.findMany({
    where: {
      receivedAt: { gte: start, lte: end },
      status: { not: 'REVERSED' },
      purchaseOrder: { supplierId },
    },
    include: {
      purchaseOrder: { select: { id: true, sentAt: true, expectedDate: true } },
      lines: {
        include: { poLine: { select: { qtyOrdered: true, qtyReceived: true, expectedDate: true } } },
      },
    },
  });
  const grnCount = grnRows.length;

  if (poCount === 0 || grnCount === 0) {
    return {
      status: 'no_data',
      message: 'No procurement activity in the selected window.',
      poCount,
      grnCount,
    };
  }

  // On-time rate — receipt line on-time if receivedAt <= line.expectedDate (or PO.expectedDate fallback).
  let onTimeNum = 0;
  let onTimeDen = 0;
  let receivedQty = 0;
  let orderedQty = 0;
  const leadTimes = [];
  for (const grn of grnRows) {
    if (grn.purchaseOrder.sentAt) {
      leadTimes.push((grn.receivedAt - grn.purchaseOrder.sentAt) / (1000 * 60 * 60 * 24));
    }
    for (const line of grn.lines) {
      const expected = line.poLine.expectedDate || grn.purchaseOrder.expectedDate;
      if (expected) {
        onTimeDen += 1;
        if (grn.receivedAt <= expected) onTimeNum += 1;
      }
      receivedQty += line.qtyReceived;
      orderedQty += line.poLine.qtyOrdered;
    }
  }

  // Defect rate — proportion of received qty linked to lots later flagged REJECTED.
  const grnLineIds = grnRows.flatMap((g) => g.lines.map((l) => l.id));
  const rejectedLines = await prisma.goodsReceiptLine.findMany({
    where: { id: { in: grnLineIds }, qaStatus: 'REJECTED' },
    select: { qtyReceived: true },
  });
  const rejectedQty = rejectedLines.reduce((s, l) => s + l.qtyReceived, 0);

  const onTimeRate = onTimeDen > 0 ? onTimeNum / onTimeDen : null;
  const fillRate = orderedQty > 0 ? Math.min(1, receivedQty / orderedQty) : null;
  const defectRate = receivedQty > 0 ? rejectedQty / receivedQty : 0;
  let leadTimeMean = null;
  let leadTimeStd = null;
  if (leadTimes.length) {
    leadTimeMean = leadTimes.reduce((s, v) => s + v, 0) / leadTimes.length;
    const variance = leadTimes.reduce((s, v) => s + (v - leadTimeMean) ** 2, 0) / leadTimes.length;
    leadTimeStd = Math.sqrt(variance);
  }

  // Persist a SupplierPerformance row tagged AUTO (upsert by supplier+periodStart).
  const payload = {
    periodEnd: end,
    onTimeRate,
    fillRate,
    defectRate,
    leadTimeMean,
    leadTimeStd,
    source: 'AUTO',
    notes: `auto-computed from ${poCount} PO(s), ${grnCount} GRN(s)`,
  };
  const row = await prisma.supplierPerformance.upsert({
    where: { supplierId_periodStart: { supplierId, periodStart: start } },
    update: payload,
    create: { supplierId, periodStart: start, ...payload },
  });

  return {
    status: 'ok',
    poCount,
    grnCount,
    onTimeRate,
    fillRate,
    defectRate,
    leadTimeMean,
    leadTimeStd,
    overallScore: computeOverallScore(row),
    period: { periodStart: start, periodEnd: end },
    performanceId: row.id,
  };
}

// ─── Categories ──────────────────────────────────────────────────────────────

async function listCategories() {
  return prisma.supplierCategory.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { supplierLinks: true } } },
  });
}

async function createCategory(data, actorId, sourceIp) {
  const code = reqString(data.code, 'code').toUpperCase().replace(/\s+/g, '_');
  const name = reqString(data.name, 'name');
  const exists = await prisma.supplierCategory.findUnique({ where: { code }, select: { id: true } });
  if (exists) bad(`Category code "${code}" already exists`, 409);
  const row = await prisma.supplierCategory.create({
    data: { code, name, description: data.description || null },
  });
  await logEvent({
    eventType: 'SUPPLIER_CATEGORY_CREATED',
    entityType: 'SupplierCategory',
    entityId: row.id,
    actorId,
    payload: { after: row },
    sourceIp,
  });
  return row;
}

async function deleteCategory(id, actorId, sourceIp) {
  const before = await prisma.supplierCategory.findUnique({ where: { id } });
  if (!before) bad('Category not found', 404);
  await prisma.supplierCategory.delete({ where: { id } }); // cascade clears links
  await logEvent({
    eventType: 'SUPPLIER_CATEGORY_DELETED',
    entityType: 'SupplierCategory',
    entityId: id,
    actorId,
    payload: { before },
    sourceIp,
  });
}

async function attachCategory(supplierId, categoryId, actorId, sourceIp) {
  const [s, c] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } }),
    prisma.supplierCategory.findUnique({ where: { id: categoryId }, select: { id: true } }),
  ]);
  if (!s) bad('Supplier not found', 404);
  if (!c) bad('Category not found', 404);
  await prisma.supplierCategoryLink.upsert({
    where: { supplierId_categoryId: { supplierId, categoryId } },
    update: {},
    create: { supplierId, categoryId },
  });
  await logEvent({
    eventType: 'SUPPLIER_CATEGORY_ATTACHED',
    entityType: 'Supplier',
    entityId: supplierId,
    actorId,
    payload: { categoryId },
    sourceIp,
  });
}

async function detachCategory(supplierId, categoryId, actorId, sourceIp) {
  await prisma.supplierCategoryLink.deleteMany({ where: { supplierId, categoryId } });
  await logEvent({
    eventType: 'SUPPLIER_CATEGORY_DETACHED',
    entityType: 'Supplier',
    entityId: supplierId,
    actorId,
    payload: { categoryId },
    sourceIp,
  });
}

// ─── Activity (audit log feed) ───────────────────────────────────────────────

async function listActivity(supplierId, { limit = 50, offset = 0 } = {}) {
  const ids = await prisma.supplierContact.findMany({ where: { supplierId }, select: { id: true } });
  const docIds = await prisma.supplierDocument.findMany({ where: { supplierId }, select: { id: true } });
  const supProdIds = await prisma.supplierProduct.findMany({ where: { supplierId }, select: { id: true } });
  const perfIds = await prisma.supplierPerformance.findMany({ where: { supplierId }, select: { id: true } });

  const where = {
    OR: [
      { entityType: 'Supplier', entityId: supplierId },
      { entityType: 'SupplierContact', entityId: { in: ids.map((r) => r.id) } },
      { entityType: 'SupplierDocument', entityId: { in: docIds.map((r) => r.id) } },
      { entityType: 'SupplierProduct', entityId: { in: supProdIds.map((r) => r.id) } },
      { entityType: 'SupplierPerformance', entityId: { in: perfIds.map((r) => r.id) } },
    ],
  };
  return prisma.eventLog.findMany({
    where,
    orderBy: { occurredAt: 'desc' },
    take: Math.min(Number(limit) || 50, 200),
    skip: Number(offset) || 0,
  });
}

module.exports = {
  // enums
  APPROVAL_STATUSES,
  PAYMENT_TERMS,
  RISK_RATINGS,
  DOCUMENT_CATEGORIES,
  PERFORMANCE_SOURCES,
  // suppliers
  listSuppliers,
  getSupplier,
  getKpis,
  createSupplier,
  updateSupplier,
  deactivateSupplier,
  setApprovalStatus,
  // contacts
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  // supplier products
  listSupplierProducts,
  listSuppliersForProduct,
  upsertSupplierProduct,
  removeSupplierProduct,
  // documents
  listDocuments,
  uploadDocument,
  getDocument,
  deleteDocument,
  // performance
  listPerformance,
  upsertPerformance,
  recomputePerformance,
  computeOverallScore,
  // categories
  listCategories,
  createCategory,
  deleteCategory,
  attachCategory,
  detachCategory,
  // activity
  listActivity,
};
