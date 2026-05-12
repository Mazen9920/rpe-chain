/**
 * Append-only event log writer.
 * Per master plan Section 12 Principle 01: every state-changing action is logged.
 */
const prisma = require('../lib/prisma');

async function logEvent({ eventType, entityType, entityId, actorId, payload, sourceIp }, tx = prisma) {
  return tx.eventLog.create({
    data: {
      eventType,
      entityType,
      entityId,
      actorId,
      payload: payload || null,
      sourceIp,
    },
  });
}

module.exports = { logEvent };
