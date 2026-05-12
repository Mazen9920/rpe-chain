const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/shipment.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.patch('/:id/status', ctrl.updateStatus);

module.exports = router;
