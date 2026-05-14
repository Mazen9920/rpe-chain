const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/dashboard.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.use(authenticate);
router.get('/summary', ctrl.summary);
router.get('/sales-trend', ctrl.salesTrend);
router.get('/inventory-trend', ctrl.inventoryTrend);
router.get('/alerts-trend', ctrl.alertsTrend);
router.get('/margin-trend', ctrl.marginTrend);

module.exports = router;
