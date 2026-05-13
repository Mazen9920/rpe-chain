const svc = require('../services/payment.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listPayments({
    supplierId: req.query.supplierId,
    method: req.query.method,
    status: req.query.status,
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
  const payment = await svc.recordPayment(req.body, req.user, req.ip);
  res.status(201).json(payment);
});

const voidPayment = wrap(async (req, res) => {
  res.json(await svc.voidPayment(req.params.id, req.body || {}, req.user, req.ip));
});

module.exports = { list, getById, create, void: voidPayment };
