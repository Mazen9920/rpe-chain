// GL Export controller (Tier 4 #17 — v1.7.0).
const gl = require('../services/gl.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

function sendErr(res, err) {
  const map = { VALIDATION: 400, NOT_FOUND: 404, ACCOUNT_IN_USE: 409 };
  const status = map[err.code] || 500;
  return res.status(status).json({ error: err.code || 'INTERNAL', message: err.message });
}

// Accounts
const listAccounts = wrap(async (req, res) => {
  const items = await gl.listAccounts({
    type: req.query.type,
    isActive: req.query.isActive == null ? undefined : req.query.isActive === 'true',
  });
  res.json({ items });
});

const createAccount = wrap(async (req, res) => {
  try {
    const a = await gl.createAccount(req.body || {});
    res.status(201).json(a);
  } catch (e) { return sendErr(res, e); }
});

const updateAccount = wrap(async (req, res) => {
  try {
    const a = await gl.updateAccount(req.params.id, req.body || {});
    res.json(a);
  } catch (e) { return sendErr(res, e); }
});

const deleteAccount = wrap(async (req, res) => {
  try {
    await gl.deleteAccount(req.params.id);
    res.status(204).end();
  } catch (e) { return sendErr(res, e); }
});

// Mappings
const listMappings = wrap(async (_req, res) => {
  const items = await gl.listMappings();
  res.json({ items, validEventTypes: gl.VALID_EVENT_TYPES });
});

const upsertMapping = wrap(async (req, res) => {
  try {
    const m = await gl.upsertMapping(req.body || {});
    res.json(m);
  } catch (e) { return sendErr(res, e); }
});

const deleteMapping = wrap(async (req, res) => {
  await gl.deleteMapping(req.params.eventType);
  res.status(204).end();
});

// Journals
const generate = wrap(async (req, res) => {
  try {
    const { from, to } = req.body || {};
    const out = await gl.generateForRange({ from, to });
    res.json({
      createdCount: out.created.length,
      skippedCount: out.skipped.length,
      errors: out.errors,
      created: out.created.map((j) => ({ id: j.id, journalNumber: j.journalNumber, totalAmount: j.totalAmount })),
    });
  } catch (e) { return sendErr(res, e); }
});

const listJournals = wrap(async (req, res) => {
  const out = await gl.listJournals(req.query);
  res.json(out);
});

const getJournal = wrap(async (req, res) => {
  const j = await gl.getJournal(req.params.id);
  if (!j) return res.status(404).json({ error: 'NOT_FOUND' });
  res.json(j);
});

const exportCsv = wrap(async (req, res) => {
  const csv = await gl.exportCsv(req.query);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gl-journals.csv"');
  res.send(csv);
});

const pushJournal = wrap(async (req, res) => {
  try {
    const out = await gl.pushJournal(req.params.id, req.params.provider);
    res.json(out);
  } catch (e) { return sendErr(res, e); }
});

module.exports = {
  listAccounts, createAccount, updateAccount, deleteAccount,
  listMappings, upsertMapping, deleteMapping,
  generate, listJournals, getJournal, exportCsv, pushJournal,
};
