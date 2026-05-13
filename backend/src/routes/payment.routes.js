const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/payment.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AP_READ = ['ADMIN', 'FINANCE', 'PROCUREMENT'];
const AP_WRITE = ['ADMIN', 'FINANCE'];
const AP_ADMIN = ['ADMIN'];

router.get('/', requireRole(...AP_READ), ctrl.list);
router.post('/', requireRole(...AP_WRITE), ctrl.create);
router.get('/:id', requireRole(...AP_READ), ctrl.getById);
router.post('/:id/void', requireRole(...AP_ADMIN), ctrl.void);

module.exports = router;
