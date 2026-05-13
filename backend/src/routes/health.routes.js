// Health & readiness probes.
//
//   GET /api/health  → 200 if the process is running. Cheap. Never fails.
//   GET /api/ready   → 200 only if DB is reachable; 503 otherwise. Used by
//                      load balancers + docker healthchecks to gate traffic.

const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'rpe-supply-api',
    version: process.env.npm_package_version || 'unknown',
    uptime: Math.floor(process.uptime()),
  });
});

router.get('/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ready', db: 'up' });
  } catch (err) {
    res.status(503).json({ status: 'not-ready', db: 'down', error: err.message });
  }
});

module.exports = router;
