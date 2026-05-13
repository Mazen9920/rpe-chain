#!/usr/bin/env bash
# Section 9 / Phase B — Notifications smoke test.
# Tests dispatchAlertEmail() fan-out, AlertSubscription matching, daily digest, and the API routes.
set -e
cd "$(dirname "$0")/.."

echo "===== NOTIFICATIONS ====="

node - <<'NODE'
const assert = require('assert');

(async () => {
  const prisma = require('./src/lib/prisma');
  const notifications = require('./src/services/notifications.service');
  const outbox = require('./src/services/outbox.service');
  require('./src/services/integrations/email/handler');

  // Clean slate
  await prisma.integrationOutbox.deleteMany({ where: { action: { in: ['alert-notify', 'daily-digest'] } } });

  // Find admin user
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN', isActive: true } });
  assert.ok(admin, 'admin user must exist');
  assert.ok(admin.email, 'admin must have email');

  // T1: seed defaults
  await prisma.alertSubscription.deleteMany({ where: { userId: admin.id } });
  const seed = await notifications.seedDefaultSubscriptionsForAdmins();
  assert.ok(seed.created >= 1, `expected seed.created>=1, got ${JSON.stringify(seed)}`);
  console.log(' \u2713 seedDefaultSubscriptionsForAdmins creates admin defaults');

  // T2: dispatch NEW alert -> outbox row created with idempotency key
  // Synthesise an in-memory "alert" matching what upsertAlert would pass after create.
  const fakeAlert = {
    id: `test-alert-${Date.now()}`,
    type: 'STOCKOUT_RISK',
    severity: 'HIGH',
    audienceRoles: ['ADMIN'],
    entityType: 'StockLevel',
    entityId: 'fake-entity',
    payload: { sku: 'TEST-SKU', onHand: 0 },
    reasoning: 'TEST-SKU is out of stock.',
  };
  const r = await notifications.dispatchAlertEmail(fakeAlert);
  assert.ok(r.recipients >= 1, `expected recipients>=1, got ${JSON.stringify(r)}`);
  const row = await prisma.integrationOutbox.findUnique({
    where: { idempotencyKey: `alert:${fakeAlert.id}:user:${admin.id}` },
  });
  assert.ok(row, 'outbox row created for admin');
  assert.strictEqual(row.status, 'PENDING');
  console.log(' \u2713 dispatchAlertEmail enqueues outbox row to subscribed admin');

  // T3: dispatching same alert again is idempotent (no duplicate row)
  await notifications.dispatchAlertEmail(fakeAlert);
  const dupCount = await prisma.integrationOutbox.count({
    where: { action: 'alert-notify', idempotencyKey: `alert:${fakeAlert.id}:user:${admin.id}` },
  });
  assert.strictEqual(dupCount, 1, 'second dispatch is a no-op');
  console.log(' \u2713 dispatch is idempotent on (alert,user)');

  // T4: severity filter — sub with severity=CRITICAL should NOT receive a HIGH alert
  await prisma.alertSubscription.deleteMany({ where: { userId: admin.id } });
  await prisma.alertSubscription.create({
    data: { userId: admin.id, alertType: null, severity: 'CRITICAL', channel: 'EMAIL', isActive: true },
  });
  // Also clear audienceRoles so the only path is subscription
  const lowSev = { ...fakeAlert, id: `low-${Date.now()}`, severity: 'HIGH', audienceRoles: [] };
  const r2 = await notifications.dispatchAlertEmail(lowSev);
  assert.strictEqual(r2.recipients, 0, 'HIGH alert should be filtered out by CRITICAL-only subscription');
  console.log(' \u2713 severity filter excludes lower-priority alerts');

  // T5: outbox dispatch sends the email (noop mode -> just marks SENT)
  delete process.env.SENDGRID_API_KEY;
  delete process.env.SMTP_HOST;
  delete require.cache[require.resolve('./src/lib/mailer')];
  delete require.cache[require.resolve('./src/services/integrations/email/handler')];
  require('./src/lib/mailer');
  require('./src/services/integrations/email/handler');
  await outbox.processBatch({ limit: 50 });
  const afterRow = await prisma.integrationOutbox.findUnique({ where: { id: row.id } });
  assert.strictEqual(afterRow.status, 'SENT', 'pending row should be SENT after processBatch');
  console.log(' \u2713 outbox dispatcher sends pending alert-notify rows');

  // T6: daily digest
  // Restore default subscription
  await prisma.alertSubscription.deleteMany({ where: { userId: admin.id } });
  await prisma.alertSubscription.create({
    data: { userId: admin.id, alertType: null, severity: null, channel: 'EMAIL', isActive: true },
  });
  const digestRes = await notifications.sendDailyDigest();
  assert.ok(digestRes.recipients >= 1, `digest recipients>=1, got ${JSON.stringify(digestRes)}`);
  const stamp = new Date().toISOString().slice(0, 10);
  const digestRow = await prisma.integrationOutbox.findUnique({
    where: { idempotencyKey: `digest:${stamp}:user:${admin.id}` },
  });
  assert.ok(digestRow, 'digest row enqueued');
  console.log(' \u2713 sendDailyDigest enqueues digest emails');

  // Cleanup
  await prisma.integrationOutbox.deleteMany({ where: { action: { in: ['alert-notify', 'daily-digest'] } } });
  await prisma.$disconnect();
  console.log('NOTIFICATIONS: all assertions passed');
})().catch((e) => { console.error('NOTIFICATIONS FAILED:', e); process.exit(1); });
NODE

# ---- API smoke (requires backend running on $BASE) ----
BASE=${BASE:-http://localhost:3000/api}
if curl -fsS "$BASE/health" >/dev/null 2>&1; then
  echo "--- HTTP routes ---"
  TOK=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
    -d '{"email":"admin@rpechain.com","password":"Admin@123"}' \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{process.stdout.write(JSON.parse(d).token||"")}catch{}})')
  if [ -n "$TOK" ]; then
    CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Authorization: Bearer $TOK" $BASE/notifications/subscriptions)
    [ "$CODE" = "200" ] && echo " \u2713 GET /notifications/subscriptions 200" || { echo " ✗ got $CODE"; exit 1; }
    PUT=$(curl -s -X PUT $BASE/notifications/subscriptions \
      -H "Authorization: Bearer $TOK" -H 'Content-Type: application/json' \
      -d '[{"alertType":null,"severity":"HIGH","channel":"EMAIL","isActive":true}]')
    echo "$PUT" | grep -q '"alertType"' && echo " \u2713 PUT /notifications/subscriptions accepted" || { echo " ✗ put failed: $PUT"; exit 1; }
  else
    echo " (skipping HTTP — admin login failed)"
  fi
else
  echo " (skipping HTTP — backend not reachable at $BASE)"
fi

echo "===== NOTIFICATIONS PASSED ====="
