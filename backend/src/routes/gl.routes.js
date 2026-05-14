// GL Export routes (Tier 4 #17 — v1.7.0).
const express = require('express');
const ctrl = require('../controllers/gl.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authenticate);

const READ_ROLES = ['ADMIN', 'FINANCE'];
const WRITE_ROLES = ['ADMIN'];

// Accounts
router.get('/accounts', requireRole(...READ_ROLES), ctrl.listAccounts);
router.post('/accounts', requireRole(...WRITE_ROLES), ctrl.createAccount);
router.put('/accounts/:id', requireRole(...WRITE_ROLES), ctrl.updateAccount);
router.delete('/accounts/:id', requireRole(...WRITE_ROLES), ctrl.deleteAccount);

// Mappings
router.get('/mappings', requireRole(...READ_ROLES), ctrl.listMappings);
router.put('/mappings', requireRole(...WRITE_ROLES), ctrl.upsertMapping);
router.delete('/mappings/:eventType', requireRole(...WRITE_ROLES), ctrl.deleteMapping);

// Journals
router.post('/journals/generate', requireRole('ADMIN', 'FINANCE'), ctrl.generate);
router.get('/journals', requireRole(...READ_ROLES), ctrl.listJournals);
router.get('/journals/export.csv', requireRole(...READ_ROLES), ctrl.exportCsv);
router.get('/journals/:id', requireRole(...READ_ROLES), ctrl.getJournal);
router.post('/journals/:id/push/:provider', requireRole('ADMIN', 'FINANCE'), ctrl.pushJournal);

module.exports = router;
