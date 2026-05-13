const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/supplier.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.listCategories);
router.post('/', requireRole('ADMIN'), ctrl.createCategory);
router.delete('/:id', requireRole('ADMIN'), ctrl.deleteCategory);

module.exports = router;
