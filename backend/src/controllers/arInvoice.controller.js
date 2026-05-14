const svc = require('../services/arInvoice.service');
const billing = require('../services/arBilling.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listInvoices({
    customerId: req.query.customerId,
    status: req.query.status,
    invoiceType: req.query.invoiceType,
    salesOrderId: req.query.salesOrderId,
    shipmentId: req.query.shipmentId,
    search: req.query.search,
    dueBefore: req.query.dueBefore,
    dueAfter: req.query.dueAfter,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

const kpis = wrap(async (_req, res) => {
  res.json(await svc.getKpis());
});

const getById = wrap(async (req, res) => {
  res.json(await svc.getInvoiceById(req.params.id));
});

const create = wrap(async (req, res) => {
  const inv = await svc.createInvoice(req.body, req.user, req.ip);
  res.status(201).json(inv);
});

const voidInv = wrap(async (req, res) => {
  res.json(await svc.voidInvoice(req.params.id, req.body || {}, req.user, req.ip));
});

const generateFromShipment = wrap(async (req, res) => {
  const { shipmentId } = req.body || {};
  const result = await billing.generateFromShipment(shipmentId, req.user, req.ip);
  res.status(result.created ? 201 : 200).json(result);
});

module.exports = { list, kpis, getById, create, void: voidInv, generateFromShipment };
