// Rate limiting for sensitive endpoints.
// Disable in CI / dev by setting RATE_LIMIT_DISABLED=true.

const rateLimit = require('express-rate-limit');

const DISABLED = process.env.RATE_LIMIT_DISABLED === 'true';

function passthrough(_req, _res, next) { next(); }

// Per-IP: 10 login attempts / 15 min.
const loginIpLimiter = DISABLED ? passthrough : rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this IP, please try again later' },
});

// Per-email: 8 / hour. Uses email body as key (falls back to IP if not present).
const loginEmailLimiter = DISABLED ? passthrough : rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `email:${(req.body?.email || req.ip || 'anon').toLowerCase()}`,
  message: { error: 'Too many login attempts for this account' },
});

// Refresh endpoint: 30 / 5min / IP.
const refreshLimiter = DISABLED ? passthrough : rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts' },
});

module.exports = { loginIpLimiter, loginEmailLimiter, refreshLimiter };
