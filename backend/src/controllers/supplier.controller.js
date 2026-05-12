const prisma = require('../lib/prisma');

async function list(_req, res) {
  const suppliers = await prisma.supplier.findMany({
    where: { deletedAt: null },
    orderBy: { name: 'asc' },
  });
  res.json(suppliers);
}

async function getById(req, res) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: req.params.id },
    include: {
      supplierProducts: { include: { product: { select: { id: true, sku: true, name: true } } } },
      purchaseOrders: { orderBy: { createdAt: 'desc' }, take: 10 },
      performance: { orderBy: { periodStart: 'desc' }, take: 12 },
    },
  });
  if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
  res.json(supplier);
}

async function create(req, res) {
  const supplier = await prisma.supplier.create({ data: req.body });
  res.status(201).json(supplier);
}

async function update(req, res) {
  const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });
  res.json(supplier);
}

async function remove(req, res) {
  await prisma.supplier.update({
    where: { id: req.params.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  res.status(204).send();
}

module.exports = { list, getById, create, update, remove };
