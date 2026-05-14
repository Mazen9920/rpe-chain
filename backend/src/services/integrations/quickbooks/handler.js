// QuickBooks Online outbox handler — v1.7.1.
// Action `journal.push` performs an OAuth2-authenticated POST to the QBO
// JournalEntry endpoint. If the integration is not configured the handler
// falls back to a simulated externalId so dev workflows stay testable.
const prisma = require('../../../lib/prisma');
const logger = require('../../../lib/logger');
const outbox = require('../../outbox.service');
const gl = require('../../gl.service');
const oauth = require('../oauth.service');
const httpClient = require('../httpClient');

const MINOR_VERSION = '65';

function isConfigured() {
  return !!(process.env.QUICKBOOKS_CLIENT_ID && process.env.QUICKBOOKS_CLIENT_SECRET);
}

function buildJournalEntry(journal, accountMap) {
  const lines = [];
  for (const ln of journal.lines) {
    const code = ln.account.code;
    const qboId = accountMap[code];
    const accRef = { value: qboId ? String(qboId) : '0', name: ln.account.name };
    const amount = Number(ln.debit) > 0 ? Number(ln.debit) : Number(ln.credit);
    const postingType = Number(ln.debit) > 0 ? 'Debit' : 'Credit';
    lines.push({
      DetailType: 'JournalEntryLineDetail',
      Amount: amount,
      Description: ln.description || journal.description || journal.journalNumber,
      JournalEntryLineDetail: {
        PostingType: postingType,
        AccountRef: accRef,
      },
    });
  }
  return {
    DocNumber: journal.journalNumber,
    TxnDate: journal.postedAt.toISOString().slice(0, 10),
    PrivateNote: journal.description || `${journal.sourceLedger} ${journal.sourceEntryType}`,
    CurrencyRef: { value: journal.currency },
    Line: lines,
  };
}

async function pushToQbo(journal) {
  const token = await oauth.getValidAccessToken('quickbooks');
  if (!token.realmId) {
    const e = new Error('quickbooks: missing realmId on credential');
    e.code = 'INTEGRATION_DISCONNECTED';
    throw e;
  }
  const accountMap = (token.meta && token.meta.accountMap) || {};
  const body = buildJournalEntry(journal, accountMap);
  const url = `${token.apiBase}/v3/company/${encodeURIComponent(token.realmId)}/journalentry?minorversion=${MINOR_VERSION}`;
  const doPost = (accessToken) => httpClient.post(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
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
      logger.info({ journalId: journal.id }, 'quickbooks: 401, refreshing token');
      const cred = await prisma.glIntegrationCredential.findUnique({ where: { provider: 'quickbooks' } });
      await oauth.refreshToken('quickbooks', cred);
      const t2 = await oauth.getValidAccessToken('quickbooks');
      response = await doPost(t2.accessToken);
    } else {
      throw err;
    }
  }
  const externalId = response && response.JournalEntry && response.JournalEntry.Id;
  if (!externalId) {
    throw new Error('quickbooks: response missing JournalEntry.Id');
  }
  return String(externalId);
}

outbox.registerHandler('quickbooks', async ({ action, payload }) => {
  if (action !== 'journal.push') {
    throw new Error(`quickbooks: unknown action ${action}`);
  }
  const { journalId } = payload;
  const j = await prisma.glJournal.findUnique({
    where: { id: journalId },
    include: { lines: { include: { account: true } } },
  });
  if (!j) throw new Error(`journal ${journalId} not found`);
  if (j.externalId && j.exportProvider === 'quickbooks') {
    logger.info({ journalId, externalId: j.externalId }, 'quickbooks: already pushed, skipping');
    return { skipped: 'already_pushed', externalId: j.externalId };
  }
  if (!isConfigured()) {
    const externalId = `QBO-SIM-${j.journalNumber}`;
    await gl.markPushed(journalId, { provider: 'quickbooks', externalId });
    logger.warn({ journalId, externalId }, 'quickbooks: not configured — recorded simulated externalId');
    return { simulated: true, externalId };
  }
  const externalId = await pushToQbo(j);
  await gl.markPushed(journalId, { provider: 'quickbooks', externalId });
  logger.info({ journalId, externalId }, 'quickbooks: pushed');
  return { externalId };
});

logger.info('quickbooks outbox handler registered');
