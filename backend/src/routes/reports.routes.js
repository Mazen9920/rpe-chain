const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reports.controller');
const defCtrl = require('../controllers/reportDefinition.controller');
const schedCtrl = require('../controllers/reportSchedule.controller');
const renderCtrl = require('../controllers/reportRender.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/ap-aging', requireRole('ADMIN', 'FINANCE'), ctrl.apAging);
router.get('/supplier-scorecards', requireRole('ADMIN', 'PROCUREMENT', 'FINANCE'), ctrl.supplierScorecards);
router.get('/sales-fulfillment', requireRole('ADMIN', 'SALES', 'FINANCE'), ctrl.salesFulfillment);
router.get('/demand-anomalies', requireRole('ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'SALES'), ctrl.demandAnomalies);
router.get('/margin-erosion', requireRole('ADMIN', 'FINANCE', 'SALES'), ctrl.marginErosion);
router.get('/lead-time-drift', requireRole('ADMIN', 'PROCUREMENT'), ctrl.leadTimeDrift);

// Tier 4 #15 — Saved-report definitions
const READ_ALL = ['ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'FINANCE', 'SALES', 'PRODUCTION', 'READ_ONLY'];
const WRITE_DEF = ['ADMIN', 'FINANCE', 'PROCUREMENT', 'SALES'];
const WRITE_SCHED = ['ADMIN', 'FINANCE'];

router.get('/definitions/available', requireRole(...READ_ALL), defCtrl.listAvailable);
router.get('/definitions', requireRole(...READ_ALL), defCtrl.list);
router.get('/definitions/:id', requireRole(...READ_ALL), defCtrl.get);
router.post('/definitions', requireRole(...WRITE_DEF), defCtrl.create);
router.patch('/definitions/:id', requireRole(...WRITE_DEF), defCtrl.update);
router.delete('/definitions/:id', requireRole(...WRITE_DEF), defCtrl.remove);

router.get('/schedules', requireRole(...READ_ALL), schedCtrl.list);
router.get('/schedules/:id', requireRole(...READ_ALL), schedCtrl.get);
router.post('/schedules', requireRole(...WRITE_SCHED), schedCtrl.create);
router.patch('/schedules/:id', requireRole(...WRITE_SCHED), schedCtrl.update);
router.delete('/schedules/:id', requireRole(...WRITE_SCHED), schedCtrl.remove);
router.post('/schedules/:id/run-now', requireRole(...WRITE_SCHED), schedCtrl.runNow);

router.get('/render', requireRole(...READ_ALL), renderCtrl.renderAdhoc);
router.get('/render/definition/:id', requireRole(...READ_ALL), renderCtrl.renderSaved);

module.exports = router;
