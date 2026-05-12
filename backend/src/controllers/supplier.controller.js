const prisma = require('../lib/prisma');
const auditService = require('../services/audit.service');

const VALID_RISK = ['LOW', 'MEDIUM', 'HIGH'];
const VALID_PAYMENT_TERMS = ['NET15', 'NET30', 'NET45', 'NET60', 'NET90', 'COD', 'PREPAID'];

function isRate(v) {
  return typeof v === 'number' && v >= 0 && v <= 1;
}

async function list(req, res) {
  const { search, country, currency, limit = 50, offset = 0 } = req.query;

  const where = { deletedAt: null };
  if (country) where.country = country;
  if (currency) where.currency = currency;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { code: { contains: search, mode: 'insensitive' } },
    ];
  }

  const take = Math.min(Number(limit) || 50, 200);
  const skip = Number(offset) || 0;

  const [data, total] = await Promise.all([
    prisma.supplier.findMany({ where, orderBy: { name: 'asc' }, take, skip }),
    prisma.supplier.count({ where }),
  ]);

  res.json({ data, total });
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
  if (!supplier || supplier.deletedAt) return res.status(404).json({ error: 'Supplier not found' });
  res.json(supplier);
}

async function create(req, res) {
  const { code, name, currency, paymentTerms, leadTimeDays, riskRating } = req.body;

  if (!code || typeof code !== 'string' || !code.trim()) {
    return res.status(400).json({ error: 'code is required' });
  }
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (paymentTerms && !VALID_PAYMENT_TERMS.includes(paymentTerms)) {
    return res.status(400).json({ error: `paymentTerms must be one of ${VALID_PAYMENT_TERMS.join(', ')}` });
  }
  if (riskRating && !VALID_RISK.includes(riskRating)) {
    return res.status(400).json({ error: `riskRating must be one of ${VALID_RISK.join(', ')}` });
  }
  if (leadTimeDays != null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 1)) {
    return res.status(400).json({ error: 'leadTimeDays must be a positive integer' });
  }
  if (currency && (typeof currency !== 'string' || currency.length !== 3)) {
    return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
  }

  try {
    const supplier = await prisma.supplier.create({ data: req.body });
    await auditService.logEvent({
      eventType: 'SUPPLIER_CREATED',
      entityType: 'Supplier',
      entityId: supplier.id,
      actorId: req.user?.id,
      payload: { code: supplier.code, name: supplier.name, country: supplier.country },
      sourceIp: req.ip,
    });
    res.status(201).json(supplier);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Supplier code already exists' });
    }
    throw err;
  }
}

async function update(req, res) {
  const before = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!before || before.deletedAt) return res.status(404).json({ error: 'Supplier not found' });

  const { paymentTerms, riskRating, leadTimeDays, currency } = req.body;
  if (paymentTerms && !VALID_PAYMENT_TERMS.includes(paymentTerms)) {
    return res.status(400).json({ error: `paymentTerms must be one of ${VALID_PAYMENT_TERMS.join(', ')}` });
  }
  if (riskRating && !VALID_RISK.includes(riskRating)) {
    return res.status(400).json({ error: `riskRating must be one of ${VALID_RISK.join(', ')}` });
  }
  if (leadTimeDays != null && (!Number.isInteger(leadTimeDays) || leadTimeDays < 1)) {
    return res.status(400).json({ error: 'leadTimeDays must be a positive integer' });
  }
  if (currency && (typeof currency !== 'string' || currency.length !== 3)) {
    return res.status(400).json({ error: 'currency must be a 3-letter ISO code' });
  }

  try {
    const supplier = await prisma.supplier.update({ where: { id: req.params.id }, data: req.body });

    // Build before/after diff for the changed fields only
    const diff = { before: {}, after: {} };
    for (const key of Object.keys(req.body)) {
      if (before[key] !== supplier[key]) {
        diff.before[key] = before[key];
        diff.after[key] = supplier[key];
      }
    }

    await auditService.logEvent({
      eventType: 'SUPPLIER_UPDATED',
      entityType: 'Supplier',
      entityId: supplier.id,
      actorId: req.user?.id,
      payload: diff,
      sourceIp: req.ip,
    });
    res.json(supplier);
  } catch (err) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'Supplier code already exists' });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Supplier not found' });
    }
    throw err;
  }
}

async function remove(req, res) {
  const existing = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!existing || existing.deletedAt) {
    return res.status(404).json({ error: 'Supplier not found' });
  }
  await prisma.supplier.update({
    where: { id: req.params.id },
    data: { isActive: false, deletedAt: new Date() },
  });
  await auditService.logEvent({
    eventType: 'SUPPLIER_DELETED',
    entityType: 'Supplier',
    entityId: req.params.id,
    actorId: req.user?.id,
    payload: { code: existing.code, name: existing.name },
    sourceIp: req.ip,
  });
  res.status(204).send();
}

async function recordPerformance(req, res) {
  const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } });
  if (!supplier || supplier.deletedAt) {
    return res.status(404).json({ error: 'Supplier not found' });
  }

  const { periodStart, periodEnd, onTimeRate, fillRate, defectRate, leadTimeMean, leadTimeStd } = req.body;

  if (!periodStart || !periodEnd) {
    return res.status(400).json({ error: 'periodStart and periodEnd are required' });
  }
  const ps = new Date(periodStart);
  const pe = new Date(periodEnd);
  if (isNaN(ps.getTime()) || isNaN(pe.getTime())) {
    return res.status(400).json({ error: 'periodStart and periodEnd must be valid dates' });
  }
  if (pe <= ps) {
    return res.status(400).json({ error: 'periodEnd must be after periodStart' });
  }
  for (const [k, v] of Object.entries({ onTimeRate, fillRate, defectRate })) {
    if (v != null && !isRate(v)) {
      return res.status(400).json({ error: `${k} must be a number between 0 and 1` });
    }
  }
  for (const [k, v] of Object.entries({ leadTimeMean, leadTimeStd })) {
    if (v != null && (typeof v !== 'number' || v < 0)) {
      return res.status(400).json({ error: `${k} must be a non-negative number` });
    }
  }

  const record = await prisma.supplierPerformance.upsert({
    where: { supplierId_periodStart: { supplierId: req.params.id, periodStart: ps } },
    update: { periodEnd: pe, onTimeRate, fillRate, defectRate, leadTimeMean, leadTimeStd },
    create: {
      supplierId: req.params.id,
      periodStart: ps,
      periodEnd: pe,
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
    payload: { supplierId: req.params.id, periodStart, periodEnd, onTimeRate, fillRate, defectRate },
    sourceIp: req.ip,
  });

  res.status(201).json(record);
}

async function getPerformance(req, res) {
  const { from, to, limit = 24, offset = 0 } = req.query;

  const where = { supplierId: req.params.id };
  if (from || to) {
    where.periodStart = {};
    if (from) {
      const d = new Date(from);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'from must be a valid date' });
      where.periodStart.gte = d;
    }
    if (to) {
      const d = new Date(to);
      if (isNaN(d.getTime())) return res.status(400).json({ error: 'to must be a valid date' });
      where.periodStart.lte = d;
    }
  }

  const records = await prisma.supplierPerformance.findMany({
    where,
    orderBy: { periodStart: 'desc' },
    take: Math.min(Number(limit) || 24, 200),
    skip: Number(offset) || 0,
  });
  res.json(records);
}

module.exports = { list, getById, create, update, remove, recordPerformance, getPerformance };
