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

const getLabel = wrap(async (req, res) => {
  const prisma = require('../lib/prisma');
  const storage = require('../lib/storage');
  const shipment = await prisma.shipment.findUnique({ where: { id: req.params.id } });
  if (!shipment) return res.status(404).json({ error: 'Shipment not found' });
  if (!shipment.labelKey) return res.status(404).json({ error: 'No label available for this shipment' });
  const url = await storage.getSignedUrl(shipment.labelKey, 300);
  res.json({ url, key: shipment.labelKey, expiresIn: 300 });
});

module.exports = { list, getById, deliver, void: voidShipment, getLabel };
