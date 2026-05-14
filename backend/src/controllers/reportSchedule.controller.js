// Tier 4 #15 — Report schedules controller.
const schedules = require('../services/reportSchedule.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  const items = await schedules.list(req.user, {
    definitionId: req.query.definitionId,
  });
  res.json({ items });
});

const get = wrap(async (req, res) => {
  const sched = await schedules.get(req.user, req.params.id);
  res.json(sched);
});

const create = wrap(async (req, res) => {
  const sched = await schedules.create(req.user, req.body || {});
  res.status(201).json(sched);
});

const update = wrap(async (req, res) => {
  const sched = await schedules.update(req.user, req.params.id, req.body || {});
  res.json(sched);
});

const remove = wrap(async (req, res) => {
  await schedules.remove(req.user, req.params.id);
  res.status(204).end();
});

const runNow = wrap(async (req, res) => {
  const row = await schedules.runNow(req.user, req.params.id);
  res.status(202).json({ outboxId: row.id, status: row.status });
});

module.exports = { list, get, create, update, remove, runNow };
