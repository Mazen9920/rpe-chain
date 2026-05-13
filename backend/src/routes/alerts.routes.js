const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/alerts.controller');
const { authenticate, requireRole } = require('../middleware/auth.middleware');

const ANY_AUTH = ['ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'FINANCE', 'SALES', 'PRODUCTION'];

router.use(authenticate);

router.get('/', requireRole(...ANY_AUTH), ctrl.list);
router.post('/scan', requireRole('ADMIN'), ctrl.scanAll);
router.post('/:id/acknowledge', requireRole(...ANY_AUTH), ctrl.acknowledge);
router.post('/:id/snooze', requireRole(...ANY_AUTH), ctrl.snooze);
router.post('/:id/resolve', requireRole(...ANY_AUTH), ctrl.resolve);

module.exports = router;
