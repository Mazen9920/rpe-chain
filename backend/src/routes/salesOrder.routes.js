const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/salesOrder.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const SALES_READ = ['ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE'];
const SALES_WRITE = ['ADMIN', 'SALES'];
const FULFILLMENT_WRITE = ['ADMIN', 'SALES', 'WAREHOUSE'];

router.use(authenticate);

// Specific routes BEFORE /:id
router.get('/kpis', requireRole(...SALES_READ), ctrl.kpis);

router.get('/', requireRole(...SALES_READ), ctrl.list);
router.post('/', requireRole(...SALES_WRITE), ctrl.create);

router.get('/:id', requireRole(...SALES_READ), ctrl.getById);
router.patch('/:id', requireRole(...SALES_WRITE), ctrl.update);

router.post('/:id/confirm', requireRole(...SALES_WRITE), ctrl.confirm);
router.post('/:id/allocate', requireRole(...FULFILLMENT_WRITE), ctrl.allocate);
router.post('/:id/pick', requireRole(...FULFILLMENT_WRITE), ctrl.pick);
router.post('/:id/pack', requireRole(...FULFILLMENT_WRITE), ctrl.pack);
router.post('/:id/ship', requireRole(...FULFILLMENT_WRITE), ctrl.ship);
router.post('/:id/cancel', requireRole(...SALES_WRITE), ctrl.cancel);

module.exports = router;
