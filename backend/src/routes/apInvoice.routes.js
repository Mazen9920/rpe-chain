const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/apInvoice.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AP_READ = ['ADMIN', 'FINANCE', 'PROCUREMENT'];
const AP_WRITE = ['ADMIN', 'FINANCE'];
const AP_ADMIN = ['ADMIN'];

// Specific routes BEFORE /:id
router.get('/kpis', requireRole(...AP_READ), ctrl.kpis);

router.get('/', requireRole(...AP_READ), ctrl.list);
router.post('/', requireRole(...AP_WRITE), ctrl.create);
router.get('/:id', requireRole(...AP_READ), ctrl.getById);
router.post('/:id/submit', requireRole(...AP_WRITE), ctrl.submit);
router.post('/:id/rematch', requireRole(...AP_WRITE), ctrl.rematch);
router.post('/:id/approve', requireRole(...AP_WRITE), ctrl.approve);
router.post('/:id/void', requireRole(...AP_ADMIN), ctrl.void);

module.exports = router;
