const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/arAging.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const AR_READ = ['ADMIN', 'FINANCE', 'SALES'];

router.get('/summary', requireRole(...AR_READ), ctrl.summary);
router.get('/', requireRole(...AR_READ), ctrl.aging);
router.get('/:customerId/statement', requireRole(...AR_READ), ctrl.statement);

module.exports = router;
