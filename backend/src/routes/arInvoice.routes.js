const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/arInvoice.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AR_READ = ['ADMIN', 'FINANCE', 'SALES'];
const AR_WRITE = ['ADMIN', 'FINANCE', 'SALES'];
const AR_ADMIN = ['ADMIN'];

router.get('/kpis', requireRole(...AR_READ), ctrl.kpis);
router.post('/generate-from-shipment', requireRole(...AR_WRITE), ctrl.generateFromShipment);

router.get('/', requireRole(...AR_READ), ctrl.list);
router.post('/', requireRole(...AR_WRITE), ctrl.create);
router.get('/:id', requireRole(...AR_READ), ctrl.getById);
router.post('/:id/void', requireRole(...AR_ADMIN), ctrl.void);

module.exports = router;
