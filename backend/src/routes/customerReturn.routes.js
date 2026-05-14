const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/customerReturn.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const READ = ['ADMIN', 'FINANCE', 'SALES', 'WAREHOUSE'];
const APPROVE = ['ADMIN', 'FINANCE'];
const RECEIVE = ['ADMIN', 'WAREHOUSE'];
const REFUND = ['ADMIN', 'FINANCE'];

router.get('/', requireRole(...READ), ctrl.list);
router.get('/:id', requireRole(...READ), ctrl.get);
router.post('/', requireRole('ADMIN', 'FINANCE', 'SALES'), ctrl.create);
router.post('/:id/approve', requireRole(...APPROVE), ctrl.approve);
router.post('/:id/reject', requireRole(...APPROVE), ctrl.reject);
router.post('/:id/receive', requireRole(...RECEIVE), ctrl.receive);
router.post('/:id/refund', requireRole(...REFUND), ctrl.refund);

module.exports = router;
