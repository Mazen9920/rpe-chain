const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const ctrl = require('../controllers/settings.controller');

router.use(authenticate);

router.get('/match-tolerances', requireRole('ADMIN', 'FINANCE'), ctrl.getMatchTolerances);
router.put('/match-tolerances/global', requireRole('ADMIN'), ctrl.updateGlobalMatchTolerances);
router.put('/match-tolerances/suppliers/:id', requireRole('ADMIN'), ctrl.updateSupplierMatchTolerances);

module.exports = router;
