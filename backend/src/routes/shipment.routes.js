const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shipment.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const SALES_READ = ['ADMIN', 'SALES', 'WAREHOUSE', 'FINANCE'];
const FULFILLMENT_WRITE = ['ADMIN', 'SALES', 'WAREHOUSE'];
const SALES_ADMIN = ['ADMIN'];

router.use(authenticate);

router.get('/', requireRole(...SALES_READ), ctrl.list);
router.get('/:id', requireRole(...SALES_READ), ctrl.getById);
router.get('/:id/label', requireRole(...SALES_READ), ctrl.getLabel);
router.post('/:id/deliver', requireRole(...FULFILLMENT_WRITE), ctrl.deliver);
router.post('/:id/void', requireRole(...SALES_ADMIN), ctrl.void);

module.exports = router;
