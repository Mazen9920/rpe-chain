#!/usr/bin/env bash
# Section 9 / Phase C — Compliance smoke test.
# Exercises certifications CRUD + PDF roundtrip + CERTIFICATION_EXPIRY scanner + lot recall.
set -e
cd "$(dirname "$0")/.."

echo "===== COMPLIANCE ====="

node - <<'NODE'
const assert = require('assert');

(async () => {
  const prisma = require('./src/lib/prisma');
  const compliance = require('./src/services/compliance.service');
  const storage = require('./src/lib/storage');

  // Find/create a product for testing
  let product = await prisma.product.findFirst({ where: { isActive: true, deletedAt: null } });
  assert.ok(product, 'need at least one active product');

  // T1: replaceForProduct stores normalized certs
  const items = [
    { type: 'NIOSH', number: 'N95-001', issuedAt: '2024-01-01', expiresAt: new Date(Date.now() + 365 * 86400000).toISOString() },
    { type: 'EN149', number: 'EN-77', expiresAt: new Date(Date.now() + 15 * 86400000).toISOString() }, // 15d - HIGH
    { type: 'CE', number: 'CE-99', expiresAt: new Date(Date.now() - 5 * 86400000).toISOString() },     // expired - CRITICAL
    { type: 'ISO', number: 'I-1' },                                                                     // no expiry
  ];
  const saved = await compliance.replaceForProduct(product.id, items, { id: null });
  assert.strictEqual(saved.length, 4);
  assert.ok(saved.every((c) => c.id && c.type));
  console.log(' \u2713 replaceForProduct normalizes and persists');

  // T2: listForProduct round-trip
  const listed = await compliance.listForProduct(product.id);
  assert.strictEqual(listed.length, 4);
  console.log(' \u2713 listForProduct returns persisted certs');

  // T3: PDF upload + signed URL roundtrip
  const fakePdf = Buffer.from('%PDF-1.4\n% compliance smoke test\n%%EOF\n');
  const up = await compliance.uploadDocument(product.id, { buffer: fakePdf, mimeType: 'application/pdf', originalName: 'cert.pdf' });
  assert.ok(up.key && up.key.includes(`products/${product.id}/certifications/`));
  console.log(` \u2713 uploadDocument wrote ${up.sizeBytes}B to ${up.key}`);

  // Verify roundtrip via storage.getObject
  const got = await storage.getObject(up.key);
  assert.ok(got && got.length === fakePdf.length, 'getObject roundtrip mismatch');
  const signed = await storage.getSignedUrl(up.key, 60);
  assert.ok(typeof signed === 'string' && signed.length > 0, 'signed URL missing');
  console.log(' \u2713 storage getObject + getSignedUrl roundtrip OK');
  await storage.deleteObject(up.key);

  // T4: scanCertificationExpiryAlerts emits HIGH and CRITICAL
  // Clear any open cert-expiry alerts first for a deterministic baseline
  await prisma.alert.deleteMany({ where: { type: 'CERTIFICATION_EXPIRY', productId: product.id } });
  const scan = await compliance.scanCertificationExpiryAlerts();
  assert.ok(scan.active >= 2, `expected >=2 active cert-expiry alerts, got ${JSON.stringify(scan)}`);

  const openAlerts = await prisma.alert.findMany({ where: { type: 'CERTIFICATION_EXPIRY', productId: product.id, status: 'OPEN' } });
  const severities = openAlerts.map((a) => a.severity).sort();
  assert.ok(severities.includes('CRITICAL'), 'expected a CRITICAL alert for expired cert');
  assert.ok(severities.includes('HIGH'), 'expected a HIGH alert for cert within 30d');
  console.log(` \u2713 scanCertificationExpiryAlerts created ${openAlerts.length} alerts (${severities.join(',')})`);

  // T5: re-scan is idempotent (no duplicates)
  const scan2 = await compliance.scanCertificationExpiryAlerts();
  const openAlerts2 = await prisma.alert.findMany({ where: { type: 'CERTIFICATION_EXPIRY', productId: product.id, status: 'OPEN' } });
  assert.strictEqual(openAlerts2.length, openAlerts.length, 'rescan should be idempotent');
  console.log(` \u2713 rescan idempotent (still ${openAlerts2.length} open)`);

  // T6: auto-resolve when cert removed
  await compliance.replaceForProduct(product.id, [items[0]], { id: null }); // only the >1y one
  const scan3 = await compliance.scanCertificationExpiryAlerts();
  assert.ok(scan3.resolved >= 2, `expected >=2 resolved, got ${JSON.stringify(scan3)}`);
  console.log(' \u2713 auto-resolves stale cert-expiry alerts');

  // Cleanup
  await compliance.replaceForProduct(product.id, [], { id: null });
  await prisma.alert.deleteMany({ where: { type: 'CERTIFICATION_EXPIRY', productId: product.id } });

  // T7: lot recall — find or create a lot
  let lot = await prisma.lot.findFirst({ where: { qtyRemaining: { gt: 0 } } });
  let createdLot = false;
  if (!lot) {
    lot = await prisma.lot.create({
      data: {
        productId: product.id, lotNumber: `RECALL-TEST-${Date.now()}`,
        receivedDate: new Date(), qtyReceived: 10, qtyRemaining: 10, qaStatus: 'RELEASED',
      },
    });
    createdLot = true;
  }
  const lotBefore = lot.qaStatus;

  try { await compliance.recallLot(lot.id, { reason: '', actorId: null }); assert.fail('expected error'); }
  catch (e) { assert.ok(e.status === 400, `expected 400, got ${e.status}: ${e.message}`); }
  console.log(' \u2713 recallLot rejects empty reason');

  const recallResult = await compliance.recallLot(lot.id, { reason: 'smoke test - failed integrity', actorId: null });
  assert.strictEqual(recallResult.lot.qaStatus, 'QUARANTINED');
  console.log(` \u2713 recallLot quarantines lot (${recallResult.affectedSalesOrders} SOs traced)`);

  // Verify audit + critical alert
  const auditEvent = await prisma.eventLog.findFirst({
    where: { eventType: 'LOT_RECALLED', entityId: lot.id },
    orderBy: { occurredAt: 'desc' },
  });
  assert.ok(auditEvent, 'audit log for LOT_RECALLED missing');
  console.log(' \u2713 LOT_RECALLED audit event recorded');

  const recallAlert = await prisma.alert.findFirst({
    where: { type: 'DEAD_STOCK', entityType: 'Lot', entityId: lot.id, status: 'OPEN', severity: 'CRITICAL' },
  });
  assert.ok(recallAlert, 'CRITICAL recall alert missing');
  console.log(' \u2713 CRITICAL recall alert emitted');

  // Restore
  await prisma.alert.deleteMany({ where: { type: 'DEAD_STOCK', entityType: 'Lot', entityId: lot.id } });
  if (createdLot) {
    await prisma.lot.delete({ where: { id: lot.id } });
  } else {
    await prisma.lot.update({ where: { id: lot.id }, data: { qaStatus: lotBefore } });
  }

  await prisma.$disconnect();
  console.log('COMPLIANCE: all assertions passed');
})().catch((e) => { console.error(e); process.exit(1); });
NODE
