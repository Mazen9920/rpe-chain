// FX rate routes — admin/finance read & record.
const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth.middleware');
const fxService = require('../services/fx.service');

const router = express.Router();
router.use(authenticate);

router.get('/rates', requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const rows = await fxService.listRates({ base: req.query.base, quote: req.query.quote, limit: req.query.limit });
    res.json({ rows, total: rows.length });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

router.post('/rates', requireRole('ADMIN', 'FINANCE'), async (req, res) => {
  try {
    const { baseCurrency, quoteCurrency, rate, effectiveAt, source } = req.body || {};
    const row = await fxService.recordRate({
      baseCurrency,
      quoteCurrency,
      rate,
      effectiveAt,
      source,
      actorId: req.user?.id,
      sourceIp: req.ip,
    });
    res.status(201).json({
      id: row.id,
      baseCurrency: row.baseCurrency,
      quoteCurrency: row.quoteCurrency,
      rate: Number(row.rate),
      effectiveAt: row.effectiveAt,
      source: row.source,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

router.get('/convert', async (req, res) => {
  try {
    const amount = Number(req.query.amount);
    const from = req.query.from;
    const to = req.query.to;
    const at = req.query.at ? new Date(req.query.at) : new Date();
    if (!Number.isFinite(amount)) return res.status(400).json({ error: 'amount must be a number' });
    if (!from || !to) return res.status(400).json({ error: 'from and to are required' });
    const rate = await fxService.getRate(from, to, at);
    res.json({ amount, from: String(from).toUpperCase(), to: String(to).toUpperCase(), at: at.toISOString(), rate, result: amount * rate });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

module.exports = router;
