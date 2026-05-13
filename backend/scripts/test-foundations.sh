#!/usr/bin/env bash
# Section 9 / Phase A — Foundations smoke test.
# Exercises storage (local driver), outbox enqueue+dispatch, HMAC middleware, mailer noop.
# Runs in-process via a Node harness — no live HTTP server required.

set -e
cd "$(dirname "$0")/.."

echo "===== FOUNDATIONS (storage / outbox / hmac / mailer) ====="

WEBHOOK_SIGNATURE_DISABLED=false STORAGE_DRIVER=local node - <<'NODE'
const assert = require('assert');
const crypto = require('crypto');

(async () => {
  // -------- storage (local driver) --------
  process.env.STORAGE_DRIVER = 'local';
  const storage = require('./src/lib/storage');
  const key = `test/${Date.now()}.txt`;
  const body = Buffer.from('hello-foundations');
  const put = await storage.putObject(key, body, 'text/plain');
  assert.strictEqual(put.driver, 'local', 'driver should be local');
  const got = await storage.getObject(key);
  assert.strictEqual(got.toString(), 'hello-foundations', 'roundtrip body match');
  const url = await storage.getSignedUrl(key, 60);
  assert.ok(typeof url === 'string' && url.length > 0, 'signed url string');
  await storage.deleteObject(key);
  console.log(' \u2713 storage put/get/sign/delete (local)');

  // -------- outbox enqueue + dispatch (email handler, mailer noop) --------
  delete process.env.SENDGRID_API_KEY;
  delete process.env.SMTP_HOST;
  // Re-require mailer in noop mode
  delete require.cache[require.resolve('./src/lib/mailer')];
  require('./src/lib/mailer');

  const outbox = require('./src/services/outbox.service');
  require('./src/services/integrations/email/handler'); // registers 'email' target

  const prisma = require('./src/lib/prisma');

  // Clean up any old test rows
  await prisma.integrationOutbox.deleteMany({ where: { target: 'email', action: 'foundations-smoke' } });

  const row = await outbox.enqueue({
    target: 'email',
    action: 'foundations-smoke',
    payload: { to: 'smoke@example.com', subject: 'hi', text: 'world', tag: 'smoke' },
    idempotencyKey: `smoke-${Date.now()}`,
  });
  assert.ok(row.id, 'enqueue returns row id');

  // Idempotency: same key returns same row
  const row2 = await outbox.enqueue({
    target: 'email', action: 'foundations-smoke',
    payload: { to: 'x@x', subject: 's', text: 't' },
    idempotencyKey: row.idempotencyKey,
  });
  assert.strictEqual(row2.id, row.id, 'idempotency key dedupes');

  const res = await outbox.processBatch({ limit: 10 });
  assert.ok(res.ok >= 1, `processBatch ok>=1 (got ${JSON.stringify(res)})`);

  const after = await prisma.integrationOutbox.findUnique({ where: { id: row.id } });
  assert.strictEqual(after.status, 'SENT', 'row marked SENT');
  console.log(' \u2713 outbox enqueue + dispatch + idempotency');

  // -------- outbox retry/backoff --------
  outbox.registerHandler('test-fail', async () => { throw new Error('boom'); });
  const failRow = await outbox.enqueue({
    target: 'test-fail', action: 'always-fails', payload: { x: 1 },
    idempotencyKey: `fail-${Date.now()}`,
  });
  await outbox.processBatch({ limit: 10 });
  const failed = await prisma.integrationOutbox.findUnique({ where: { id: failRow.id } });
  assert.strictEqual(failed.status, 'PENDING', 'retry: still PENDING after first failure');
  assert.strictEqual(failed.attempts, 1, 'attempts=1');
  assert.ok(failed.nextAttemptAt > new Date(Date.now() + 30_000), 'nextAttemptAt pushed forward');
  console.log(' \u2713 outbox retry/backoff schedules next attempt');

  // -------- hmac middleware --------
  const { verifyHmac } = require('./src/middleware/webhookSignature');
  process.env.FOUNDATIONS_TEST_SECRET = 'topsecret';
  const mw = verifyHmac({ headerName: 'X-Test-Sig', secretEnv: 'FOUNDATIONS_TEST_SECRET' });

  const raw = Buffer.from(JSON.stringify({ ping: 'pong' }));
  const goodSig = crypto.createHmac('sha256', 'topsecret').update(raw).digest('base64');

  function run(req) {
    return new Promise((resolve) => {
      const res = {
        statusCode: 200, _json: null,
        status(c) { this.statusCode = c; return this; },
        json(o) { this._json = o; resolve({ status: this.statusCode, body: this._json, called: 'res' }); return this; },
      };
      mw(req, res, () => resolve({ status: 200, body: null, called: 'next' }));
    });
  }
  const okRes = await run({ body: raw, get: (h) => (h === 'X-Test-Sig' ? goodSig : '') });
  assert.strictEqual(okRes.called, 'next', 'valid hmac passes');
  const badRes = await run({ body: raw, get: () => 'totally-wrong' });
  assert.strictEqual(badRes.status, 401, 'invalid hmac -> 401');
  console.log(' \u2713 hmac middleware: valid passes, invalid 401');

  // -------- mailer noop --------
  const mailer = require('./src/lib/mailer');
  const r = await mailer.sendEmail({ to: 'a@b', subject: 's', text: 't', tag: 'unit' });
  assert.strictEqual(r.mode, 'noop', 'mailer mode = noop without creds');
  console.log(' \u2713 mailer no-op path');

  // cleanup
  await prisma.integrationOutbox.deleteMany({
    where: { target: { in: ['email', 'test-fail'] }, action: { in: ['foundations-smoke', 'always-fails'] } },
  });
  await prisma.$disconnect();
  console.log('FOUNDATIONS: all assertions passed');
})().catch((e) => { console.error('FOUNDATIONS FAILED:', e); process.exit(1); });
NODE

echo "===== FOUNDATIONS PASSED ====="
