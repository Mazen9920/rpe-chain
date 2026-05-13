// Section 7 — Scheduler
// Runs in-process via node-cron. Disable via env DISABLE_SCHEDULER=true (tests).
// Boot-time one-shot via RUN_DAILY_ON_BOOT=true (seed/dev).

const cron = require('node-cron');

let started = false;
const jobs = [];

function logEvent(prisma, eventType, payload) {
  try {
    return prisma.eventLog.create({
      data: { eventType, entityType: 'Scheduler', entityId: 'system', payload },
    });
  } catch (e) {
    console.error('[scheduler] logEvent failed:', e.message);
  }
}

async function runInventoryAlertScan() {
  const prisma = require('../lib/prisma');
  const alerts = require('../services/alerts.service');
  const startedAt = Date.now();
  try {
    const result = await alerts.scanInventoryAlerts();
    console.log(`[scheduler] inventory alerts scan: ${JSON.stringify(result)} in ${Date.now() - startedAt}ms`);
    await logEvent(prisma, 'SCHEDULER_INVENTORY_SCAN', { result, durationMs: Date.now() - startedAt });
  } catch (e) {
    console.error('[scheduler] inventory alerts scan failed:', e.message);
    await logEvent(prisma, 'SCHEDULER_INVENTORY_SCAN_FAILED', { error: e.message });
  }
}

async function runDailyPass() {
  const prisma = require('../lib/prisma');
  const alerts = require('../services/alerts.service');
  const forecast = require('../services/forecast.service');
  const reorder = require('../services/reorder.service');
  const supplierSvc = require('../services/supplier.service');

  const startedAt = Date.now();
  const summary = {};
  try {
    summary.inventoryAlerts = await alerts.scanInventoryAlerts();
    summary.apAlerts = await alerts.scanApAlerts();
    summary.supplierPerfAlerts = await alerts.scanSupplierPerfAlerts();
    summary.shipmentDelayAlerts = await alerts.scanShipmentDelayAlerts();
    summary.creditLimitAlerts = await alerts.scanCreditLimitAlerts();

    summary.supplierScorecards = await supplierSvc.recomputeAllSupplierPerformance().catch((e) => ({ error: e.message }));
    summary.forecasts = await forecast.generateForecasts().catch((e) => ({ error: e.message }));
    summary.reorder = await reorder.generateReorderRecommendations({ actorId: null, useForecast: true }).catch((e) => ({ error: e.message }));

    console.log(`[scheduler] daily pass: ${JSON.stringify(summary)} in ${Date.now() - startedAt}ms`);
    await logEvent(prisma, 'SCHEDULER_DAILY_PASS', { summary, durationMs: Date.now() - startedAt });
  } catch (e) {
    console.error('[scheduler] daily pass failed:', e.message);
    await logEvent(prisma, 'SCHEDULER_DAILY_PASS_FAILED', { error: e.message, summary });
  }
}

async function runOutboxPass() {
  const prisma = require('../lib/prisma');
  // Make sure email handler is registered (in case scheduler is started before app.js)
  require('../services/integrations/email/handler');
  const outbox = require('../services/outbox.service');
  const startedAt = Date.now();
  try {
    const result = await outbox.processBatch({ limit: 50 });
    if (result.claimed > 0) {
      console.log(`[scheduler] outbox: ${JSON.stringify(result)} in ${Date.now() - startedAt}ms`);
      await logEvent(prisma, 'SCHEDULER_OUTBOX_PASS', { result, durationMs: Date.now() - startedAt });
    }
  } catch (e) {
    console.error('[scheduler] outbox pass failed:', e.message);
    await logEvent(prisma, 'SCHEDULER_OUTBOX_PASS_FAILED', { error: e.message });
  }
}

async function runDailyDigest() {
  const prisma = require('../lib/prisma');
  const notifications = require('../services/notifications.service');
  const startedAt = Date.now();
  try {
    const result = await notifications.sendDailyDigest();
    console.log(`[scheduler] daily digest: ${JSON.stringify(result)} in ${Date.now() - startedAt}ms`);
    await logEvent(prisma, 'SCHEDULER_DAILY_DIGEST', { result, durationMs: Date.now() - startedAt });
  } catch (e) {
    console.error('[scheduler] daily digest failed:', e.message);
    await logEvent(prisma, 'SCHEDULER_DAILY_DIGEST_FAILED', { error: e.message });
  }
}

function start() {
  if (process.env.DISABLE_SCHEDULER === 'true') {
    console.log('[scheduler] disabled via DISABLE_SCHEDULER=true');
    return;
  }
  if (started) return;
  started = true;

  // Every 15 minutes — inventory alert scan (fast, idempotent)
  jobs.push(cron.schedule('*/15 * * * *', runInventoryAlertScan, { scheduled: true }));

  // Every minute — outbox dispatcher (Shopify, Bosta, email)
  jobs.push(cron.schedule('* * * * *', runOutboxPass, { scheduled: true }));

  // Daily 02:00 — full cross-module pass + forecasts + reorder
  jobs.push(cron.schedule('0 2 * * *', runDailyPass, { scheduled: true }));

  // Daily 07:00 UTC — alert digest email
  jobs.push(cron.schedule('0 7 * * *', runDailyDigest, { scheduled: true }));

  console.log('[scheduler] armed — */15min inventory scan + */1min outbox + daily 02:00 cross-module pass + 07:00 digest');

  if (process.env.RUN_DAILY_ON_BOOT === 'true') {
    console.log('[scheduler] RUN_DAILY_ON_BOOT=true → running one-shot daily pass now');
    setImmediate(() => runDailyPass().catch((e) => console.error('[scheduler] boot pass failed:', e)));
  }
}

function stop() {
  jobs.forEach((j) => j.stop());
  jobs.length = 0;
  started = false;
  console.log('[scheduler] stopped');
}

module.exports = { start, stop, runInventoryAlertScan, runDailyPass, runOutboxPass, runDailyDigest };
