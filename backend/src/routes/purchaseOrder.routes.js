const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/purchaseOrder.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.patch('/:id/status', ctrl.updateStatus);
router.post('/:id/receive', ctrl.receiveGoods);

module.exports = router;
