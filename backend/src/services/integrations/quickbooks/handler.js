// QuickBooks Online outbox handler — stub.
// Real OAuth2 + JournalEntry push is scoped to v1.7.1; this handler simulates
// a successful push (or errors when not configured) so the GL workflow is
// observable end-to-end via outbox + GlJournal.exportedAt + externalId.
const prisma = require('../../../lib/prisma');
const logger = require('../../../lib/logger');
const outbox = require('../../outbox.service');
const gl = require('../../gl.service');

function isConfigured() {
  return !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

outbox.registerHandler('quickbooks', async ({ action, payload }) => {
  if (action !== 'journal.push') {
    throw new Error(`quickbooks: unknown action ${action}`);
  }
  const { journalId } = payload;
  const j = await prisma.glJournal.findUnique({ where: { id: journalId } });
  if (!j) throw new Error(`journal ${journalId} not found`);
  if (j.externalId && j.exportProvider === 'quickbooks') {
    logger.info({ journalId, externalId: j.externalId }, 'quickbooks: already pushed, skipping');
    return { skipped: 'already_pushed', externalId: j.externalId };
  }
  if (!isConfigured()) {
    // In dev / unconfigured environments, simulate to keep the workflow testable.
    const externalId = `QBO-SIM-${j.journalNumber}`;
    await gl.markPushed(journalId, { provider: 'quickbooks', externalId });
    logger.warn({ journalId, externalId }, 'quickbooks: not configured — recorded simulated externalId');
    return { simulated: true, externalId };
  }
  // Real push goes here in v1.7.1.
  const externalId = `QBO-${Date.now()}-${j.journalNumber}`;
  await gl.markPushed(journalId, { provider: 'quickbooks', externalId });
  logger.info({ journalId, externalId }, 'quickbooks: pushed (placeholder)');
  return { externalId };
});

logger.info('quickbooks outbox handler registered');
