const path = require('path');
const fs = require('fs');
const multer = require('multer');
const svc = require('../services/supplier.service');

// In-memory upload (10MB cap, mimetype allowlist) — written to disk by service
// after row creation to avoid orphaned files on validation failure.
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/msword',
  'application/vnd.ms-excel',
  'text/plain',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(Object.assign(new Error('Unsupported file type'), { status: 400 }));
    }
    cb(null, true);
  },
});

const wrap = (fn) => async (req, res, next) => {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
};

const ctx = (req) => ({ actorId: req.user?.id, sourceIp: req.ip });

// ─── Suppliers ──────────────────────────────────────────────────────────────

const list = wrap(async (req, res) => {
  const result = await svc.listSuppliers({
    search: req.query.search,
    approvalStatus: req.query.approvalStatus,
    country: req.query.country,
    categoryId: req.query.categoryId,
    riskRating: req.query.riskRating,
    isActive: req.query.isActive == null ? undefined : req.query.isActive === 'true',
    limit: req.query.limit,
    offset: req.query.offset,
    sortBy: req.query.sortBy,
    sortDir: req.query.sortDir,
  });
  res.json(result);
});

const kpis = wrap(async (_req, res) => {
  res.json(await svc.getKpis());
});

const getById = wrap(async (req, res) => {
  const supplier = await svc.getSupplier(req.params.id);
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  res.json(supplier);
});

const create = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  const supplier = await svc.createSupplier(req.body, actorId, sourceIp);
  res.status(201).json(supplier);
});

const update = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  const supplier = await svc.updateSupplier(req.params.id, req.body, actorId, sourceIp);
  res.json(supplier);
});

const remove = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.deactivateSupplier(req.params.id, actorId, sourceIp);
  res.status(204).send();
});

const setApproval = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  const supplier = await svc.setApprovalStatus(req.params.id, req.body.status, req.body.reason, actorId, sourceIp);
  res.json(supplier);
});

// ─── Contacts ───────────────────────────────────────────────────────────────

const listContacts = wrap(async (req, res) => res.json(await svc.listContacts(req.params.id)));
const createContact = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  res.status(201).json(await svc.createContact(req.params.id, req.body, actorId, sourceIp));
});
const updateContact = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  res.json(await svc.updateContact(req.params.id, req.params.contactId, req.body, actorId, sourceIp));
});
const deleteContact = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.deleteContact(req.params.id, req.params.contactId, actorId, sourceIp);
  res.status(204).send();
});

// ─── Supplier Products ──────────────────────────────────────────────────────

const listProducts = wrap(async (req, res) => res.json(await svc.listSupplierProducts(req.params.id)));
const upsertProduct = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  res.json(await svc.upsertSupplierProduct(req.params.id, req.body, actorId, sourceIp));
});
const removeProduct = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.removeSupplierProduct(req.params.id, req.params.productId, actorId, sourceIp);
  res.status(204).send();
});
const listForProduct = wrap(async (req, res) => res.json(await svc.listSuppliersForProduct(req.params.productId)));

// ─── Documents ──────────────────────────────────────────────────────────────

const listDocs = wrap(async (req, res) => {
  res.json(await svc.listDocuments(req.params.id, {
    category: req.query.category,
    includeExpired: req.query.includeExpired !== 'false',
  }));
});

const uploadDoc = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  const row = await svc.uploadDocument(
    req.params.id,
    {
      category: req.body.category,
      title: req.body.title,
      expiresAt: req.body.expiresAt || null,
      file: req.file,
    },
    actorId,
    sourceIp
  );
  res.status(201).json(row);
});

const downloadDoc = wrap(async (req, res) => {
  const { doc, buffer } = await svc.getDocument(req.params.docId);
  res.setHeader('Content-Type', doc.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${path.basename(doc.filename)}"`);
  res.send(buffer);
});

const deleteDoc = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.deleteDocument(req.params.docId, actorId, sourceIp);
  res.status(204).send();
});

// ─── Performance ────────────────────────────────────────────────────────────

const listPerf = wrap(async (req, res) => {
  res.json(await svc.listPerformance(req.params.id, { from: req.query.from, to: req.query.to }));
});
const upsertPerf = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  res.json(await svc.upsertPerformance(req.params.id, req.body, actorId, sourceIp));
});
const recomputePerf = wrap(async (req, res) => {
  res.json(await svc.recomputePerformance(req.params.id, req.body.periodStart, req.body.periodEnd));
});

// ─── Categories ─────────────────────────────────────────────────────────────

const listCategories = wrap(async (_req, res) => res.json(await svc.listCategories()));
const createCategory = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  res.status(201).json(await svc.createCategory(req.body, actorId, sourceIp));
});
const deleteCategory = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.deleteCategory(req.params.id, actorId, sourceIp);
  res.status(204).send();
});
const attachCategory = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.attachCategory(req.params.id, req.params.categoryId, actorId, sourceIp);
  res.status(204).send();
});
const detachCategory = wrap(async (req, res) => {
  const { actorId, sourceIp } = ctx(req);
  await svc.detachCategory(req.params.id, req.params.categoryId, actorId, sourceIp);
  res.status(204).send();
});

// ─── Activity ───────────────────────────────────────────────────────────────

const listActivity = wrap(async (req, res) => {
  res.json(await svc.listActivity(req.params.id, { limit: req.query.limit, offset: req.query.offset }));
});

module.exports = {
  upload,
  list,
  kpis,
  getById,
  create,
  update,
  remove,
  setApproval,
  listContacts,
  createContact,
  updateContact,
  deleteContact,
  listProducts,
  upsertProduct,
  removeProduct,
  listForProduct,
  listDocs,
  uploadDoc,
  downloadDoc,
  deleteDoc,
  listPerf,
  upsertPerf,
  recomputePerf,
  listCategories,
  createCategory,
  deleteCategory,
  attachCategory,
  detachCategory,
  listActivity,
};
