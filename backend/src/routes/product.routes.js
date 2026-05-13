const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/product.controller');
const bomCtrl = require('../controllers/bom.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/low-stock', ctrl.lowStock);
router.get('/:id', ctrl.getById);
router.get('/:productId/cost-rollup', bomCtrl.costRollup);
router.post('/', requireRole('ADMIN', 'WAREHOUSE'), ctrl.create);
router.put('/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.update);
router.delete('/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.remove);

module.exports = router;
