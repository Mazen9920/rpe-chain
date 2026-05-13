// At-least-once outbound delivery via IntegrationOutbox.
// Target handlers register themselves below. Each handler must be idempotent
// at the receiving side (we'll usually carry an idempotency key in the payload).

const prisma = require('../lib/prisma');
const logger = require('../lib/logger');

const BACKOFF_MINUTES = [1, 5, 30, 120, 720, 1440]; // 1m, 5m, 30m, 2h, 12h, 24h
const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

const handlers = new Map();

function registerHandler(target, fn) {
  handlers.set(target, fn);
}

async function enqueue({ target, action, payload, idempotencyKey }) {
  // Treat idempotencyKey uniqueness: if same key already exists, return existing.
  if (idempotencyKey) {
    const existing = await prisma.integrationOutbox.findUnique({ where: { idempotencyKey } });
    if (existing) return existing;
  }
  return prisma.integrationOutbox.create({
    data: {
      target, action, payload: payload || {},
      idempotencyKey: idempotencyKey || null,
      status: 'PENDING',
      nextAttemptAt: new Date(),
    },
  });
}

async function processBatch({ limit = 25 } = {}) {
  // Claim up to `limit` PENDING rows whose nextAttemptAt has passed.
  // Uses raw SQL for SKIP LOCKED to be safe across multiple workers.
  const ids = await prisma.$queryRawUnsafe(
    `SELECT id FROM "IntegrationOutbox"
       WHERE status = 'PENDING' AND "nextAttemptAt" <= NOW()
       ORDER BY "nextAttemptAt" ASC
       LIMIT ${Number(limit)}
       FOR UPDATE SKIP LOCKED`,
  );
  if (!ids.length) return { claimed: 0, ok: 0, failed: 0 };
  const rows = await prisma.integrationOutbox.findMany({
    where: { id: { in: ids.map((r) => r.id) } },
  });

  let ok = 0;
  let failed = 0;
  for (const row of rows) {
    const handler = handlers.get(row.target);
    if (!handler) {
      await prisma.integrationOutbox.update({
        where: { id: row.id },
        data: { status: 'DEAD', lastError: `No handler for target=${row.target}` },
      });
      failed += 1;
      continue;
    }
    try {
      await handler(row);
      await prisma.integrationOutbox.update({
        where: { id: row.id },
        data: { status: 'SENT', sentAt: new Date(), lastError: null, attempts: row.attempts + 1 },
      });
      ok += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const isDead = attempts >= MAX_ATTEMPTS;
      const nextMin = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length - 1)];
      await prisma.integrationOutbox.update({
        where: { id: row.id },
        data: {
          status: isDead ? 'DEAD' : 'PENDING',
          attempts,
          lastError: String(err.message || err).slice(0, 1000),
          nextAttemptAt: isDead ? row.nextAttemptAt : new Date(Date.now() + nextMin * 60_000),
        },
      });
      failed += 1;
      logger.warn({ id: row.id, target: row.target, action: row.action, attempts, isDead }, 'outbox handler failed');
    }
  }
  return { claimed: rows.length, ok, failed };
}

module.exports = { enqueue, processBatch, registerHandler, MAX_ATTEMPTS, BACKOFF_MINUTES };
