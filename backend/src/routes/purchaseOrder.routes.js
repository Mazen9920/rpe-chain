const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/purchaseOrder.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

const ANY_PROCUREMENT = ['ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'FINANCE'];
const EDIT_PROCUREMENT = ['ADMIN', 'PROCUREMENT'];
const APPROVE = ['ADMIN', 'PROCUREMENT'];
const RECEIVE = ['ADMIN', 'WAREHOUSE'];

// Specific routes BEFORE /:id
router.get('/kpis', ctrl.kpis);

router.get('/', requireRole(...ANY_PROCUREMENT), ctrl.list);
router.post('/', requireRole(...EDIT_PROCUREMENT), ctrl.create);

router.get('/:id', requireRole(...ANY_PROCUREMENT), ctrl.getById);
router.put('/:id', requireRole(...EDIT_PROCUREMENT), ctrl.update);

router.post('/:id/submit', requireRole(...EDIT_PROCUREMENT), ctrl.submit);
router.post('/:id/approve', requireRole(...APPROVE), ctrl.approve);
router.post('/:id/send', requireRole(...EDIT_PROCUREMENT), ctrl.send);
router.post('/:id/cancel', requireRole(...EDIT_PROCUREMENT), ctrl.cancel);
router.post('/:id/close', requireRole(...EDIT_PROCUREMENT), ctrl.close);
router.get('/:id/activity', requireRole(...ANY_PROCUREMENT), ctrl.activity);

router.post('/:id/receive', requireRole(...RECEIVE), ctrl.receive);

module.exports = router;
