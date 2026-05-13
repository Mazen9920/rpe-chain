// Inbound webhook HMAC verification.
// Use with express.raw({ type: 'application/json' }) on the SAME route so req.body is a Buffer.
// Compares constant-time. Bypassed when WEBHOOK_SIGNATURE_DISABLED=true (tests).

const crypto = require('crypto');

function verifyHmac({ headerName, secretEnv, algo = 'sha256', encoding = 'base64' }) {
  return function (req, res, next) {
    if (process.env.WEBHOOK_SIGNATURE_DISABLED === 'true') return next();
    const secret = process.env[secretEnv];
    if (!secret) {
      return res.status(500).json({ error: `Webhook secret env ${secretEnv} not set` });
    }
    const signature = req.get(headerName) || '';
    const raw = req.body;
    if (!Buffer.isBuffer(raw)) {
      return res.status(400).json({ error: 'Raw body required for signature verification' });
    }
    const computed = crypto.createHmac(algo, secret).update(raw).digest(encoding);
    const a = Buffer.from(computed);
    const b = Buffer.from(signature);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
    // parse JSON now that signature passed
    try {
      req.body = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    return next();
  };
}

module.exports = { verifyHmac };
