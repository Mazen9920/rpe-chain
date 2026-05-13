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
router.get('/warehouses/:warehouseId/zones', ctrl.listZones);
router.post('/warehouses/:warehouseId/zones', requireRole('ADMIN', 'WAREHOUSE'), ctrl.createZone);
router.put('/warehouses/:warehouseId/zones/:zoneId', requireRole('ADMIN', 'WAREHOUSE'), ctrl.updateZone);

router.get('/bins', ctrl.listBins);
router.post('/bins', requireRole('ADMIN', 'WAREHOUSE'), ctrl.createBin);
router.put('/bins/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.updateBin);
router.delete('/bins/:id', requireRole('ADMIN', 'WAREHOUSE'), ctrl.deactivateBin);

router.get('/lookup', ctrl.lookupBarcode);
router.get('/stock-levels', ctrl.listStockLevels);
router.get('/bin-stock-levels', ctrl.listBinStock);

router.get('/lots', ctrl.listLots);
router.put('/lots/:id/qa-status', requireRole('ADMIN', 'WAREHOUSE'), ctrl.updateLotQaStatus);

router.get('/valuation', ctrl.getValuation);

router.get('/movements', ctrl.listMovements);
router.post('/adjustments', requireRole('ADMIN', 'WAREHOUSE'), ctrl.adjustStock);
router.post('/bin-moves', requireRole('ADMIN', 'WAREHOUSE'), ctrl.moveBetweenBins);

router.get('/transfers', ctrl.listTransfers);
router.post('/transfers', requireRole('ADMIN', 'WAREHOUSE'), ctrl.createTransfer);
router.post('/transfers/:id/ship', requireRole('ADMIN', 'WAREHOUSE'), ctrl.shipTransfer);
router.post('/transfers/:id/receive', requireRole('ADMIN', 'WAREHOUSE'), ctrl.receiveTransfer);

router.get('/cycle-counts', ctrl.listCycleCounts);
router.post('/cycle-counts', requireRole('ADMIN', 'WAREHOUSE'), ctrl.createCycleCount);
router.put('/cycle-counts/:id/lines/:lineId', requireRole('ADMIN', 'WAREHOUSE'), ctrl.updateCycleCountLine);
router.post('/cycle-counts/:id/post', requireRole('ADMIN', 'WAREHOUSE'), ctrl.postCycleCount);
router.post('/cycle-counts/:id/cancel', requireRole('ADMIN', 'WAREHOUSE'), ctrl.cancelCycleCount);

module.exports = router;
