const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/creditNote.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AP_READ = ['ADMIN', 'FINANCE', 'PROCUREMENT'];
const AP_WRITE = ['ADMIN', 'FINANCE'];

router.get('/', requireRole(...AP_READ), ctrl.list);
router.post('/', requireRole(...AP_WRITE), ctrl.create);

module.exports = router;
