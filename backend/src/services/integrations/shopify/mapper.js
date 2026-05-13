// Shopify ↔ RPE mappers.
// Inbound: orders/create webhook → SalesOrder (idempotent on externalId).
// Outbound: inventory level + fulfillment payloads.

const prisma = require('../../../lib/prisma');
const salesOrderSvc = require('../../salesOrder.service');
const { logEvent } = require('../../audit.service');
const logger = require('../../../lib/logger');

// Idempotent ingest of a Shopify orders/create payload.
// Strategy: lookup SalesOrder by (source='SHOPIFY', externalId=<shopify id>). If present, return existing.
async function ingestOrder(payload, { actor = null } = {}) {
  if (!payload || !payload.id) throw new Error('Shopify order payload missing id');
  const externalId = String(payload.id);

  const existing = await prisma.salesOrder.findFirst({
    where: { source: 'SHOPIFY', externalId },
    include: { lines: true },
  });
  if (existing) {
    logger.info({ externalId, soId: existing.id }, 'shopify: order already ingested (idempotent)');
    return { salesOrder: existing, created: false };
  }

  // Customer upsert by email
  let customerId = null;
  const email = payload.email || payload.customer?.email || null;
  const customerName =
    payload.customer
      ? [payload.customer.first_name, payload.customer.last_name].filter(Boolean).join(' ').trim() || email || 'Shopify Customer'
      : email || 'Shopify Customer';
  if (email) {
    const existingCust = await prisma.customer.findFirst({ where: { email, deletedAt: null } });
    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const code = `SHOP-${String(payload.customer?.id || payload.id).slice(-8)}`;
      const created = await prisma.customer.create({
        data: {
          code,
          name: customerName,
          email,
          phone: payload.customer?.phone || payload.phone || null,
          shippingAddress: payload.shipping_address ? formatAddress(payload.shipping_address) : null,
          billingAddress: payload.billing_address ? formatAddress(payload.billing_address) : null,
          currency: payload.currency || 'USD',
        },
      });
      customerId = created.id;
    }
  }

  // Line mapping: Shopify variant SKU → Product.sku
  const skus = (payload.line_items || []).map((li) => li.sku).filter(Boolean);
  const products = skus.length
    ? await prisma.product.findMany({ where: { sku: { in: skus }, deletedAt: null } })
    : [];
  const bySku = new Map(products.map((p) => [p.sku, p]));

  const lines = [];
  const skipped = [];
  for (const li of payload.line_items || []) {
    if (!li.sku) { skipped.push({ reason: 'no_sku', li }); continue; }
    const p = bySku.get(li.sku);
    if (!p) { skipped.push({ reason: 'unknown_sku', sku: li.sku }); continue; }
    lines.push({
      productId: p.id,
      qty: Number(li.quantity) || 1,
      unitPrice: Number(li.price) || Number(p.sellingPrice) || 0,
      notes: li.title || null,
    });
  }

  if (!lines.length) {
    // Record a stub SalesOrder anyway so we don't loop on retries. Use 1-line placeholder is not allowed by service;
    // instead we record a noop audit event and return without creating.
    await logEvent({
      eventType: 'SHOPIFY_ORDER_SKIPPED',
      entityType: 'SalesOrder',
      entityId: externalId,
      payload: { externalId, reason: 'no_mappable_lines', skipped },
    });
    return { salesOrder: null, created: false, skipped };
  }

  const so = await salesOrderSvc.createSalesOrder(
    {
      source: 'SHOPIFY',
      externalId,
      customerId,
      customerName,
      customerEmail: email,
      currency: payload.currency || 'USD',
      notes: payload.note || null,
      lines,
    },
    actor,
    null
  );

  await logEvent({
    eventType: 'SHOPIFY_ORDER_INGESTED',
    entityType: 'SalesOrder',
    entityId: so.id,
    payload: { externalId, orderNumber: so.orderNumber, lineCount: lines.length, skipped },
  });

  return { salesOrder: so, created: true, skipped };
}

function formatAddress(a) {
  return [a.address1, a.address2, a.city, a.province, a.zip, a.country].filter(Boolean).join(', ');
}

// Build inventory_levels.set payload from local stock for a product
function buildInventoryPayload(product, onHand) {
  const mapping = (product.externalIds && product.externalIds.shopify) || null;
  if (!mapping || !mapping.inventoryItemId || !mapping.locationId) return null;
  return {
    inventory_item_id: Number(mapping.inventoryItemId),
    location_id: Number(mapping.locationId),
    available: Math.max(0, Math.floor(Number(onHand) || 0)),
  };
}

// Build fulfillment payload for a Shopify SO from a Shipment.
function buildFulfillmentPayload(shipment) {
  return {
    tracking_number: shipment.trackingNumber || null,
    tracking_company: shipment.carrier || null,
    notify_customer: true,
  };
}

module.exports = { ingestOrder, buildInventoryPayload, buildFulfillmentPayload };
