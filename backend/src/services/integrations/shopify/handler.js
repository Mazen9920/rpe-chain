// Shopify outbox handlers — registers 'shopify' target with the outbox dispatcher.
// Actions:
//   - inventory.set     { productId, onHand } -> POST /inventory_levels/set
//   - fulfillment.create { shipmentId }       -> POST /orders/:id/fulfillments

const prisma = require('../../../lib/prisma');
const outbox = require('../../outbox.service');
const client = require('./client');
const mapper = require('./mapper');
const logger = require('../../../lib/logger');

outbox.registerHandler('shopify', async ({ action, payload }) => {
  if (!client.isConfigured()) {
    logger.warn({ action }, 'shopify: not configured, skipping (will retry)');
    throw new Error('shopify not configured');
  }

  if (action === 'inventory.set') {
    const p = await prisma.product.findUnique({ where: { id: payload.productId } });
    if (!p) return { skipped: 'product_not_found' };
    const body = mapper.buildInventoryPayload(p, payload.onHand);
    if (!body) return { skipped: 'no_mapping' };
    return client.setInventoryLevel(body.inventory_item_id, body.location_id, body.available);
  }

  if (action === 'fulfillment.create') {
    const shipment = await prisma.shipment.findUnique({
      where: { id: payload.shipmentId },
      include: { salesOrder: true },
    });
    if (!shipment) return { skipped: 'shipment_not_found' };
    if (!shipment.salesOrder || shipment.salesOrder.source !== 'SHOPIFY' || !shipment.salesOrder.externalId) {
      return { skipped: 'not_shopify_so' };
    }
    return client.createFulfillment(shipment.salesOrder.externalId, mapper.buildFulfillmentPayload(shipment));
  }

  throw new Error(`unknown shopify action: ${action}`);
});

logger.info('shopify outbox handler registered');
