const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/category.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.post('/', requireRole('ADMIN', 'WAREHOUSE'), ctrl.create);
router.put('/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.update);

module.exports = router;
