const svc = require('../services/apAging.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const aging = wrap(async (req, res) => {
  res.json(await svc.aging({ supplierId: req.query.supplierId, asOf: req.query.asOf }));
});

const summary = wrap(async (req, res) => {
  res.json(await svc.agingSummary({ supplierId: req.query.supplierId, asOf: req.query.asOf }));
});

const statement = wrap(async (req, res) => {
  res.json(await svc.supplierStatement(req.params.supplierId, req.query.asOf));
});

module.exports = { aging, summary, statement };
