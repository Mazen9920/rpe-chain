// Compliance — certifications + lot recall.
// Certifications live as a JSON array on Product.certifications:
//   [{ id, type, number, issuedAt, expiresAt, documentKey?, notes? }]
// Files (PDFs) live in object storage under products/<productId>/certifications/<uuid>.pdf.

const crypto = require('crypto');
const prisma = require('../lib/prisma');
const storage = require('../lib/storage');
const { logEvent } = require('./audit.service');
const logger = require('../lib/logger');

const CERT_TYPES = ['NIOSH', 'EN149', 'EN14683', 'CE', 'FDA', 'ASTM', 'ISO', 'OTHER'];

function normalizeCerts(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((c) => c && (c.type || c.number))
    .map((c) => ({
      id: c.id || crypto.randomUUID(),
      type: CERT_TYPES.includes(c.type) ? c.type : (c.type || 'OTHER'),
      number: c.number || null,
      issuedAt: c.issuedAt ? new Date(c.issuedAt).toISOString() : null,
      expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
      documentKey: c.documentKey || null,
      notes: c.notes || null,
    }));
}

async function listForProduct(productId) {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, certifications: true } });
  if (!p) return null;
  return normalizeCerts(p.certifications);
}

async function replaceForProduct(productId, items, actor) {
  const p = await prisma.product.findUnique({ where: { id: productId } });
  if (!p) return null;
  const norm = normalizeCerts(items);
  const updated = await prisma.product.update({
    where: { id: productId },
    data: { certifications: norm, version: { increment: 1 } },
    select: { id: true, certifications: true },
  });
  await logEvent({
    eventType: 'PRODUCT_CERTIFICATIONS_UPDATED',
    entityType: 'Product',
    entityId: productId,
    actorId: actor?.id || null,
    payload: { count: norm.length },
  });
  return normalizeCerts(updated.certifications);
}

async function uploadDocument(productId, { buffer, mimeType, originalName }) {
  const p = await prisma.product.findUnique({ where: { id: productId }, select: { id: true, sku: true } });
  if (!p) throw Object.assign(new Error('Product not found'), { status: 404 });
  if (!buffer || !buffer.length) throw Object.assign(new Error('Empty file'), { status: 400 });

  const id = crypto.randomUUID();
  const ext = (originalName || '').toLowerCase().endsWith('.pdf') ? '.pdf' : '';
  const key = `products/${productId}/certifications/${id}${ext}`;
  await storage.putObject(key, buffer, mimeType || 'application/pdf');
  const url = await storage.getSignedUrl(key, 600).catch(() => null);
  return { key, url, sizeBytes: buffer.length };
}

// CERTIFICATION_EXPIRY alert generator — called from the daily pass.
// Severity: expired -> CRITICAL, <=30d -> HIGH, <=90d -> MEDIUM.
async function scanCertificationExpiryAlerts() {
  const TYPES = ['CERTIFICATION_EXPIRY'];
  const alerts = require('./alerts.service');
  const openByKey = await alerts.loadOpenAlertsForTypes(TYPES);
  const stillActive = new Set();

  const products = await prisma.product.findMany({
    where: { isActive: true, deletedAt: null, certifications: { not: null } },
    select: { id: true, sku: true, name: true, certifications: true },
  });

  const now = Date.now();
  for (const p of products) {
    const certs = Array.isArray(p.certifications) ? p.certifications : [];
    for (const c of certs) {
      if (!c?.expiresAt) continue;
      const expMs = new Date(c.expiresAt).getTime();
      if (!Number.isFinite(expMs)) continue;
      const daysLeft = Math.ceil((expMs - now) / 86_400_000);
      if (daysLeft > 90) continue;
      let severity;
      if (daysLeft < 0) severity = 'CRITICAL';
      else if (daysLeft <= 30) severity = 'HIGH';
      else severity = 'MEDIUM';
      await alerts.upsertAlert(stillActive, openByKey, {
        type: 'CERTIFICATION_EXPIRY',
        severity,
        productId: p.id,
        entityType: 'Product',
        entityId: `${p.id}:${c.id || c.number || c.type}`,
        payload: {
          sku: p.sku, productName: p.name,
          certificationId: c.id, certType: c.type, certNumber: c.number,
          expiresAt: c.expiresAt, daysLeft,
        },
        reasoning: daysLeft < 0
          ? `${p.sku} certification ${c.type} ${c.number || ''} expired ${Math.abs(daysLeft)} day(s) ago.`
          : `${p.sku} certification ${c.type} ${c.number || ''} expires in ${daysLeft} day(s).`,
      });
    }
  }

  const resolved = await alerts.autoResolveStale(TYPES, stillActive);
  return { active: stillActive.size, resolved };
}

// Recall a lot: quarantines it, records an audit event, and emits a CRITICAL alert.
// Recall affects all open Shipments + SalesOrders containing this lot (genealogy).
async function recallLot(lotId, { reason, actorId }) {
  const lot = await prisma.lot.findUnique({
    where: { id: lotId },
    include: { product: { select: { id: true, sku: true, name: true } } },
  });
  if (!lot) throw Object.assign(new Error('Lot not found'), { status: 404 });
  if (!reason || !reason.trim()) throw Object.assign(new Error('reason is required'), { status: 400 });

  // Trace genealogy: find SHIPMENT movements that drained this lot, then look up the SO.
  const movements = await prisma.stockMovement.findMany({
    where: { lotId, reasonCode: 'SHIPMENT' },
    select: { id: true, qty: true, sourceDocType: true, sourceDocId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  }).catch(() => []);

  const soIds = [...new Set(movements.filter((m) => m.sourceDocType === 'SO' && m.sourceDocId).map((m) => m.sourceDocId))];
  const salesOrders = soIds.length
    ? await prisma.salesOrder.findMany({
        where: { id: { in: soIds } },
        select: { id: true, orderNumber: true, customerId: true, status: true, customer: { select: { name: true, email: true } } },
      }).catch(() => [])
    : [];

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.lot.update({
      where: { id: lotId },
      data: { qaStatus: 'QUARANTINED' },
    });
    return updated;
  });

  await logEvent({
    eventType: 'LOT_RECALLED',
    entityType: 'Lot',
    entityId: lotId,
    actorId: actorId || null,
    payload: {
      lotNumber: lot.lotNumber,
      productId: lot.productId,
      sku: lot.product?.sku,
      reason,
      affectedSalesOrders: salesOrders,
      movementCount: movements.length,
    },
  });

  // Create CRITICAL alert (uses notifications fan-out)
  try {
    const alertsSvc = require('./alerts.service');
    const stillActive = new Set();
    const openByKey = await alertsSvc.loadOpenAlertsForTypes(['DEAD_STOCK']);
    await alertsSvc.upsertAlert(stillActive, openByKey, {
      type: 'DEAD_STOCK',
      severity: 'CRITICAL',
      productId: lot.productId,
      entityType: 'Lot',
      entityId: lot.id,
      payload: {
        recalled: true, lotId: lot.id, lotNumber: lot.lotNumber,
        sku: lot.product?.sku, reason,
        affectedSalesOrderCount: salesOrders.length,
      },
      reasoning: `RECALL: lot ${lot.lotNumber} (${lot.product?.sku}) — ${reason}. ${salesOrders.length} sales order(s) affected.`,
    });
  } catch (e) {
    logger.warn({ err: e.message }, 'recallLot: alert creation failed');
  }

  return {
    lot: result,
    affectedSalesOrders: salesOrders.length,
    salesOrders,
  };
}

module.exports = {
  CERT_TYPES,
  normalizeCerts,
  listForProduct,
  replaceForProduct,
  uploadDocument,
  scanCertificationExpiryAlerts,
  recallLot,
};
