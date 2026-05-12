const prisma = require('../lib/prisma');
const { logEvent } = require('../services/audit.service');

async function list(_req, res) {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(categories);
}

async function create(req, res) {
  const { name, parentId, abcDefault, defaultServiceLevel } = req.body;
  if (!name) return res.status(400).json({ error: 'Category name is required' });

  const existing = await prisma.category.findUnique({ where: { name } });
  if (existing) return res.status(409).json({ error: 'Category name already exists' });

  const category = await prisma.category.create({
    data: {
      name,
      parentId: parentId || null,
      abcDefault: abcDefault || null,
      defaultServiceLevel: defaultServiceLevel === undefined ? null : Number(defaultServiceLevel),
    },
  });
  await logEvent({
    eventType: 'CATEGORY_CREATED',
    entityType: 'Category',
    entityId: category.id,
    actorId: req.user?.id,
    payload: { after: category },
    sourceIp: req.ip,
  });
  res.status(201).json(category);
}

async function update(req, res) {
  const before = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!before) return res.status(404).json({ error: 'Category not found' });

  const { name, parentId, abcDefault, defaultServiceLevel } = req.body;
  if (name) {
    const existing = await prisma.category.findUnique({ where: { name } });
    if (existing && existing.id !== req.params.id) {
      return res.status(409).json({ error: 'Category name already exists' });
    }
  }

  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(parentId !== undefined ? { parentId: parentId || null } : {}),
      ...(abcDefault !== undefined ? { abcDefault: abcDefault || null } : {}),
      ...(defaultServiceLevel !== undefined
        ? { defaultServiceLevel: defaultServiceLevel === null ? null : Number(defaultServiceLevel) }
        : {}),
    },
  });
  await logEvent({
    eventType: 'CATEGORY_UPDATED',
    entityType: 'Category',
    entityId: category.id,
    actorId: req.user?.id,
    payload: { before, after: category },
    sourceIp: req.ip,
  });
  res.json(category);
}

module.exports = { list, create, update };
