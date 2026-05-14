const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customerPayment.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AR_READ = ['ADMIN', 'FINANCE', 'SALES'];
const AR_WRITE = ['ADMIN', 'FINANCE'];
const AR_ADMIN = ['ADMIN'];

router.get('/', requireRole(...AR_READ), ctrl.list);
router.post('/', requireRole(...AR_WRITE), ctrl.create);
router.get('/:id', requireRole(...AR_READ), ctrl.getById);
router.post('/:id/void', requireRole(...AR_ADMIN), ctrl.void);

module.exports = router;
