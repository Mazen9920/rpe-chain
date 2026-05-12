const prisma = require('../lib/prisma');
const auditService = require('../services/audit.service');

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
  await auditService.logEvent({
    eventType: 'SUPPLIER_CREATED',
    entityType: 'Supplier',
    entityId: supplier.id,
    actorId: req.user?.id,
    payload: { name: supplier.name },
    sourceIp: req.ip,
  });
  res.status(201).json(supplier);
}

async function update(req, res) {
  const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });
  await auditService.logEvent({
    eventType: 'SUPPLIER_UPDATED',
    entityType: 'Supplier',
    entityId: supplier.id,
    actorId: req.user?.id,
    payload: req.body,
    sourceIp: req.ip,
  });
  res.json(supplier);
}

async function remove(req, res) {
  await prisma.supplier.update({
    where: { id: req.params.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await auditService.logEvent({
    eventType: 'SUPPLIER_DELETED',
    entityType: 'Supplier',
    entityId: req.params.id,
    actorId: req.user?.id,
    sourceIp: req.ip,
  });
  res.status(204).send();
}

async function recordPerformance(req, res) {
  const supplier = await prisma.supplier.findUnique({
    where: { id: req.params.id },
  });
  if (!supplier || supplier.deletedAt) {
    return res.status(404).json({ error: 'Supplier not found' });
  }

  const { periodStart, periodEnd, onTimeRate, fillRate, defectRate, leadTimeMean, leadTimeStd } = req.body;

  const record = await prisma.supplierPerformance.upsert({
    where: { supplierId_periodStart: { supplierId: req.params.id, periodStart: new Date(periodStart) } },
    update: { periodEnd: new Date(periodEnd), onTimeRate, fillRate, defectRate, leadTimeMean, leadTimeStd },
    create: {
      supplierId: req.params.id,
      periodStart: new Date(periodStart),
      periodEnd: new Date(periodEnd),
      onTimeRate,
      fillRate,
      defectRate,
      leadTimeMean,
      leadTimeStd,
    },
  });

  await auditService.logEvent({
    eventType: 'SUPPLIER_PERFORMANCE_RECORDED',
    entityType: 'SupplierPerformance',
    entityId: record.id,
    actorId: req.user?.id,
    payload: { supplierId: req.params.id, periodStart, periodEnd },
    sourceIp: req.ip,
  });

  res.status(201).json(record);
}

async function getPerformance(req, res) {
  const { limit = 12, offset = 0 } = req.query;
  const records = await prisma.supplierPerformance.findMany({
    where: { supplierId: req.params.id },
    orderBy: { periodStart: 'desc' },
    take: Number(limit),
    skip: Number(offset),
  });
  res.json(records);
}

module.exports = { list, getById, create, update, remove, recordPerformance, getPerformance };
