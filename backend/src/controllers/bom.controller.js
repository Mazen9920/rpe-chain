/**
 * BOM controller — REST surface for Bills of Materials.
 *
 * Endpoints:
 *   GET    /api/boms                              ?productId&includeArchived
 *   GET    /api/boms/:id
 *   POST   /api/boms                              { productId, lines[], notes? }
 *   PUT    /api/boms/:id                          { lines[], notes? }    (drafts only)
 *   POST   /api/boms/:id/activate
 *   POST   /api/boms/:id/archive
 *   POST   /api/boms/:id/clone
 *   GET    /api/products/:productId/cost-rollup   ?mode=standard|fifo&warehouseId
 */
const prisma = require('../lib/prisma');
const bomService = require('../services/bom.service');
const { logEvent } = require('../services/audit.service');

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

const list = wrap(async (req, res) => {
  const { productId, includeArchived } = req.query;
  const where = {};
  if (productId) where.productId = productId;
  if (!includeArchived || includeArchived === 'false') where.archivedAt = null;

  const boms = await prisma.billOfMaterials.findMany({
    where,
    include: {
      product: { select: { id: true, sku: true, name: true } },
      _count: { select: { lines: true } },
    },
    orderBy: [{ productId: 'asc' }, { version: 'desc' }],
  });
  res.json(boms);
});

const get = wrap(async (req, res) => {
  const bom = await prisma.billOfMaterials.findUnique({
    where: { id: req.params.id },
    include: {
      product: { select: { id: true, sku: true, name: true, uom: true, type: true } },
      lines: {
        orderBy: { position: 'asc' },
        include: { componentProduct: { select: { id: true, sku: true, name: true, uom: true, type: true, isManufactured: true } } },
      },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!bom) return res.status(404).json({ error: 'BOM not found' });
  res.json(bom);
});

const createDraft = wrap(async (req, res) => {
  const { productId, notes, lines = [] } = req.body;
  if (!productId) return res.status(400).json({ error: 'productId is required' });
  if (!Array.isArray(lines) || lines.length === 0) {
    return res.status(400).json({ error: 'At least one line is required' });
  }

  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) return res.status(404).json({ error: 'Product not found' });

  for (const l of lines) {
    if (!l.componentProductId) return res.status(400).json({ error: 'componentProductId required' });
    if (l.componentProductId === productId) return res.status(400).json({ error: 'Component cannot equal parent product' });
    if (Number(l.qtyPer) <= 0) return res.status(400).json({ error: 'qtyPer must be > 0' });
  }

  const max = await prisma.billOfMaterials.aggregate({
    where: { productId },
    _max: { version: true },
  });
  const newVersion = (max._max.version || 0) + 1;

  const bom = await prisma.billOfMaterials.create({
    data: {
      productId,
      version: newVersion,
      isActive: false,
      notes: notes || null,
      createdById: req.user?.id || null,
      lines: {
        create: lines.map((l, i) => ({
          componentProductId: l.componentProductId,
          qtyPer: l.qtyPer,
          uom: l.uom || 'each',
          scrapFactorPct: l.scrapFactorPct || 0,
          position: l.position ?? i,
          notes: l.notes || null,
        })),
      },
    },
    include: { lines: true },
  });

  await logEvent({ eventType: 'BOM_CREATED', entityType: 'BillOfMaterials', entityId: bom.id, actorId: req.user?.id, payload: { productId, version: newVersion, lineCount: lines.length } });
  res.status(201).json(bom);
});

const updateDraft = wrap(async (req, res) => {
  const bom = await prisma.billOfMaterials.findUnique({ where: { id: req.params.id } });
  if (!bom) return res.status(404).json({ error: 'BOM not found' });
  if (bom.isActive) return res.status(400).json({ error: 'Cannot edit an active BOM. Clone it first.' });
  if (bom.archivedAt) return res.status(400).json({ error: 'Cannot edit an archived BOM' });

  const { notes, lines } = req.body;
  if (lines && (!Array.isArray(lines) || lines.length === 0)) {
    return res.status(400).json({ error: 'lines must be a non-empty array' });
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (lines) {
      await tx.bomLine.deleteMany({ where: { bomId: bom.id } });
      await tx.bomLine.createMany({
        data: lines.map((l, i) => ({
          bomId: bom.id,
          componentProductId: l.componentProductId,
          qtyPer: l.qtyPer,
          uom: l.uom || 'each',
          scrapFactorPct: l.scrapFactorPct || 0,
          position: l.position ?? i,
          notes: l.notes || null,
        })),
      });
    }
    return tx.billOfMaterials.update({
      where: { id: bom.id },
      data: { notes: notes ?? bom.notes },
      include: { lines: { orderBy: { position: 'asc' }, include: { componentProduct: true } } },
    });
  });

  await logEvent({ eventType: 'BOM_UPDATED', entityType: 'BillOfMaterials', entityId: bom.id, actorId: req.user?.id, payload: { lineCount: updated.lines.length } });
  res.json(updated);
});

const activate = wrap(async (req, res) => {
  try {
    const bom = await bomService.activateBom(req.params.id);
    await logEvent({ eventType: 'BOM_ACTIVATED', entityType: 'BillOfMaterials', entityId: bom.id, actorId: req.user?.id, payload: { productId: bom.productId, version: bom.version } });
    res.json(bom);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const archive = wrap(async (req, res) => {
  const bom = await prisma.billOfMaterials.findUnique({ where: { id: req.params.id } });
  if (!bom) return res.status(404).json({ error: 'BOM not found' });
  if (bom.archivedAt) return res.json(bom);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.billOfMaterials.update({
      where: { id: bom.id },
      data: { archivedAt: new Date(), isActive: false },
    });
    // If no remaining active BOM for this product, clear isManufactured.
    const stillActive = await tx.billOfMaterials.findFirst({
      where: { productId: bom.productId, isActive: true, archivedAt: null },
      select: { id: true },
    });
    if (!stillActive) {
      await tx.product.update({ where: { id: bom.productId }, data: { isManufactured: false } });
    }
    return u;
  });
  await logEvent({ eventType: 'BOM_ARCHIVED', entityType: 'BillOfMaterials', entityId: bom.id, actorId: req.user?.id });
  res.json(updated);
});

const clone = wrap(async (req, res) => {
  const cloned = await bomService.cloneBom(req.params.id, { createdById: req.user?.id });
  await logEvent({ eventType: 'BOM_CLONED', entityType: 'BillOfMaterials', entityId: cloned.id, actorId: req.user?.id, payload: { sourceBomId: req.params.id, version: cloned.version } });
  res.status(201).json(cloned);
});

const costRollup = wrap(async (req, res) => {
  const { productId } = req.params;
  const { mode = 'standard', warehouseId } = req.query;

  let tree;
  if (mode === 'fifo') {
    tree = await bomService.rollupFifoCost(productId, warehouseId || null);
  } else {
    tree = await bomService.rollupStandardCost(productId);
  }
  res.json({ mode, warehouseId: warehouseId || null, tree, totalUnitCost: tree.unitCost });
});

module.exports = { list, get, createDraft, updateDraft, activate, archive, clone, costRollup };
