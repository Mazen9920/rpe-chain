const prisma = require('../lib/prisma');
const express = require('express');
const { authenticate } = require('../middleware/auth.middleware');

const router = express.Router();
router.use(authenticate);

const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) { next(err); }
};

// GET /api/events?limit=20&entityType=SalesOrder&entityId=...&eventType=...
router.get('/', wrap(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  const offset = Number(req.query.offset) || 0;
  const where = {};
  if (req.query.entityType) where.entityType = req.query.entityType;
  if (req.query.entityId) where.entityId = req.query.entityId;
  if (req.query.eventType) where.eventType = req.query.eventType;
  if (req.query.since) where.occurredAt = { gte: new Date(req.query.since) };

  const [events, total] = await Promise.all([
    prisma.eventLog.findMany({
      where,
      take: limit,
      skip: offset,
      orderBy: { occurredAt: 'desc' },
      include: { actor: { select: { id: true, email: true, role: true } } },
    }),
    prisma.eventLog.count({ where }),
  ]);
  res.json({ events, total });
}));

module.exports = router;
