// Routes for per-user alert subscription management.
const express = require('express');
const router = express.Router();
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const svc = require('../services/notifications.service');

const ANY_AUTH = ['ADMIN', 'PROCUREMENT', 'WAREHOUSE', 'FINANCE', 'SALES', 'PRODUCTION'];

router.use(authenticate);

// Subscriptions are always tied to the authenticated user.
router.get('/subscriptions', requireRole(...ANY_AUTH), async (req, res, next) => {
  try {
    const subs = await svc.listSubscriptions(req.user.id);
    res.json(subs);
  } catch (e) { next(e); }
});

router.put('/subscriptions', requireRole(...ANY_AUTH), async (req, res, next) => {
  try {
    const items = Array.isArray(req.body) ? req.body : req.body?.items;
    const subs = await svc.replaceSubscriptions(req.user.id, items || []);
    res.json(subs);
  } catch (e) { next(e); }
});

// Admin-only: seed defaults for all admins (idempotent)
router.post('/subscriptions/seed-admin-defaults', requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const r = await svc.seedDefaultSubscriptionsForAdmins();
    res.json(r);
  } catch (e) { next(e); }
});

// Admin-only: trigger the daily digest immediately (for testing)
router.post('/digest/run', requireRole('ADMIN'), async (_req, res, next) => {
  try {
    const r = await svc.sendDailyDigest();
    res.json(r);
  } catch (e) { next(e); }
});

module.exports = router;
