const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/bom.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/', ctrl.list);
router.get('/:id', ctrl.get);
router.post('/', requireRole('ADMIN', 'PRODUCTION'), ctrl.createDraft);
router.put('/:id', requireRole('ADMIN', 'PRODUCTION'), ctrl.updateDraft);
router.post('/:id/activate', requireRole('ADMIN', 'PRODUCTION'), ctrl.activate);
router.post('/:id/archive', requireRole('ADMIN', 'PRODUCTION'), ctrl.archive);
router.post('/:id/clone', requireRole('ADMIN', 'PRODUCTION'), ctrl.clone);

module.exports = router;
