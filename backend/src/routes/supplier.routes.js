const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/supplier.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

router.post('/:id/performance', requireRole('ADMIN', 'PROCUREMENT'), ctrl.recordPerformance);
router.get('/:id/performance', ctrl.getPerformance);

module.exports = router;
