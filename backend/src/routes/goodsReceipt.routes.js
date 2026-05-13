const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/goodsReceipt.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const ANY = ['ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'FINANCE'];
const WAREHOUSE_OPS = ['ADMIN', 'WAREHOUSE'];
const QA_OPS = ['ADMIN', 'WAREHOUSE'];
const FINANCE_OPS = ['ADMIN', 'FINANCE'];

// Specific routes BEFORE /:id
router.post('/lines/:lineId/qa', requireRole(...QA_OPS), ctrl.qaAction);

router.get('/', requireRole(...ANY), ctrl.list);
router.get('/:id', requireRole(...ANY), ctrl.getById);
router.post('/:id/reverse', requireRole(...WAREHOUSE_OPS), ctrl.reverse);
router.post('/:id/landed-costs', requireRole(...FINANCE_OPS), ctrl.addLandedCost);
router.delete('/:id/landed-costs/:allocationId', requireRole(...FINANCE_OPS), ctrl.removeLandedCost);

module.exports = router;
