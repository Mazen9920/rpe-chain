// Shopify Admin API client (custom-app token auth).
// Uses fetch (Node 18+). Returns parsed JSON or throws with status+body.

const SHOP = () => process.env.SHOPIFY_SHOP_DOMAIN; // e.g. acme.myshopify.com
const TOKEN = () => process.env.SHOPIFY_ADMIN_TOKEN;
const VERSION = () => process.env.SHOPIFY_API_VERSION || '2024-10';

function isConfigured() {
  return Boolean(SHOP() && TOKEN());
}

async function request(method, path, body) {
  if (!isConfigured()) throw new Error('Shopify is not configured (SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_TOKEN)');
  const url = `https://${SHOP()}/admin/api/${VERSION()}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      'X-Shopify-Access-Token': TOKEN(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(`Shopify ${method} ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

module.exports = {
  isConfigured,
  setInventoryLevel: (inventoryItemId, locationId, available) =>
    request('POST', '/inventory_levels/set.json', {
      inventory_item_id: inventoryItemId,
      location_id: locationId,
      available,
    }),
  createFulfillment: (orderId, payload) =>
    request('POST', `/orders/${orderId}/fulfillments.json`, { fulfillment: payload }),
  registerWebhook: (topic, address) =>
    request('POST', '/webhooks.json', { webhook: { topic, address, format: 'json' } }),
  listWebhooks: () => request('GET', '/webhooks.json'),
};
