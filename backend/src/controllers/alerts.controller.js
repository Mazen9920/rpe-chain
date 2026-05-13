const svc = require('../services/alerts.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listAlerts({
    status: req.query.status,
    type: req.query.type,
    severity: req.query.severity,
    role: req.user?.role,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

const acknowledge = wrap(async (req, res) => {
  const updated = await svc.acknowledgeAlert(req.params.id, req.user?.id);
  if (!updated) return res.status(404).json({ error: 'Alert not found' });
  res.json(updated);
});

const snooze = wrap(async (req, res) => {
  if (!req.body?.snoozedUntil) return res.status(400).json({ error: 'snoozedUntil required' });
  res.json(await svc.snoozeAlert(req.params.id, req.body.snoozedUntil));
});

const resolve = wrap(async (req, res) => {
  res.json(await svc.resolveAlert(req.params.id, req.user?.id));
});

const scanAll = wrap(async (req, res) => {
  res.json(await svc.runAllScans({ actorId: req.user?.id, sourceIp: req.ip }));
});

module.exports = { list, acknowledge, snooze, resolve, scanAll };
