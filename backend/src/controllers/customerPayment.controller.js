const svc = require('../services/customerPayment.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listPayments({
    customerId: req.query.customerId,
    status: req.query.status,
    method: req.query.method,
    search: req.query.search,
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

const getById = wrap(async (req, res) => {
  res.json(await svc.getPaymentById(req.params.id));
});

const create = wrap(async (req, res) => {
  const p = await svc.recordPayment(req.body, req.user, req.ip);
  res.status(201).json(p);
});

const voidPay = wrap(async (req, res) => {
  res.json(await svc.voidPayment(req.params.id, req.body || {}, req.user, req.ip));
});

module.exports = { list, getById, create, void: voidPay };
