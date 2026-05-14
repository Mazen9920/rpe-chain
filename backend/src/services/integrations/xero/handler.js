// Xero outbox handler — v1.7.1.
// Action `journal.push` posts to Xero's ManualJournals endpoint. Falls back
// to a simulated externalId when the integration is not configured.
const prisma = require('../../../lib/prisma');
const logger = require('../../../lib/logger');
const outbox = require('../../outbox.service');
const gl = require('../../gl.service');
const oauth = require('../oauth.service');
const httpClient = require('../httpClient');

function isConfigured() {
  return !!(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
}

function buildManualJournal(journal, accountMap) {
  const journalLines = [];
  for (const ln of journal.lines) {
    const code = ln.account.code;
    const xeroCode = accountMap[code] || code;
    const debit = Number(ln.debit);
    const credit = Number(ln.credit);
    const lineAmount = debit > 0 ? debit : -credit;
    journalLines.push({
      LineAmount: Number(lineAmount.toFixed(2)),
      AccountCode: xeroCode,
      Description: ln.description || journal.description || journal.journalNumber,
    });
  }
  return {
    ManualJournals: [{
      Narration: journal.description || `${journal.sourceLedger} ${journal.sourceEntryType} ${journal.journalNumber}`,
      Date: journal.postedAt.toISOString().slice(0, 10),
      Status: 'POSTED',
      LineAmountTypes: 'NoTax',
      JournalLines: journalLines,
    }],
  };
}

async function pushToXero(journal) {
  const token = await oauth.getValidAccessToken('xero');
  const tenantId = (token.meta && token.meta.tenantId) || token.realmId;
  if (!tenantId) {
    const e = new Error('xero: missing tenantId on credential');
    e.code = 'INTEGRATION_DISCONNECTED';
    throw e;
  }
  const accountMap = (token.meta && token.meta.accountMap) || {};
  const body = buildManualJournal(journal, accountMap);
  const url = `${token.apiBase}/api.xro/2.0/ManualJournals`;
  const doPost = (accessToken) => httpClient.post(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  let response;
  try {
    response = await doPost(token.accessToken);
  } catch (err) {
    if (err.status === 401) {
      logger.info({ journalId: journal.id }, 'xero: 401, refreshing token');
      const cred = await prisma.glIntegrationCredential.findUnique({ where: { provider: 'xero' } });
      await oauth.refreshToken('xero', cred);
      const t2 = await oauth.getValidAccessToken('xero');
      response = await doPost(t2.accessToken);
    } else {
      throw err;
    }
  }
  const journals = response && response.ManualJournals;
  const externalId = Array.isArray(journals) && journals[0] && journals[0].ManualJournalID;
  if (!externalId) {
    throw new Error('xero: response missing ManualJournalID');
  }
  return String(externalId);
}

outbox.registerHandler('xero', async ({ action, payload }) => {
  if (action !== 'journal.push') {
    throw new Error(`xero: unknown action ${action}`);
  }
  const { journalId } = payload;
  const j = await prisma.glJournal.findUnique({
    where: { id: journalId },
    include: { lines: { include: { account: true } } },
  });
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
  const externalId = await pushToXero(j);
  await gl.markPushed(journalId, { provider: 'xero', externalId });
  logger.info({ journalId, externalId }, 'xero: pushed');
  return { externalId };
});

logger.info('xero outbox handler registered');
