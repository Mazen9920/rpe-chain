#!/usr/bin/env bash
# Register the orders/create webhook with Shopify.
# Requires env: SHOPIFY_SHOP_DOMAIN, SHOPIFY_ADMIN_TOKEN, PUBLIC_URL
# Optional:     SHOPIFY_API_VERSION (default 2024-10)
set -euo pipefail

cd "$(dirname "$0")/.."

node -e '
(async () => {
  const client = require("./src/services/integrations/shopify/client");
  if (!client.isConfigured()) {
    console.error("Shopify not configured: set SHOPIFY_SHOP_DOMAIN and SHOPIFY_ADMIN_TOKEN");
    process.exit(1);
  }
  const publicUrl = process.env.PUBLIC_URL;
  if (!publicUrl) {
    console.error("PUBLIC_URL is required (e.g. https://app.example.com)");
    process.exit(1);
  }
  const address = publicUrl.replace(/\/+$/, "") + "/api/webhooks/shopify/orders-create";
  const existing = await client.listWebhooks();
  const dupe = (existing.webhooks || []).find(w => w.topic === "orders/create" && w.address === address);
  if (dupe) {
    console.log("Already registered:", dupe.id, dupe.topic, dupe.address);
    return;
  }
  const created = await client.registerWebhook("orders/create", address);
  console.log("Registered webhook:", JSON.stringify(created.webhook || created, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
'
