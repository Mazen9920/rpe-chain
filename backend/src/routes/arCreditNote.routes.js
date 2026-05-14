const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/arCreditNote.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AR_READ = ['ADMIN', 'FINANCE', 'SALES'];
const AR_WRITE = ['ADMIN', 'FINANCE'];

router.get('/', requireRole(...AR_READ), ctrl.list);
router.post('/', requireRole(...AR_WRITE), ctrl.create);

module.exports = router;
