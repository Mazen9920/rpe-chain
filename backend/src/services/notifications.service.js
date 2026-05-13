// Outbound notifications — find users subscribed to a given alert type/severity
// and enqueue per-recipient email rows on the outbox.
//
// Subscription matching: a subscription matches an alert if
//   (sub.alertType === null OR sub.alertType === alert.type) AND
//   (sub.severity  === null OR meets sub.severity threshold) AND
//   sub.isActive === true AND sub.channel === 'EMAIL'
//
// Severity ordering: LOW < MEDIUM < HIGH < CRITICAL.

const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const outbox = require('./outbox.service');

const SEV_ORDER = { LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

function meetsSeverity(subscriptionMin, alertSeverity) {
  if (!subscriptionMin) return true;
  return (SEV_ORDER[alertSeverity] || 0) >= (SEV_ORDER[subscriptionMin] || 0);
}

function renderAlertEmail(alert) {
  const subject = `[RPE Chain][${alert.severity}] ${alert.type} — ${alert.reasoning?.slice(0, 80) || 'New alert'}`;
  const payloadStr = alert.payload ? JSON.stringify(alert.payload, null, 2) : '';
  const text = [
    `Severity: ${alert.severity}`,
    `Type:     ${alert.type}`,
    `Entity:   ${alert.entityType || '-'} / ${alert.entityId || '-'}`,
    '',
    alert.reasoning || '',
    '',
    payloadStr ? '--- Payload ---' : '',
    payloadStr,
  ].filter(Boolean).join('\n');
  const html = `
    <p><strong>Severity:</strong> ${alert.severity}<br/>
       <strong>Type:</strong> ${alert.type}<br/>
       <strong>Entity:</strong> ${alert.entityType || '-'} / ${alert.entityId || '-'}</p>
    <p>${(alert.reasoning || '').replace(/</g, '&lt;')}</p>
    ${payloadStr ? `<pre style="background:#f4f4f4;padding:8px;border-radius:4px;">${payloadStr.replace(/</g, '&lt;')}</pre>` : ''}
  `;
  return { subject, text, html };
}

// Called by alerts.service.upsertAlert when a NEW alert is created.
// `alert` here is the row just created (has id, type, severity, reasoning, payload, entity, audienceRoles).
async function dispatchAlertEmail(alert) {
  // 1. find candidate users: by audienceRoles OR by AlertSubscription match
  const targetUsers = new Map(); // userId -> { email, name }

  // Role-based default fan-out (audience map from alerts.service).
  if (Array.isArray(alert.audienceRoles) && alert.audienceRoles.length) {
    const roleUsers = await prisma.user.findMany({
      where: { role: { in: alert.audienceRoles }, isActive: true, email: { not: '' } },
      select: { id: true, email: true, name: true },
    });
    for (const u of roleUsers) targetUsers.set(u.id, u);
  }

  // Subscription overrides: also include users with an explicit matching subscription.
  const subs = await prisma.alertSubscription.findMany({
    where: {
      isActive: true,
      channel: 'EMAIL',
      OR: [{ alertType: null }, { alertType: alert.type }],
    },
    include: { user: { select: { id: true, email: true, name: true, isActive: true } } },
  });

  // Apply opt-out logic: subscriptions with isActive=false are excluded.
  // (For v1 we only honor positive subscriptions; explicit unsubscribes can be added later.)
  for (const s of subs) {
    if (!s.user || !s.user.isActive || !s.user.email) continue;
    if (!meetsSeverity(s.severity, alert.severity)) continue;
    targetUsers.set(s.user.id, s.user);
  }

  if (!targetUsers.size) {
    logger.info({ alertId: alert.id, type: alert.type }, 'notifications: no recipients matched');
    return { recipients: 0 };
  }

  const { subject, text, html } = renderAlertEmail(alert);

  let enqueued = 0;
  for (const u of targetUsers.values()) {
    await outbox.enqueue({
      target: 'email',
      action: 'alert-notify',
      payload: { to: u.email, subject, text, html, tag: `alert-${alert.type}` },
      // Idempotency: at most one outbox row per (alert, user)
      idempotencyKey: `alert:${alert.id}:user:${u.id}`,
    });
    enqueued += 1;
  }
  logger.info({ alertId: alert.id, type: alert.type, severity: alert.severity, enqueued }, 'notifications: enqueued');
  return { recipients: enqueued };
}

// Daily 07:00 UTC digest: summary of OPEN alerts grouped by severity.
async function sendDailyDigest() {
  const open = await prisma.alert.findMany({
    where: { status: 'OPEN' },
    orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
  const counts = open.reduce((acc, a) => { acc[a.severity] = (acc[a.severity] || 0) + 1; return acc; }, {});

  const subs = await prisma.alertSubscription.findMany({
    where: { isActive: true, channel: 'EMAIL' },
    include: { user: { select: { id: true, email: true, isActive: true } } },
  });
  const recipients = new Map();
  for (const s of subs) {
    if (s.user?.isActive && s.user.email) recipients.set(s.user.id, s.user);
  }
  if (!recipients.size) return { recipients: 0, openAlerts: open.length };

  const lines = open.slice(0, 50).map((a) => `[${a.severity}] ${a.type}: ${a.reasoning || a.entityId}`);
  const subject = `RPE Chain — Daily alert digest (${open.length} open)`;
  const text = [
    `Open alerts: ${open.length}`,
    `By severity: ${JSON.stringify(counts)}`,
    '',
    ...lines,
    open.length > 50 ? `... and ${open.length - 50} more` : '',
  ].filter(Boolean).join('\n');
  const html = `
    <h2>Daily alert digest</h2>
    <p>${open.length} open alerts. ${Object.entries(counts).map(([k, v]) => `<strong>${k}:</strong> ${v}`).join(' &nbsp; ')}</p>
    <ul>${lines.map((l) => `<li>${l.replace(/</g, '&lt;')}</li>`).join('')}</ul>
  `;

  const stamp = new Date().toISOString().slice(0, 10);
  let enqueued = 0;
  for (const u of recipients.values()) {
    await outbox.enqueue({
      target: 'email',
      action: 'daily-digest',
      payload: { to: u.email, subject, text, html, tag: 'daily-digest' },
      idempotencyKey: `digest:${stamp}:user:${u.id}`,
    });
    enqueued += 1;
  }
  return { recipients: enqueued, openAlerts: open.length };
}

async function listSubscriptions(userId) {
  return prisma.alertSubscription.findMany({
    where: { userId },
    orderBy: [{ alertType: 'asc' }, { severity: 'asc' }],
  });
}

async function replaceSubscriptions(userId, items) {
  // items: [{ alertType, severity, channel, isActive }]
  return prisma.$transaction(async (tx) => {
    await tx.alertSubscription.deleteMany({ where: { userId } });
    if (!Array.isArray(items) || !items.length) return [];
    const data = items.map((i) => ({
      userId,
      alertType: i.alertType || null,
      severity: i.severity || null,
      channel: i.channel || 'EMAIL',
      isActive: i.isActive !== false,
    }));
    await tx.alertSubscription.createMany({ data });
    return tx.alertSubscription.findMany({ where: { userId } });
  });
}

async function seedDefaultSubscriptionsForAdmins() {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
    select: { id: true },
  });
  let created = 0;
  for (const a of admins) {
    const existing = await prisma.alertSubscription.findFirst({ where: { userId: a.id } });
    if (existing) continue;
    await prisma.alertSubscription.create({
      data: { userId: a.id, alertType: null, severity: 'HIGH', channel: 'EMAIL', isActive: true },
    });
    created += 1;
  }
  return { admins: admins.length, created };
}

module.exports = {
  dispatchAlertEmail,
  sendDailyDigest,
  listSubscriptions,
  replaceSubscriptions,
  seedDefaultSubscriptionsForAdmins,
  renderAlertEmail,
};
