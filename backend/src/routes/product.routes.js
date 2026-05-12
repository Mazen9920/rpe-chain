const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/product.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/low-stock', ctrl.lowStock);
router.get('/:id', ctrl.getById);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
