// Tier 4 #15 — ReportDefinition CRUD service.
// Visibility: owner sees own, ADMIN/FINANCE see all, isShared=true visible to all.

const prisma = require('../lib/prisma');
const reports = require('./reports.service');

function bad(msg, status = 400, code) {
  const e = new Error(msg);
  e.status = status;
  if (code) e.code = code;
  return e;
}

function canSeeAll(role) {
  return role === 'ADMIN' || role === 'FINANCE';
}

function visibilityWhere(actor) {
  if (canSeeAll(actor.role)) return { deletedAt: null };
  return {
    deletedAt: null,
    OR: [{ ownerId: actor.id }, { isShared: true }],
  };
}

async function list(actor, { reportKey } = {}) {
  const where = visibilityWhere(actor);
  if (reportKey) where.reportKey = reportKey;
  return prisma.reportDefinition.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      schedules: { where: { isActive: true }, select: { id: true, cron: true, format: true, isActive: true, nextRunAt: true } },
    },
  });
}

async function get(actor, id) {
  const def = await prisma.reportDefinition.findFirst({
    where: { id, ...visibilityWhere(actor) },
    include: {
      owner: { select: { id: true, name: true, email: true } },
      schedules: true,
    },
  });
  if (!def) throw bad('Report definition not found', 404, 'NOT_FOUND');
  return def;
}

async function create(actor, { name, description, reportKey, params, isShared }) {
  if (!name || !name.trim()) throw bad('name is required', 400, 'NAME_REQUIRED');
  if (!reportKey) throw bad('reportKey is required', 400, 'REPORT_KEY_REQUIRED');
  if (!reports.BUILDERS[reportKey]) throw bad(`Unknown reportKey: ${reportKey}`, 400, 'REPORT_KEY_INVALID');
  if (isShared && !canSeeAll(actor.role)) {
    throw bad('Only ADMIN/FINANCE can publish shared reports', 403, 'SHARED_FORBIDDEN');
  }
  return prisma.reportDefinition.create({
    data: {
      name: name.trim(),
      description: description || null,
      reportKey,
      params: params || {},
      isShared: !!isShared,
      ownerId: actor.id,
    },
  });
}

async function update(actor, id, patch) {
  const def = await prisma.reportDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!def) throw bad('Report definition not found', 404, 'NOT_FOUND');
  if (def.ownerId !== actor.id && !canSeeAll(actor.role)) {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }
  const data = {};
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw bad('name cannot be empty', 400, 'NAME_REQUIRED');
    data.name = patch.name.trim();
  }
  if (patch.description !== undefined) data.description = patch.description || null;
  if (patch.params !== undefined) data.params = patch.params || {};
  if (patch.isShared !== undefined) {
    if (patch.isShared && !canSeeAll(actor.role)) {
      throw bad('Only ADMIN/FINANCE can publish shared reports', 403, 'SHARED_FORBIDDEN');
    }
    data.isShared = !!patch.isShared;
  }
  return prisma.reportDefinition.update({ where: { id }, data });
}

async function remove(actor, id) {
  const def = await prisma.reportDefinition.findFirst({ where: { id, deletedAt: null } });
  if (!def) throw bad('Report definition not found', 404, 'NOT_FOUND');
  if (def.ownerId !== actor.id && actor.role !== 'ADMIN') {
    throw bad('Forbidden', 403, 'FORBIDDEN');
  }
  return prisma.reportDefinition.update({
    where: { id },
    data: { deletedAt: new Date() },
  });
}

module.exports = { list, get, create, update, remove, visibilityWhere, canSeeAll };
