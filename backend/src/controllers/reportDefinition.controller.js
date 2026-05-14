// Tier 4 #15 — Saved report definitions controller.
const definitions = require('../services/reportDefinition.service');
const reports = require('../services/reports.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const listAvailable = wrap(async (_req, res) => {
  res.json({ reportKeys: reports.listReportKeys() });
});

const list = wrap(async (req, res) => {
  const items = await definitions.list(req.user, {
    reportKey: req.query.reportKey,
  });
  res.json({ items });
});

const get = wrap(async (req, res) => {
  const def = await definitions.get(req.user, req.params.id);
  res.json(def);
});

const create = wrap(async (req, res) => {
  const def = await definitions.create(req.user, req.body || {});
  res.status(201).json(def);
});

const update = wrap(async (req, res) => {
  const def = await definitions.update(req.user, req.params.id, req.body || {});
  res.json(def);
});

const remove = wrap(async (req, res) => {
  await definitions.remove(req.user, req.params.id);
  res.status(204).end();
});

module.exports = { listAvailable, list, get, create, update, remove };
