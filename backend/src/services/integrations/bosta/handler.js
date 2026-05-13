// Bosta outbox handler + tracking ingest.
const prisma = require('../../../lib/prisma');
const logger = require('../../../lib/logger');
const storage = require('../../../lib/storage');
const outbox = require('../../outbox.service');
const client = require('./client');
const alertsSvc = require('../../alerts.service');

const { logEvent } = require('../../audit.service');

// ─── Outbox: delivery.create ─────────────────────────────────────────────────
outbox.registerHandler('bosta', async ({ action, payload }) => {
  if (action !== 'delivery.create') {
    throw new Error(`bosta: unknown action ${action}`);
  }
  if (!client.isConfigured()) {
    const err = new Error('bosta not configured');
    err.code = 'BOSTA_NOT_CONFIGURED';
    throw err; // outbox will retry with backoff
  }
  const { shipmentId } = payload;
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    include: {
      lines: true,
      salesOrder: { include: { customer: true } },
    },
  });
  if (!shipment) throw new Error(`shipment ${shipmentId} not found`);
  if (shipment.carrierRef) {
    logger.info({ shipmentId, carrierRef: shipment.carrierRef }, 'bosta: shipment already has carrierRef, skipping create');
    return;
  }
  const body = client.buildDeliveryPayload(shipment);
  const resp = await client.createDelivery(body);
  const trackingNumber = resp?.trackingNumber || resp?.data?.trackingNumber;
  const deliveryId = resp?._id || resp?.data?._id || resp?.id;
  // Fetch label PDF (best-effort)
  let labelKey = null;
  try {
    const pdf = await client.fetchLabelPdf(deliveryId || trackingNumber);
    if (pdf && pdf.length) {
      labelKey = `bosta-labels/${shipmentId}.pdf`;
      await storage.putObject(labelKey, pdf, 'application/pdf');
    }
  } catch (e) {
    logger.warn({ shipmentId, err: e.message }, 'bosta: label fetch failed, will continue without');
  }
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: {
      carrierRef: String(deliveryId || trackingNumber || ''),
      trackingNumber: trackingNumber ? String(trackingNumber) : undefined,
      labelKey,
    },
  });
  logger.info({ shipmentId, carrierRef: deliveryId, labelKey }, 'bosta: delivery created');
});

logger.info('bosta outbox handler registered');

// ─── Webhook: tracking ingest ────────────────────────────────────────────────
// Idempotent — uses Shipment.lastTrackingEventId to dedupe a given event id.
async function ingestTrackingEvent(payload, { actor = null } = {}) {
  if (!payload || typeof payload !== 'object') {
    const err = new Error('bosta tracking payload missing');
    err.status = 400;
    throw err;
  }
  // Bosta sends { _id, trackingNumber, state: { code, value }, businessReference, updatedAt, ... }
  const eventId = String(payload._id || payload.eventId || `${payload.trackingNumber}:${payload.state?.code}:${payload.updatedAt}`);
  const trackingNumber = payload.trackingNumber ? String(payload.trackingNumber) : null;
  const businessReference = payload.businessReference || payload.businessRef || null;
  const stateCode = payload.state?.code != null ? payload.state.code : payload.stateCode;

  // Locate shipment by carrierRef OR trackingNumber OR businessReference (=shipmentNumber).
  let shipment = null;
  const where = [];
  if (payload._id) where.push({ carrierRef: String(payload._id) });
  if (trackingNumber) where.push({ trackingNumber });
  if (businessReference) where.push({ shipmentNumber: String(businessReference) });
  if (where.length === 0) {
    const err = new Error('cannot locate shipment from tracking payload');
    err.status = 400;
    throw err;
  }
  shipment = await prisma.shipment.findFirst({ where: { OR: where } });
  if (!shipment) {
    logger.warn({ trackingNumber, businessReference }, 'bosta: shipment not found for tracking event');
    return { matched: false };
  }
  if (shipment.lastTrackingEventId && shipment.lastTrackingEventId === eventId) {
    logger.info({ shipmentId: shipment.id, eventId }, 'bosta: duplicate tracking event ignored');
    return { matched: true, deduped: true, shipmentId: shipment.id };
  }
  const mappedStatus = client.mapState(stateCode);
  const occurredAt = payload.updatedAt ? new Date(payload.updatedAt) : new Date();

  const updates = { lastTrackingEventId: eventId };
  if (mappedStatus && mappedStatus !== shipment.status) updates.status = mappedStatus;
  if (mappedStatus === 'DELIVERED' && !shipment.deliveredAt) updates.deliveredAt = occurredAt;

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: shipment.id }, data: updates });
    await tx.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        eventType: mappedStatus || 'EXCEPTION',
        occurredAt,
        location: payload.location || null,
        rawPayload: payload,
      },
    });
    if (mappedStatus === 'DELIVERED' && shipment.salesOrderId) {
      // Flip parent SO.deliveredAt if all shipments delivered (best-effort: just set if null).
      const so = await tx.salesOrder.findUnique({
        where: { id: shipment.salesOrderId },
        include: { shipments: { select: { id: true, deliveredAt: true, voidedAt: true } } },
      });
      if (so) {
        const allDelivered = so.shipments.every(
          (s) => s.id === shipment.id || s.deliveredAt != null || s.voidedAt != null,
        );
        if (allDelivered && !so.deliveredAt) {
          await tx.salesOrder.update({ where: { id: so.id }, data: { deliveredAt: occurredAt } });
        }
      }
    }
  });

  // Auto-resolve open SHIPMENT_DELAY alerts when delivered.
  if (mappedStatus === 'DELIVERED') {
    try {
      const open = await prisma.alert.findMany({
        where: { status: 'OPEN', type: 'SHIPMENT_DELAY', entityType: 'Shipment', entityId: shipment.id },
      });
      for (const a of open) {
        await alertsSvc.resolveAlert(a.id, actor?.id || null);
      }
    } catch (e) {
      logger.warn({ err: e.message }, 'bosta: auto-resolve alerts failed');
    }
  }

  await logEvent({
    eventType: 'SHIPMENT_TRACKING_UPDATED',
    entityType: 'Shipment',
    entityId: shipment.id,
    actorId: actor?.id || null,
    payload: { eventId, stateCode, mappedStatus, trackingNumber },
  });

  logger.info({ shipmentId: shipment.id, stateCode, mappedStatus }, 'bosta: tracking event processed');
  return { matched: true, deduped: false, shipmentId: shipment.id, status: mappedStatus };
}

module.exports = { ingestTrackingEvent };
