const svc = require('../services/arCreditNote.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listCreditNotes({
    customerId: req.query.customerId,
    limit: req.query.limit,
    offset: req.query.offset,
  }));
});

const create = wrap(async (req, res) => {
  const cn = await svc.createCreditNote(req.body, req.user, req.ip);
  res.status(201).json(cn);
});

module.exports = { list, create };
