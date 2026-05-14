const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/reports.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/ap-aging', requireRole('ADMIN', 'FINANCE'), ctrl.apAging);
router.get('/supplier-scorecards', requireRole('ADMIN', 'PROCUREMENT', 'FINANCE'), ctrl.supplierScorecards);
router.get('/sales-fulfillment', requireRole('ADMIN', 'SALES', 'FINANCE'), ctrl.salesFulfillment);
router.get('/demand-anomalies', requireRole('ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'SALES'), ctrl.demandAnomalies);
router.get('/margin-erosion', requireRole('ADMIN', 'FINANCE', 'SALES'), ctrl.marginErosion);
router.get('/lead-time-drift', requireRole('ADMIN', 'PROCUREMENT'), ctrl.leadTimeDrift);

module.exports = router;
