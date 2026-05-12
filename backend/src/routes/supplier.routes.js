const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/supplier.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const READ_ROLES = ['ADMIN', 'PROCUREMENT', 'FINANCE', 'SALES', 'READ_ONLY'];
const WRITE_ROLES = ['ADMIN', 'PROCUREMENT'];

router.get('/', requireRole(...READ_ROLES), ctrl.list);
router.get('/:id', requireRole(...READ_ROLES), ctrl.getById);
router.post('/', requireRole(...WRITE_ROLES), ctrl.create);
router.put('/:id', requireRole(...WRITE_ROLES), ctrl.update);
router.delete('/:id', requireRole(...WRITE_ROLES), ctrl.remove);

router.get('/:id/performance', requireRole(...READ_ROLES), ctrl.getPerformance);
router.post('/:id/performance', requireRole(...WRITE_ROLES), ctrl.recordPerformance);

module.exports = router;
