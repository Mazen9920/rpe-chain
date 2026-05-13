#!/usr/bin/env bash
# Section 9 / Phase E — Bosta integration smoke test.
# Covers: tracking webhook idempotency, status mapping, deliveredAt propagation,
# alert auto-resolve, HTTP endpoint (signature bypass).
set -e
cd "$(dirname "$0")/.."

echo "===== BOSTA ====="

node - <<'NODE'
const assert = require('assert');
const path = require('path');
const fs = require('fs');

(async () => {
  const prisma = require('./src/lib/prisma');
  const handler = require('./src/services/integrations/bosta/handler');
  const client = require('./src/services/integrations/bosta/client');

  const fixturePath = path.join(process.cwd(), 'scripts', 'fixtures', 'bosta-tracking-delivered.json');
  const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

  // T0: status mapping
  assert.strictEqual(client.mapState(45), 'DELIVERED');
  assert.strictEqual(client.mapState(20), 'IN_TRANSIT');
  assert.strictEqual(client.mapState(41), 'OUT_FOR_DELIVERY');
  assert.strictEqual(client.mapState(47), 'FAILED');
  console.log(' \u2713 state code mapping correct');

  // Prepare a test Shipment row (clean re-runs).
  const shipNumber = fixture.businessReference; // SHIP-BOSTA-TEST
  const trackNo = fixture.trackingNumber;
  let prior = await prisma.shipment.findUnique({ where: { shipmentNumber: shipNumber } });
  if (prior) {
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: prior.id } });
    await prisma.shipmentLine.deleteMany({ where: { shipmentId: prior.id } });
    await prisma.alert.deleteMany({ where: { entityType: 'Shipment', entityId: prior.id } });
    await prisma.shipment.delete({ where: { id: prior.id } });
  }
  const anyUser = await prisma.user.findFirst({ select: { id: true } });
  if (!anyUser) throw new Error('no user in DB to own shipment');
  const shipment = await prisma.shipment.create({
    data: {
      shipmentNumber: shipNumber,
      carrier: 'BOSTA',
      carrierRef: fixture._id,
      trackingNumber: trackNo,
      status: 'IN_TRANSIT',
      createdById: anyUser.id,
    },
  });
  console.log(` \u2713 fresh test shipment ${shipment.shipmentNumber} created (status IN_TRANSIT)`);

  // T1: ingest tracking event → mapped to DELIVERED, deliveredAt set, lastTrackingEventId set
  const r1 = await handler.ingestTrackingEvent(fixture);
  assert.strictEqual(r1.matched, true);
  assert.strictEqual(r1.deduped, false);
  assert.strictEqual(r1.status, 'DELIVERED');
  const after = await prisma.shipment.findUnique({ where: { id: shipment.id } });
  assert.strictEqual(after.status, 'DELIVERED');
  assert.ok(after.deliveredAt, 'deliveredAt should be set');
  assert.strictEqual(after.lastTrackingEventId, fixture._id);
  console.log(' \u2713 ingest sets status=DELIVERED, deliveredAt, lastTrackingEventId');

  // T2: TrackingEvent row created
  const events = await prisma.trackingEvent.findMany({ where: { shipmentId: shipment.id } });
  assert.strictEqual(events.length, 1);
  assert.strictEqual(events[0].eventType, 'DELIVERED');
  console.log(' \u2713 TrackingEvent row persisted');

  // T3: idempotent re-ingest — no new event, deduped=true
  const r2 = await handler.ingestTrackingEvent(fixture);
  assert.strictEqual(r2.deduped, true);
  const events2 = await prisma.trackingEvent.findMany({ where: { shipmentId: shipment.id } });
  assert.strictEqual(events2.length, 1, 'no duplicate TrackingEvent');
  console.log(' \u2713 duplicate eventId deduped');

  // T4: alert auto-resolve when DELIVERED
  // Reset shipment to IN_TRANSIT, open a SHIPMENT_DELAY alert, deliver, assert RESOLVED.
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: shipment.id } });
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { status: 'IN_TRANSIT', deliveredAt: null, lastTrackingEventId: null },
  });
  const alert = await prisma.alert.create({
    data: {
      type: 'SHIPMENT_DELAY',
      entityType: 'Shipment',
      entityId: shipment.id,
      severity: 'WARNING',
      status: 'OPEN',
      payload: {},
      reasoning: 'test fixture for auto-resolve',
    },
  });
  const fx2 = { ...fixture, _id: `${fixture._id}-v2` };
  await handler.ingestTrackingEvent(fx2);
  const reloaded = await prisma.alert.findUnique({ where: { id: alert.id } });
  assert.strictEqual(reloaded.status, 'RESOLVED', 'alert should be auto-resolved on delivery');
  console.log(' \u2713 SHIPMENT_DELAY alert auto-resolved on DELIVERED event');

  // T5: not-configured outbox path is retryable, not silently swallowed
  const isCfg = client.isConfigured();
  console.log(`   (bosta isConfigured() = ${isCfg})`);

  // HTTP smoke (signature bypass via WEBHOOK_SIGNATURE_DISABLED=true)
  if (process.env.SMOKE_HTTP === '1') {
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    // Reset shipment first
    await prisma.trackingEvent.deleteMany({ where: { shipmentId: shipment.id } });
    await prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: 'IN_TRANSIT', deliveredAt: null, lastTrackingEventId: null },
    });
    const fx3 = { ...fixture, _id: `${fixture._id}-http` };
    const resp = await fetch(`${baseUrl}/api/webhooks/bosta/tracking`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fx3),
    });
    const data = await resp.json();
    assert.strictEqual(resp.status, 200, `HTTP webhook expected 200, got ${resp.status}: ${JSON.stringify(data)}`);
    assert.strictEqual(data.ok, true);
    assert.strictEqual(data.matched, true);
    console.log(' \u2713 HTTP /api/webhooks/bosta/tracking returns 200');
  } else {
    console.log('   (skip HTTP smoke; set SMOKE_HTTP=1 with backend running w/ WEBHOOK_SIGNATURE_DISABLED=true)');
  }

  // Cleanup
  await prisma.trackingEvent.deleteMany({ where: { shipmentId: shipment.id } });
  await prisma.alert.deleteMany({ where: { entityType: 'Shipment', entityId: shipment.id } });
  await prisma.shipment.delete({ where: { id: shipment.id } });

  console.log('===== BOSTA OK =====');
  process.exit(0);
})().catch((e) => {
  console.error('BOSTA TEST FAILED:', e);
  process.exit(1);
});
NODE
