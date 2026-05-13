const svc = require('../services/purchaseOrder.service');
const grnSvc = require('../services/goodsReceipt.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  const result = await svc.listPOs({
    status: req.query.status,
    supplierId: req.query.supplierId,
    warehouseId: req.query.warehouseId,
    search: req.query.search,
    dateFrom: req.query.dateFrom,
    dateTo: req.query.dateTo,
    limit: req.query.limit,
    offset: req.query.offset,
  });
  res.json(result);
});

const kpis = wrap(async (_req, res) => {
  res.json(await svc.getKpis());
});

const getById = wrap(async (req, res) => {
  const po = await svc.getPO(req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase order not found' });
  res.json(po);
});

const create = wrap(async (req, res) => {
  const po = await svc.createPO(req.body, req.user, req.ip);
  res.status(201).json(po);
});

const update = wrap(async (req, res) => {
  const po = await svc.updateDraft(req.params.id, req.body, req.user, req.ip);
  res.json(po);
});

const submit = wrap(async (req, res) => {
  res.json(await svc.submitForApproval(req.params.id, req.user, req.ip));
});

const approve = wrap(async (req, res) => {
  res.json(await svc.approvePO(req.params.id, req.user, req.ip));
});

const send = wrap(async (req, res) => {
  res.json(await svc.sendPO(req.params.id, req.user, req.ip));
});

const cancel = wrap(async (req, res) => {
  res.json(await svc.cancelPO(req.params.id, req.body?.reason, req.user, req.ip));
});

const close = wrap(async (req, res) => {
  res.json(await svc.closePO(req.params.id, req.user, req.ip));
});

const activity = wrap(async (req, res) => {
  res.json(await svc.listActivity(req.params.id, { limit: req.query.limit }));
});

const receive = wrap(async (req, res) => {
  const receipt = await grnSvc.receiveAgainstPO(
    {
      poId: req.params.id,
      warehouseId: req.body.warehouseId,
      fxRate: req.body.fxRate,
      notes: req.body.notes,
      lines: req.body.lines,
    },
    req.user,
    req.ip
  );
  res.status(201).json(receipt);
});

module.exports = { list, kpis, getById, create, update, submit, approve, send, cancel, close, activity, receive };
