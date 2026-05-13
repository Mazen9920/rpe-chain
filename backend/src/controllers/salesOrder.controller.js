const svc = require('../services/salesOrder.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listSalesOrders(req.query));
});

const kpis = wrap(async (req, res) => {
  res.json(await svc.kpis());
});

const getById = wrap(async (req, res) => {
  res.json(await svc.getSalesOrderById(req.params.id));
});

const create = wrap(async (req, res) => {
  const so = await svc.createSalesOrder(req.body || {}, req.user, req.ip);
  res.status(201).json(so);
});

const update = wrap(async (req, res) => {
  res.json(await svc.updateSalesOrder(req.params.id, req.body || {}, req.user, req.ip));
});

const confirm = wrap(async (req, res) => {
  res.json(await svc.confirmOrder(req.params.id, req.user, req.ip));
});

const allocate = wrap(async (req, res) => {
  res.json(await svc.allocateOrder(req.params.id, req.user, req.ip));
});

const pick = wrap(async (req, res) => {
  res.json(await svc.pickOrder(req.params.id, req.body || {}, req.user, req.ip));
});

const pack = wrap(async (req, res) => {
  res.json(await svc.packOrder(req.params.id, req.user, req.ip));
});

const ship = wrap(async (req, res) => {
  res.json(await svc.shipOrder(req.params.id, req.body || {}, req.user, req.ip));
});

const cancel = wrap(async (req, res) => {
  res.json(await svc.cancelOrder(req.params.id, req.body || {}, req.user, req.ip));
});

module.exports = { list, kpis, getById, create, update, confirm, allocate, pick, pack, ship, cancel };
