// Xero outbox handler — stub.
// Real OAuth2 + ManualJournal push is scoped to v1.7.1.
const prisma = require('../../../lib/prisma');
const logger = require('../../../lib/logger');
const outbox = require('../../outbox.service');
const gl = require('../../gl.service');

function isConfigured() {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

outbox.registerHandler('xero', async ({ action, payload }) => {
  if (action !== 'journal.push') {
    throw new Error(`xero: unknown action ${action}`);
  }
  const { journalId } = payload;
  const j = await prisma.glJournal.findUnique({ where: { id: journalId } });
  if (!j) throw new Error(`journal ${journalId} not found`);
  if (j.externalId && j.exportProvider === 'xero') {
    logger.info({ journalId, externalId: j.externalId }, 'xero: already pushed, skipping');
    return { skipped: 'already_pushed', externalId: j.externalId };
  }
  if (!isConfigured()) {
    const externalId = `XERO-SIM-${j.journalNumber}`;
    await gl.markPushed(journalId, { provider: 'xero', externalId });
    logger.warn({ journalId, externalId }, 'xero: not configured — recorded simulated externalId');
    return { simulated: true, externalId };
  }
  const externalId = `XERO-${Date.now()}-${j.journalNumber}`;
  await gl.markPushed(journalId, { provider: 'xero', externalId });
  logger.info({ journalId, externalId }, 'xero: pushed (placeholder)');
  return { externalId };
});

logger.info('xero outbox handler registered');
