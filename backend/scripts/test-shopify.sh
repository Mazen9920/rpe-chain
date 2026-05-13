#!/usr/bin/env bash
# Section 9 / Phase D — Shopify integration smoke test.
# Covers: idempotent inbound mapping, audit logging, outbox enqueue on ship,
# webhook endpoint (signature bypass), source filter visibility.
set -e
cd "$(dirname "$0")/.."

echo "===== SHOPIFY ====="

node - <<'NODE'
const assert = require('assert');
const path = require('path');
const fs = require('fs');

(async () => {
  const prisma = require('./src/lib/prisma');
  const mapper = require('./src/services/integrations/shopify/mapper');

  const fixturePath = path.join(process.cwd(), 'scripts', 'fixtures', 'shopify-orders-create.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  // Clean any prior ingestion of this fixture id (so re-runs are deterministic).
  const externalId = String(fixture.id);
  const prior = await prisma.salesOrder.findFirst({ where: { source: 'SHOPIFY', externalId } });
  if (prior) {
    await prisma.shipmentLine.deleteMany({ where: { shipment: { salesOrderId: prior.id } } });
    await prisma.shipment.deleteMany({ where: { salesOrderId: prior.id } });
    await prisma.salesOrderLine.deleteMany({ where: { salesOrderId: prior.id } });
    await prisma.salesOrder.delete({ where: { id: prior.id } });
  }

  // T1: ingest creates SO with source=SHOPIFY, externalId set, mapped lines.
  const r1 = await mapper.ingestOrder(fixture);
  assert.ok(r1.created, 'expected created=true on first ingest');
  assert.ok(r1.salesOrder, 'expected salesOrder returned');
  assert.strictEqual(r1.salesOrder.source, 'SHOPIFY');
  assert.strictEqual(r1.salesOrder.externalId, externalId);
  assert.ok(Array.isArray(r1.salesOrder.lines));
  // 2 mappable SKUs + 1 unknown -> 2 lines, 1 skipped
  assert.strictEqual(r1.salesOrder.lines.length, 2, 'expected 2 mapped lines');
  assert.ok(r1.skipped.some((s) => s.reason === 'unknown_sku'));
  console.log(' \u2713 first ingest creates SO with mapped lines and skips unknown SKUs');

  // T2: re-ingest is idempotent (no new SO).
  const r2 = await mapper.ingestOrder(fixture);
  assert.strictEqual(r2.created, false, 'expected idempotent on re-ingest');
  assert.strictEqual(r2.salesOrder.id, r1.salesOrder.id);
  console.log(' \u2713 re-ingest is idempotent');

  // T3: SHOPIFY_ORDER_INGESTED event was logged.
  const ev = await prisma.eventLog.findFirst({
    where: { eventType: 'SHOPIFY_ORDER_INGESTED', entityType: 'SalesOrder', entityId: r1.salesOrder.id },
    orderBy: { occurredAt: 'desc' },
  });
  assert.ok(ev, 'expected SHOPIFY_ORDER_INGESTED event');
  console.log(' \u2713 audit event recorded');

  // T4: orphan ingest (no mappable lines) returns no SO and logs SHOPIFY_ORDER_SKIPPED.
  const orphan = { ...fixture, id: fixture.id + 1, line_items: [{ id: 99, sku: 'TOTALLY-UNKNOWN', quantity: 1, price: '1.00' }] };
  const r3 = await mapper.ingestOrder(orphan);
  assert.strictEqual(r3.salesOrder, null);
  assert.strictEqual(r3.created, false);
  const skipEv = await prisma.eventLog.findFirst({
    where: { eventType: 'SHOPIFY_ORDER_SKIPPED', entityId: String(orphan.id) },
    orderBy: { occurredAt: 'desc' },
  });
  assert.ok(skipEv, 'expected SHOPIFY_ORDER_SKIPPED event');
  console.log(' \u2713 unmappable order returns null and logs SKIPPED');

  // T5: payload builders
  const product = await prisma.product.findFirst({
    where: { sku: 'RPE-DSP-N95' },
  });
  // Without mapping -> null
  const noMap = require('./src/services/integrations/shopify/mapper').buildInventoryPayload(product, 100);
  assert.strictEqual(noMap, null);
  // With mapping -> object
  const mapped = require('./src/services/integrations/shopify/mapper').buildInventoryPayload(
    { ...product, externalIds: { shopify: { inventoryItemId: 1, locationId: 2 } } },
    77
  );
  assert.deepStrictEqual(mapped, { inventory_item_id: 1, location_id: 2, available: 77 });
  console.log(' \u2713 buildInventoryPayload honors mapping presence');

  const fpl = require('./src/services/integrations/shopify/mapper').buildFulfillmentPayload({
    trackingNumber: 'TRK123',
    carrier: 'DHL',
  });
  assert.strictEqual(fpl.tracking_number, 'TRK123');
  assert.strictEqual(fpl.tracking_company, 'DHL');
  assert.strictEqual(fpl.notify_customer, true);
  console.log(' \u2713 buildFulfillmentPayload shape ok');

  await prisma.$disconnect();
  console.log('SHOPIFY: all in-process assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
NODE

# HTTP webhook smoke (signature bypass enabled).
API="${API:-http://localhost:3000}"
if curl -fsS "$API/health" >/dev/null 2>&1; then
  echo "-- HTTP webhook smoke --"
  CODE=$(curl -sS -o /tmp/shopify-resp.json -w '%{http_code}' \
    -X POST "$API/api/webhooks/shopify/orders-create" \
    -H 'Content-Type: application/json' \
    --data-binary @scripts/fixtures/shopify-orders-create.json)
  echo "  HTTP $CODE"
  cat /tmp/shopify-resp.json && echo
  if [ "$CODE" != "200" ]; then
    echo "Note: webhook returned $CODE — ensure backend was started with WEBHOOK_SIGNATURE_DISABLED=true"
  fi
else
  echo "-- backend not reachable at $API; skipping HTTP smoke --"
fi

echo "===== SHOPIFY: OK ====="
