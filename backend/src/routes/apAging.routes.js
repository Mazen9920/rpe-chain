const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/apAging.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AP_READ = ['ADMIN', 'FINANCE', 'PROCUREMENT'];

router.get('/summary', requireRole(...AP_READ), ctrl.summary);
router.get('/', requireRole(...AP_READ), ctrl.aging);
router.get('/statement/:supplierId', requireRole(...AP_READ), ctrl.statement);

module.exports = router;
