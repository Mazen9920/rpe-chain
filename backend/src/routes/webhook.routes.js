// Webhook routes — mounted with express.raw() so HMAC verification can use the raw body.
// Shopify (Phase D) and Bosta (Phase E) handlers register here as they are implemented.
const express = require('express');
const router = express.Router();
const logger = require('../lib/logger');
const { verifyHmac } = require('../middleware/webhookSignature');

// Stub: Phase D will replace with real Shopify webhook handlers.
router.post('/shopify/_health', express.json(), (_req, res) => res.json({ ok: true, integration: 'shopify' }));
router.post('/bosta/_health', express.json(), (_req, res) => res.json({ ok: true, integration: 'bosta' }));

// ─── Shopify ─────────────────────────────────────────────────────────────────
const shopifyVerify = verifyHmac({
  headerName: 'X-Shopify-Hmac-Sha256',
  secretEnv: 'SHOPIFY_WEBHOOK_SECRET',
  algo: 'sha256',
  encoding: 'base64',
});

router.post(
  '/shopify/orders-create',
  express.raw({ type: '*/*', limit: '5mb' }),
  shopifyVerify,
  async (req, res) => {
    try {
      const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));
      const payload = raw ? JSON.parse(raw) : {};
      const mapper = require('../services/integrations/shopify/mapper');
      const result = await mapper.ingestOrder(payload);
      res.json({ ok: true, created: result.created, salesOrderId: result.salesOrder?.id || null, skipped: result.skipped || [] });
    } catch (e) {
      logger.error({ err: e.message }, 'shopify orders-create failed');
      res.status(500).json({ ok: false, error: e.message });
    }
  }
);

module.exports = router;
