// GL Export service (Tier 4 #17 — v1.7.0).
// Generates GL journals from AP + AR ledger entries via account mappings.
const prisma = require('../lib/prisma');
const logger = require('../lib/logger');
const outbox = require('./outbox.service');

// ──────────── Accounts ────────────

async function listAccounts(filters = {}) {
  const where = {};
  if (filters.type) where.type = filters.type;
  if (filters.isActive != null) where.isActive = !!filters.isActive;
  return prisma.glAccount.findMany({ where, orderBy: { code: 'asc' } });
}

async function createAccount(data) {
  if (!data.code || !data.name || !data.type) {
    const e = new Error('code, name, and type are required');
    e.code = 'VALIDATION';
    throw e;
  }
  return prisma.glAccount.create({
    data: {
      code: data.code,
      name: data.name,
      type: data.type,
      parentId: data.parentId ?? null,
      description: data.description ?? null,
      isActive: data.isActive ?? true,
    },
  });
}

async function updateAccount(id, data) {
  return prisma.glAccount.update({
    where: { id },
    data: {
      name: data.name ?? undefined,
      type: data.type ?? undefined,
      parentId: data.parentId ?? undefined,
      description: data.description ?? undefined,
      isActive: data.isActive ?? undefined,
    },
  });
}

async function deleteAccount(id) {
  // Cannot delete if referenced by mapping or journal line
  const refs = await prisma.glJournalLine.count({ where: { accountId: id } });
  if (refs > 0) {
    const e = new Error('Account is referenced by journal lines');
    e.code = 'ACCOUNT_IN_USE';
    throw e;
  }
  const mapRefs = await prisma.glAccountMapping.count({
    where: { OR: [{ debitAccountId: id }, { creditAccountId: id }] },
  });
  if (mapRefs > 0) {
    const e = new Error('Account is referenced by mappings');
    e.code = 'ACCOUNT_IN_USE';
    throw e;
  }
  return prisma.glAccount.delete({ where: { id } });
}

// ──────────── Mappings ────────────

const VALID_EVENT_TYPES = [
  'AP_INVOICE_POSTED',
  'AP_PAYMENT_APPLIED',
  'AP_CREDIT_NOTE',
  'AP_INVOICE_VOIDED',
  'AP_PAYMENT_VOIDED',
  'AR_INVOICE_POSTED',
  'AR_PAYMENT_RECEIVED',
  'AR_CREDIT_NOTE',
  'AR_INVOICE_VOIDED',
  'AR_PAYMENT_VOIDED',
];

async function listMappings() {
  return prisma.glAccountMapping.findMany({
    include: { debitAccount: true, creditAccount: true },
    orderBy: { eventType: 'asc' },
  });
}

async function upsertMapping(data) {
  if (!data.eventType || !VALID_EVENT_TYPES.includes(data.eventType)) {
    const e = new Error(`Invalid eventType. Allowed: ${VALID_EVENT_TYPES.join(', ')}`);
    e.code = 'VALIDATION';
    throw e;
  }
  if (!data.debitAccountId || !data.creditAccountId) {
    const e = new Error('debitAccountId and creditAccountId are required');
    e.code = 'VALIDATION';
    throw e;
  }
  return prisma.glAccountMapping.upsert({
    where: { eventType: data.eventType },
    create: {
      eventType: data.eventType,
      debitAccountId: data.debitAccountId,
      creditAccountId: data.creditAccountId,
      description: data.description ?? null,
      isActive: data.isActive ?? true,
    },
    update: {
      debitAccountId: data.debitAccountId,
      creditAccountId: data.creditAccountId,
      description: data.description ?? undefined,
      isActive: data.isActive ?? undefined,
    },
    include: { debitAccount: true, creditAccount: true },
  });
}

async function deleteMapping(eventType) {
  return prisma.glAccountMapping.delete({ where: { eventType } });
}

// ──────────── Journal number ────────────

async function nextJournalNumber(tx, postedAt) {
  const d = new Date(postedAt);
  const ym = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const prefix = `GL-${ym}-`;
  const last = await tx.glJournal.findFirst({
    where: { journalNumber: { startsWith: prefix } },
    orderBy: { journalNumber: 'desc' },
    select: { journalNumber: true },
  });
  let n = 1;
  if (last) {
    const m = /-(\d+)$/.exec(last.journalNumber);
    if (m) n = parseInt(m[1], 10) + 1;
  }
  return `${prefix}${String(n).padStart(4, '0')}`;
}

// ──────────── Journal generation ────────────

async function generateForRange({ from, to }) {
  if (!from || !to) {
    const e = new Error('from and to (ISO dates) required');
    e.code = 'VALIDATION';
    throw e;
  }
  const fromD = new Date(from);
  const toD = new Date(to);

  // Load mappings as a lookup
  const mappings = await prisma.glAccountMapping.findMany({ where: { isActive: true } });
  const mapByEvent = new Map(mappings.map((m) => [m.eventType, m]));

  // Pull AP + AR ledger entries in range that don't yet have a journal
  const existing = await prisma.glJournal.findMany({
    where: { postedAt: { gte: fromD, lte: toD } },
    select: { sourceLedger: true, sourceEntryId: true },
  });
  const existingKeys = new Set(existing.map((j) => `${j.sourceLedger}:${j.sourceEntryId}`));

  const apEntries = await prisma.apLedgerEntry.findMany({
    where: { createdAt: { gte: fromD, lte: toD } },
    include: { invoice: { select: { currency: true } } },
    orderBy: { createdAt: 'asc' },
  });
  const arEntries = await prisma.arLedgerEntry.findMany({
    where: { createdAt: { gte: fromD, lte: toD } },
    include: { invoice: { select: { currency: true } } },
    orderBy: { createdAt: 'asc' },
  });

  const created = [];
  const skipped = [];
  const errors = [];

  for (const e of apEntries) {
    if (existingKeys.has(`AP:${e.id}`)) {
      skipped.push({ ledger: 'AP', id: e.id, reason: 'already_exported' });
      continue;
    }
    const eventType = `AP_${e.entryType}`;
    const mapping = mapByEvent.get(eventType);
    if (!mapping) {
      errors.push({ ledger: 'AP', id: e.id, eventType, reason: 'MAPPING_REQUIRED' });
      continue;
    }
    const amount = Math.abs(Number(e.amount));
    if (amount === 0) {
      skipped.push({ ledger: 'AP', id: e.id, reason: 'zero_amount' });
      continue;
    }
    const j = await prisma.$transaction(async (tx) => {
      const number = await nextJournalNumber(tx, e.createdAt);
      return tx.glJournal.create({
        data: {
          journalNumber: number,
          sourceLedger: 'AP',
          sourceEntryId: e.id,
          sourceEntryType: e.entryType,
          postedAt: e.createdAt,
          currency: e.invoice?.currency || 'USD',
          totalAmount: amount,
          description: e.description || `${eventType} (${e.id.slice(0, 8)})`,
          lines: {
            create: [
              { accountId: mapping.debitAccountId, debit: amount, credit: 0, description: e.description },
              { accountId: mapping.creditAccountId, debit: 0, credit: amount, description: e.description },
            ],
          },
        },
        include: { lines: true },
      });
    });
    created.push(j);
  }

  for (const e of arEntries) {
    if (existingKeys.has(`AR:${e.id}`)) {
      skipped.push({ ledger: 'AR', id: e.id, reason: 'already_exported' });
      continue;
    }
    const eventType = `AR_${e.entryType}`;
    const mapping = mapByEvent.get(eventType);
    if (!mapping) {
      errors.push({ ledger: 'AR', id: e.id, eventType, reason: 'MAPPING_REQUIRED' });
      continue;
    }
    const amount = Math.abs(Number(e.amount));
    if (amount === 0) {
      skipped.push({ ledger: 'AR', id: e.id, reason: 'zero_amount' });
      continue;
    }
    const j = await prisma.$transaction(async (tx) => {
      const number = await nextJournalNumber(tx, e.createdAt);
      return tx.glJournal.create({
        data: {
          journalNumber: number,
          sourceLedger: 'AR',
          sourceEntryId: e.id,
          sourceEntryType: e.entryType,
          postedAt: e.createdAt,
          currency: e.invoice?.currency || 'USD',
          totalAmount: amount,
          description: e.description || `${eventType} (${e.id.slice(0, 8)})`,
          lines: {
            create: [
              { accountId: mapping.debitAccountId, debit: amount, credit: 0, description: e.description },
              { accountId: mapping.creditAccountId, debit: 0, credit: amount, description: e.description },
            ],
          },
        },
        include: { lines: true },
      });
    });
    created.push(j);
  }

  // Balance assertion across all journals in this batch.
  for (const j of created) {
    const debits = j.lines.reduce((s, l) => s + Number(l.debit), 0);
    const credits = j.lines.reduce((s, l) => s + Number(l.credit), 0);
    if (Math.abs(debits - credits) > 0.001) {
      logger.error({ journalId: j.id, debits, credits }, 'gl: unbalanced journal — this should not happen');
      throw new Error(`Journal ${j.journalNumber} unbalanced: D=${debits} C=${credits}`);
    }
  }

  logger.info({ created: created.length, skipped: skipped.length, errors: errors.length }, 'gl: generateForRange done');
  return { created, skipped, errors };
}

// ──────────── Journals: list / get / push / CSV ────────────

async function listJournals(filters = {}) {
  const where = {};
  if (filters.from || filters.to) {
    where.postedAt = {};
    if (filters.from) where.postedAt.gte = new Date(filters.from);
    if (filters.to) where.postedAt.lte = new Date(filters.to);
  }
  if (filters.exported === 'true' || filters.exported === true) where.exportedAt = { not: null };
  if (filters.exported === 'false' || filters.exported === false) where.exportedAt = null;
  if (filters.sourceLedger) where.sourceLedger = filters.sourceLedger;

  const limit = Math.min(parseInt(filters.limit, 10) || 50, 500);
  const offset = parseInt(filters.offset, 10) || 0;

  const [total, items] = await Promise.all([
    prisma.glJournal.count({ where }),
    prisma.glJournal.findMany({
      where,
      orderBy: { postedAt: 'desc' },
      take: limit,
      skip: offset,
      include: { lines: { include: { account: true } } },
    }),
  ]);
  return { total, items };
}

async function getJournal(id) {
  return prisma.glJournal.findUnique({
    where: { id },
    include: { lines: { include: { account: true } } },
  });
}

function escapeCsv(v) {
  const s = v == null ? '' : String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"`
    : s;
}

async function exportCsv(filters = {}) {
  const { items } = await listJournals({ ...filters, limit: 10000 });
  const headers = ['JournalNumber', 'PostedAt', 'SourceLedger', 'SourceEntryType', 'Currency', 'AccountCode', 'AccountName', 'Debit', 'Credit', 'Description'];
  const lines = [headers.join(',')];
  for (const j of items) {
    for (const l of j.lines) {
      lines.push([
        j.journalNumber,
        j.postedAt.toISOString(),
        j.sourceLedger,
        j.sourceEntryType,
        j.currency,
        l.account.code,
        l.account.name,
        Number(l.debit).toFixed(2),
        Number(l.credit).toFixed(2),
        l.description || j.description || '',
      ].map(escapeCsv).join(','));
    }
  }
  return lines.join('\n');
}

async function pushJournal(id, provider) {
  if (!['quickbooks', 'xero'].includes(provider)) {
    const e = new Error('Provider must be quickbooks or xero');
    e.code = 'VALIDATION';
    throw e;
  }
  const j = await prisma.glJournal.findUnique({ where: { id } });
  if (!j) {
    const e = new Error('Journal not found');
    e.code = 'NOT_FOUND';
    throw e;
  }
  // Enqueue outbox row — idempotency via journalId+provider in the handler.
  await outbox.enqueue({
    target: provider,
    action: 'journal.push',
    payload: { journalId: id },
    idempotencyKey: `gl:${provider}:${id}`,
  });
  return { enqueued: true, journalId: id, provider };
}

async function markPushed(id, { provider, externalId }) {
  return prisma.glJournal.update({
    where: { id },
    data: { exportedAt: new Date(), exportProvider: provider, externalId },
  });
}

module.exports = {
  // accounts
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  // mappings
  listMappings,
  upsertMapping,
  deleteMapping,
  VALID_EVENT_TYPES,
  // journals
  generateForRange,
  listJournals,
  getJournal,
  exportCsv,
  pushJournal,
  markPushed,
};
