const svc = require('../services/arAging.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const aging = wrap(async (req, res) => {
  res.json(await svc.aging({
    asOf: req.query.asOf,
    customerId: req.query.customerId,
    reportingCurrency: req.query.reportingCurrency,
  }));
});

const summary = wrap(async (req, res) => {
  res.json(await svc.agingSummary({
    asOf: req.query.asOf,
    reportingCurrency: req.query.reportingCurrency,
  }));
});

const statement = wrap(async (req, res) => {
  res.json(await svc.customerStatement(req.params.customerId, req.query.asOf));
});

module.exports = { aging, summary, statement };
