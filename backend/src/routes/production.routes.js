const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/production.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/plan', requireRole('ADMIN', 'PRODUCTION'), ctrl.plan);
router.post('/:id/release', requireRole('ADMIN', 'PRODUCTION'), ctrl.release);
router.post('/:id/consume', requireRole('ADMIN', 'PRODUCTION'), ctrl.consume);
router.post('/:id/output', requireRole('ADMIN', 'PRODUCTION'), ctrl.output);
router.post('/:id/cancel', requireRole('ADMIN', 'PRODUCTION'), ctrl.cancel);

module.exports = router;
