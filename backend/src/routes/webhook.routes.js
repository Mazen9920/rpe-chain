// Webhook routes — mounted with express.raw() so HMAC verification can use the raw body.
// Shopify (Phase D) and Bosta (Phase E) handlers register here as they are implemented.
const express = require('express');
const router = express.Router();

// Stub: Phase D will replace with real Shopify webhook handlers.
router.post('/shopify/_health', express.json(), (_req, res) => res.json({ ok: true, integration: 'shopify' }));
router.post('/bosta/_health', express.json(), (_req, res) => res.json({ ok: true, integration: 'bosta' }));

module.exports = router;
