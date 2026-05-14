const express = require('express');
const fs = require('fs');
const path = require('path');
const storage = require('../lib/storage');

const router = express.Router();

// Local-driver signed download. Public route (no JWT) — security is the HMAC
// signature + short TTL. NEVER mount under /api/auth-protected paths.
router.get('/local/*', (req, res, next) => {
  try {
    // Express captures the wildcard as req.params[0]
    const rawKey = req.params[0] || '';
    const key = rawKey.split('/').map(decodeURIComponent).join('/');
    const { exp, sig } = req.query;
    if (!storage.verifyLocalSig(key, exp, sig)) {
      return res.status(403).json({ error: 'INVALID_OR_EXPIRED_SIGNATURE' });
    }
    if (storage.DRIVER !== 'local') {
      return res.status(404).json({ error: 'LOCAL_DRIVER_DISABLED' });
    }
    let abs;
    try { abs = storage.localAbsPath(key); }
    catch { return res.status(400).json({ error: 'INVALID_KEY' }); }
    if (!fs.existsSync(abs)) return res.status(404).json({ error: 'NOT_FOUND' });
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(key)}"`);
    fs.createReadStream(abs).pipe(res);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
