// Auth service — Section 8 hardening.
// Responsible for:
//   - Password verification + per-user failed-attempt counter & lockout
//   - JWT access tokens (short-lived) + DB-backed refresh tokens (long-lived)
//   - Optional TOTP (RFC 6238) MFA challenge
//
// Endpoints in auth.controller.js call into here.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const prisma = require('../lib/prisma');
const { logEvent } = require('./audit.service');

const ACCESS_TTL = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TTL_DAYS = Number(process.env.JWT_REFRESH_DAYS || 30);
const MFA_CHALLENGE_TTL = '5m';

const MAX_FAILED_ATTEMPTS = Number(process.env.AUTH_MAX_FAILED || 5);
const LOCKOUT_MINUTES = Number(process.env.AUTH_LOCKOUT_MINUTES || 30);

// ─── Tokens ──────────────────────────────────────────────────────────────────

function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, typ: 'access' },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TTL }
  );
}

function signMfaChallenge(userId) {
  return jwt.sign(
    { id: userId, typ: 'mfa' },
    process.env.JWT_SECRET,
    { expiresIn: MFA_CHALLENGE_TTL }
  );
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function issueRefreshToken(userId, { userAgent, ipAddress } = {}) {
  const raw = crypto.randomBytes(48).toString('base64url');
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { userId, tokenHash, expiresAt, userAgent, ipAddress },
  });
  return raw;
}

async function rotateRefreshToken(rawToken, { userAgent, ipAddress } = {}) {
  const tokenHash = hashToken(rawToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing) throw httpErr(401, 'Invalid refresh token');
  if (existing.revokedAt) {
    // Reuse of revoked token → treat as compromise, revoke entire family for that user.
    await prisma.refreshToken.updateMany({
      where: { userId: existing.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw httpErr(401, 'Refresh token reuse detected; session revoked');
  }
  if (existing.expiresAt < new Date()) throw httpErr(401, 'Refresh token expired');

  const user = await prisma.user.findUnique({ where: { id: existing.userId } });
  if (!user || !user.isActive) throw httpErr(401, 'User not active');

  const newRaw = await issueRefreshToken(user.id, { userAgent, ipAddress });
  await prisma.refreshToken.update({
    where: { id: existing.id },
    data: { revokedAt: new Date(), replacedBy: hashToken(newRaw) },
  });
  return {
    token: signAccessToken(user),
    refreshToken: newRaw,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

async function revokeRefreshToken(rawToken) {
  const tokenHash = hashToken(rawToken);
  await prisma.refreshToken.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

async function revokeAllForUser(userId) {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

// ─── Login flow ──────────────────────────────────────────────────────────────

function httpErr(status, message, code) {
  const e = new Error(message);
  e.status = status;
  if (code) e.code = code;
  return e;
}

async function attemptLogin({ email, password, userAgent, ipAddress }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    await logEvent({ eventType: 'LOGIN_FAILED', entityType: 'User', entityId: user?.id, payload: { email, reason: 'unknown_or_inactive' }, sourceIp: ipAddress });
    throw httpErr(401, 'Invalid credentials');
  }

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await logEvent({ eventType: 'LOGIN_LOCKED', entityType: 'User', entityId: user.id, payload: { email, lockedUntil: user.lockedUntil }, sourceIp: ipAddress });
    throw httpErr(423, `Account locked until ${user.lockedUntil.toISOString()}`);
  }

  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
      : null;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: failed, lockedUntil: lock },
    });
    await logEvent({
      eventType: lock ? 'LOGIN_LOCKED' : 'LOGIN_FAILED',
      entityType: 'User',
      entityId: user.id,
      payload: { email, failedCount: failed, lockedUntil: lock },
      sourceIp: ipAddress,
    });
    throw httpErr(401, 'Invalid credentials');
  }

  // Password OK. Reset counter.
  if (user.failedLoginCount > 0 || user.lockedUntil) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
  }

  // MFA gate
  if (user.totpEnabled) {
    await logEvent({
      eventType: 'MFA_CHALLENGED',
      entityType: 'User',
      entityId: user.id,
      payload: { email },
      sourceIp: ipAddress,
    });
    return {
      mfaRequired: true,
      mfaToken: signMfaChallenge(user.id),
    };
  }

  return finalizeLogin(user, { userAgent, ipAddress });
}

async function finalizeLogin(user, { userAgent, ipAddress } = {}) {
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logEvent({
    eventType: 'LOGIN_SUCCESS',
    entityType: 'User',
    entityId: user.id,
    payload: { email: user.email },
    sourceIp: ipAddress,
  });
  return {
    token: signAccessToken(user),
    refreshToken: await issueRefreshToken(user.id, { userAgent, ipAddress }),
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

async function verifyMfaAndLogin({ mfaToken, code, userAgent, ipAddress }) {
  let payload;
  try {
    payload = jwt.verify(mfaToken, process.env.JWT_SECRET);
  } catch {
    throw httpErr(401, 'Invalid or expired MFA challenge');
  }
  if (payload.typ !== 'mfa') throw httpErr(401, 'Invalid MFA challenge');

  const user = await prisma.user.findUnique({ where: { id: payload.id } });
  if (!user || !user.isActive || !user.totpEnabled || !user.totpSecret) {
    throw httpErr(401, 'MFA not configured');
  }
  const ok = speakeasy.totp.verify({
    secret: user.totpSecret,
    encoding: 'base32',
    token: String(code),
    window: 1,
  });
  if (!ok) {
    await logEvent({
      eventType: 'MFA_FAILED',
      entityType: 'User',
      entityId: user.id,
      payload: { email: user.email },
      sourceIp: ipAddress,
    });
    throw httpErr(401, 'Invalid TOTP code');
  }
  return finalizeLogin(user, { userAgent, ipAddress });
}

// ─── MFA setup ──────────────────────────────────────────────────────────────

async function setupMfa(userId) {
  const secret = speakeasy.generateSecret({
    name: `RPE Supply (${userId.slice(0, 8)})`,
    length: 20,
  });
  // Store provisional secret; only flip totpEnabled after verifyMfa.
  await prisma.user.update({
    where: { id: userId },
    data: { totpSecret: secret.base32, totpEnabled: false },
  });
  return { otpauthUrl: secret.otpauth_url, base32: secret.base32 };
}

async function verifyMfaEnrollment({ userId, code }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.totpSecret) throw httpErr(400, 'MFA setup not started');
  const ok = speakeasy.totp.verify({
    secret: user.totpSecret,
    encoding: 'base32',
    token: String(code),
    window: 1,
  });
  if (!ok) throw httpErr(401, 'Invalid code');
  await prisma.user.update({ where: { id: userId }, data: { totpEnabled: true } });
  await logEvent({
    eventType: 'MFA_ENABLED',
    entityType: 'User',
    entityId: userId,
    payload: {},
  });
  return { totpEnabled: true };
}

async function disableMfa({ userId, password }) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw httpErr(404, 'User not found');
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) throw httpErr(401, 'Invalid password');
  await prisma.user.update({
    where: { id: userId },
    data: { totpEnabled: false, totpSecret: null },
  });
  await logEvent({
    eventType: 'MFA_DISABLED',
    entityType: 'User',
    entityId: userId,
    payload: {},
  });
  return { totpEnabled: false };
}

module.exports = {
  attemptLogin,
  verifyMfaAndLogin,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  setupMfa,
  verifyMfaEnrollment,
  disableMfa,
  hashToken,
  signAccessToken,
  issueRefreshToken,
};
