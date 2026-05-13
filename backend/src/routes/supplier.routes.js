const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/supplier.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const writers = requireRole('ADMIN', 'PROCUREMENT');
const adminOnly = requireRole('ADMIN');
const perfWriters = requireRole('ADMIN', 'PROCUREMENT', 'FINANCE');

// ─── Reverse lookup: suppliers that supply a given product ──────────────────
router.get('/by-product/:productId', ctrl.listForProduct);

// ─── Document download/delete ───────────────────────────────────────────────
router.get('/documents/:docId/download', ctrl.downloadDoc);
router.delete('/documents/:docId', writers, ctrl.deleteDoc);

// ─── KPIs ───────────────────────────────────────────────────────────────────
router.get('/kpis', ctrl.kpis);

// ─── Suppliers core CRUD ────────────────────────────────────────────────────
router.get('/', ctrl.list);
router.post('/', writers, ctrl.create);
router.get('/:id', ctrl.getById);
router.put('/:id', writers, ctrl.update);
router.delete('/:id', adminOnly, ctrl.remove);

// ─── Approval workflow ──────────────────────────────────────────────────────
router.post('/:id/approval', writers, ctrl.setApproval);

// ─── Contacts ───────────────────────────────────────────────────────────────
router.get('/:id/contacts', ctrl.listContacts);
router.post('/:id/contacts', writers, ctrl.createContact);
router.put('/:id/contacts/:contactId', writers, ctrl.updateContact);
router.delete('/:id/contacts/:contactId', writers, ctrl.deleteContact);

// ─── Supplier products (catalog) ────────────────────────────────────────────
router.get('/:id/products', ctrl.listProducts);
router.post('/:id/products', writers, ctrl.upsertProduct);
router.delete('/:id/products/:productId', writers, ctrl.removeProduct);

// ─── Documents ──────────────────────────────────────────────────────────────
router.get('/:id/documents', ctrl.listDocs);
router.post('/:id/documents', writers, ctrl.upload.single('file'), ctrl.uploadDoc);

// ─── Performance ────────────────────────────────────────────────────────────
router.get('/:id/performance', ctrl.listPerf);
router.post('/:id/performance', perfWriters, ctrl.upsertPerf);
router.post('/:id/performance/recompute', writers, ctrl.recomputePerf);

// ─── Categories link/unlink ─────────────────────────────────────────────────
router.post('/:id/categories/:categoryId', writers, ctrl.attachCategory);
router.delete('/:id/categories/:categoryId', writers, ctrl.detachCategory);

// ─── Activity feed ──────────────────────────────────────────────────────────
router.get('/:id/activity', ctrl.listActivity);

module.exports = router;
