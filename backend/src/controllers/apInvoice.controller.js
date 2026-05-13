const svc = require('../services/apInvoice.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listInvoices({
    supplierId: req.query.supplierId,
    status: req.query.status,
    invoiceType: req.query.invoiceType,
    purchaseOrderId: req.query.purchaseOrderId,
    search: req.query.search,
    fromDate: req.query.fromDate,
    toDate: req.query.toDate,
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

const submit = wrap(async (req, res) => {
  res.json(await svc.submitForMatching(req.params.id, req.user, req.ip));
});

const rematch = wrap(async (req, res) => {
  res.json(await svc.rematch(req.params.id, req.user, req.ip));
});

const approve = wrap(async (req, res) => {
  res.json(await svc.approveInvoice(req.params.id, req.body || {}, req.user, req.ip));
});

const voidInv = wrap(async (req, res) => {
  res.json(await svc.voidInvoice(req.params.id, req.body || {}, req.user, req.ip));
});

module.exports = { list, kpis, getById, create, submit, rematch, approve, void: voidInv };
