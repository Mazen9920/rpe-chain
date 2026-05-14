const svc = require('../services/customerReturn.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listReturns({
    customerId: req.query.customerId,
    status: req.query.status,
    customerInvoiceId: req.query.customerInvoiceId,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

const get = wrap(async (req, res) => {
  res.json(await svc.getReturn(req.params.id));
});

const create = wrap(async (req, res) => {
  const cr = await svc.createReturn(req.body, req.user, req.ip);
  res.status(201).json(cr);
});

const approve = wrap(async (req, res) => {
  res.json(await svc.approveReturn(req.params.id, req.user, req.ip));
});

const reject = wrap(async (req, res) => {
  res.json(await svc.rejectReturn(req.params.id, req.body || {}, req.user, req.ip));
});

const receive = wrap(async (req, res) => {
  res.json(await svc.receiveReturn(req.params.id, req.user, req.ip));
});

const refund = wrap(async (req, res) => {
  res.json(await svc.refundReturn(req.params.id, req.user, req.ip));
});

module.exports = { list, get, create, approve, reject, receive, refund };
