const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/inventory.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { requireRole } = require('../middleware/auth.middleware');

router.use(authenticate);

router.get('/warehouses', ctrl.listWarehouses);
router.get('/warehouses/:id', ctrl.getWarehouse);
router.post('/warehouses', requireRole('ADMIN', 'WAREHOUSE'), ctrl.createWarehouse);
router.put('/warehouses/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.updateWarehouse);
router.delete('/warehouses/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.deactivateWarehouse);

router.get('/stock-levels', ctrl.listStockLevels);

router.get('/lots', ctrl.listLots);

router.get('/valuation', ctrl.getValuation);

router.get('/movements', ctrl.listMovements);
router.post('/adjustments', requireRole('ADMIN', 'WAREHOUSE'), ctrl.adjustStock);

module.exports = router;
