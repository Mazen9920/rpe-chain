const svc = require('../services/shipment.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listShipments(req.query));
});

const getById = wrap(async (req, res) => {
  res.json(await svc.getShipmentById(req.params.id));
});

const deliver = wrap(async (req, res) => {
  res.json(await svc.markDelivered(req.params.id, req.body || {}, req.user, req.ip));
});

const voidShipment = wrap(async (req, res) => {
  res.json(await svc.voidShipment(req.params.id, req.body || {}, req.user, req.ip));
});

module.exports = { list, getById, deliver, void: voidShipment };
