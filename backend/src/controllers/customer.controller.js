const svc = require('../services/customer.service');

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

const list = wrap(async (req, res) => {
  res.json(await svc.listCustomers(req.query));
});

const getById = wrap(async (req, res) => {
  res.json(await svc.getCustomerById(req.params.id));
});

const create = wrap(async (req, res) => {
  const customer = await svc.createCustomer(req.body || {}, req.user, req.ip);
  res.status(201).json(customer);
});

const update = wrap(async (req, res) => {
  res.json(await svc.updateCustomer(req.params.id, req.body || {}, req.user, req.ip));
});

const deactivate = wrap(async (req, res) => {
  await svc.deactivateCustomer(req.params.id, req.user, req.ip);
  res.status(204).end();
});

const addContact = wrap(async (req, res) => {
  const c = await svc.addContact(req.params.id, req.body || {}, req.user, req.ip);
  res.status(201).json(c);
});

const updateContact = wrap(async (req, res) => {
  res.json(await svc.updateContact(req.params.id, req.params.contactId, req.body || {}, req.user, req.ip));
});

const setPrimary = wrap(async (req, res) => {
  res.json(await svc.setPrimaryContact(req.params.id, req.params.contactId, req.user, req.ip));
});

const deleteContact = wrap(async (req, res) => {
  await svc.deleteContact(req.params.id, req.params.contactId, req.user, req.ip);
  res.status(204).end();
});

module.exports = {
  list, getById, create, update, deactivate,
  addContact, updateContact, setPrimary, deleteContact,
};
