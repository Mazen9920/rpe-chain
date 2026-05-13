// Auth controller — Section 8 hardening.
// Endpoints:
//   POST   /api/auth/register
//   POST   /api/auth/login           → either { token, refreshToken, user } or { mfaRequired, mfaToken }
//   POST   /api/auth/login/mfa       → exchange mfa challenge + TOTP code for full session
//   POST   /api/auth/refresh         → rotate refresh, return fresh access
//   POST   /api/auth/logout          → revoke refresh token
//   GET    /api/auth/me
//   POST   /api/auth/mfa/setup       → returns otpauth URL + base32; provisional
//   POST   /api/auth/mfa/verify      → flip totpEnabled on (requires fresh code)
//   POST   /api/auth/mfa/disable     → password-confirmed

const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const prisma = require('../lib/prisma');
const { logEvent } = require('../services/audit.service');
const authService = require('../services/auth.service');

function ctx(req) {
  return {
    userAgent: (req.headers['user-agent'] || '').slice(0, 200),
    ipAddress: req.ip,
  };
}

async function register(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

    const { email, password, name, role } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return res.status(409).json({ error: 'Email already in use' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email, password: hashed, name, role: role || 'READ_ONLY' },
      select: { id: true, email: true, name: true, role: true },
    });
    await logEvent({
      eventType: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      payload: { email },
    });
    res.status(201).json(user);
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password } = req.body;
    const result = await authService.attemptLogin({ email, password, ...ctx(req) });
    res.json(result);
  } catch (err) { next(err); }
}

async function loginMfa(req, res, next) {
  try {
    const { mfaToken, code } = req.body || {};
    if (!mfaToken || !code) return res.status(400).json({ error: 'mfaToken and code required' });
    const result = await authService.verifyMfaAndLogin({ mfaToken, code, ...ctx(req) });
    res.json(result);
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body || {};
    if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
    const result = await authService.rotateRefreshToken(refreshToken, ctx(req));
    res.json(result);
  } catch (err) { next(err); }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body || {};
    if (refreshToken) await authService.revokeRefreshToken(refreshToken);
    res.json({ ok: true });
  } catch (err) { next(err); }
}

async function me(req, res, next) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, name: true, role: true, totpEnabled: true, lastLoginAt: true },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) { next(err); }
}

async function mfaSetup(req, res, next) {
  try {
    const result = await authService.setupMfa(req.user.id);
    res.json(result);
  } catch (err) { next(err); }
}

async function mfaVerify(req, res, next) {
  try {
    const { code } = req.body || {};
    if (!code) return res.status(400).json({ error: 'code required' });
    const result = await authService.verifyMfaEnrollment({ userId: req.user.id, code });
    res.json(result);
  } catch (err) { next(err); }
}

async function mfaDisable(req, res, next) {
  try {
    const { password } = req.body || {};
    if (!password) return res.status(400).json({ error: 'password required' });
    const result = await authService.disableMfa({ userId: req.user.id, password });
    res.json(result);
  } catch (err) { next(err); }
}

module.exports = {
  register, login, loginMfa, refresh, logout, me,
  mfaSetup, mfaVerify, mfaDisable,
};
