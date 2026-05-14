// OAuth2 service for QuickBooks Online + Xero (v1.7.1).
// Handles: authorize-URL build, callback code→token exchange, encrypted
// persistence on GlIntegrationCredential, refresh-on-expiry, status reads.
//
// Provider endpoints are env-overridable so tests can redirect to a local stub.
const jwt = require('jsonwebtoken');
const prisma = require('../../lib/prisma');
const logger = require('../../lib/logger');
const crypto = require('../../lib/crypto');
const httpClient = require('./httpClient');

const STATE_TTL_SECONDS = 300;

const PROVIDERS = {
  quickbooks: {
    authUrl: () => process.env.QBO_AUTH_URL || 'https://appcenter.intuit.com/connect/oauth2',
    tokenUrl: () => process.env.QBO_TOKEN_URL || 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
    apiBase: () => process.env.QBO_API_BASE || 'https://sandbox-quickbooks.api.intuit.com',
    scope: 'com.intuit.quickbooks.accounting',
    clientId: () => process.env.QUICKBOOKS_CLIENT_ID,
    clientSecret: () => process.env.QUICKBOOKS_CLIENT_SECRET,
    redirectUri: () => process.env.QUICKBOOKS_REDIRECT_URI,
  },
  xero: {
    authUrl: () => process.env.XERO_AUTH_URL || 'https://login.xero.com/identity/connect/authorize',
    tokenUrl: () => process.env.XERO_TOKEN_URL || 'https://identity.xero.com/connect/token',
    apiBase: () => process.env.XERO_API_BASE || 'https://api.xero.com',
    scope: 'accounting.transactions accounting.settings offline_access',
    clientId: () => process.env.XERO_CLIENT_ID,
    clientSecret: () => process.env.XERO_CLIENT_SECRET,
    redirectUri: () => process.env.XERO_REDIRECT_URI,
  },
};

function getProvider(name) {
  const p = PROVIDERS[name];
  if (!p) {
    const err = new Error(`unknown_provider: ${name}`);
    err.code = 'UNKNOWN_PROVIDER';
    throw err;
  }
  return p;
}

function ensureConfigured(p, name) {
  if (!p.clientId() || !p.clientSecret() || !p.redirectUri()) {
    const err = new Error(`${name}: not configured (set ${name.toUpperCase()}_CLIENT_ID / _CLIENT_SECRET / _REDIRECT_URI)`);
    err.code = 'INTEGRATION_NOT_CONFIGURED';
    throw err;
  }
}

function signState({ userId, provider }) {
  return jwt.sign(
    { u: userId, p: provider, n: crypto.encrypt(String(Date.now()), process.env.JWT_SECRET).slice(0, 12) },
    process.env.JWT_SECRET,
    { expiresIn: STATE_TTL_SECONDS, algorithm: 'HS256' }
  );
}

function verifyState(state) {
  try {
    return jwt.verify(state, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  } catch (err) {
    const e = new Error(`invalid_state: ${err.message}`);
    e.code = 'INVALID_STATE';
    throw e;
  }
}

function buildAuthorizeUrl(name, userId) {
  const p = getProvider(name);
  ensureConfigured(p, name);
  const state = signState({ userId, provider: name });
  const params = new URLSearchParams({
    client_id: p.clientId(),
    response_type: 'code',
    scope: p.scope,
    redirect_uri: p.redirectUri(),
    state,
  });
  return { url: `${p.authUrl()}?${params.toString()}`, state };
}

async function exchangeCodeForToken(name, code, extra = {}) {
  const p = getProvider(name);
  ensureConfigured(p, name);
  const basic = Buffer.from(`${p.clientId()}:${p.clientSecret()}`).toString('base64');
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: p.redirectUri(),
  });
  const data = await httpClient.post(p.tokenUrl(), {
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
  });
  return persistTokens(name, data, extra);
}

async function refreshToken(name, cred) {
  const p = getProvider(name);
  ensureConfigured(p, name);
  const refresh = crypto.decrypt(cred.refreshToken);
  if (!refresh) {
    const e = new Error(`${name}: no refresh token`);
    e.code = 'INTEGRATION_DISCONNECTED';
    throw e;
  }
  const basic = Buffer.from(`${p.clientId()}:${p.clientSecret()}`).toString('base64');
  const form = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
  const data = await httpClient.post(p.tokenUrl(), {
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: form.toString(),
  });
  return persistTokens(name, data, { realmId: cred.realmId, meta: cred.meta });
}

async function persistTokens(name, tokenResponse, extra = {}) {
  const access = tokenResponse.access_token;
  const refresh = tokenResponse.refresh_token || null;
  const expiresIn = Number(tokenResponse.expires_in || 0);
  if (!access || !expiresIn) {
    const e = new Error(`${name}: token response missing access_token or expires_in`);
    e.code = 'INVALID_TOKEN_RESPONSE';
    throw e;
  }
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  const realmId = extra.realmId || tokenResponse.realmId || null;
  const meta = extra.meta || {};
  const enc = crypto.encrypt(access);
  const encRefresh = refresh ? crypto.encrypt(refresh) : (await getCredential(name))?.refreshToken || null;
  const row = await prisma.glIntegrationCredential.upsert({
    where: { provider: name },
    create: {
      provider: name,
      realmId,
      accessToken: enc,
      refreshToken: encRefresh,
      expiresAt,
      meta,
      isActive: true,
    },
    update: {
      realmId: realmId ?? undefined,
      accessToken: enc,
      refreshToken: encRefresh,
      expiresAt,
      meta,
      isActive: true,
    },
  });
  logger.info({ provider: name, realmId, expiresAt }, 'oauth: tokens persisted');
  return row;
}

async function getCredential(name) {
  return prisma.glIntegrationCredential.findUnique({ where: { provider: name } });
}

async function getValidAccessToken(name) {
  const p = getProvider(name);
  ensureConfigured(p, name);
  let cred = await getCredential(name);
  if (!cred || !cred.isActive || !cred.accessToken) {
    const e = new Error(`${name}: not connected`);
    e.code = 'INTEGRATION_DISCONNECTED';
    throw e;
  }
  // Refresh if expiring within 60s.
  if (!cred.expiresAt || cred.expiresAt.getTime() < Date.now() + 60_000) {
    logger.info({ provider: name, expiresAt: cred.expiresAt }, 'oauth: refreshing token');
    cred = await refreshToken(name, cred);
  }
  return {
    accessToken: crypto.decrypt(cred.accessToken),
    realmId: cred.realmId,
    meta: cred.meta || {},
    apiBase: p.apiBase(),
  };
}

async function getStatus(name) {
  const p = getProvider(name);
  const configured = !!(p.clientId() && p.clientSecret() && p.redirectUri());
  const cred = await getCredential(name);
  if (!cred) return { provider: name, configured, connected: false };
  return {
    provider: name,
    configured,
    connected: !!cred.isActive,
    realmId: cred.realmId,
    expiresAt: cred.expiresAt,
    meta: cred.meta || {},
  };
}

async function disconnect(name) {
  const cred = await getCredential(name);
  if (!cred) return { provider: name, connected: false };
  await prisma.glIntegrationCredential.update({
    where: { provider: name },
    data: { isActive: false, accessToken: null, refreshToken: null },
  });
  return { provider: name, connected: false };
}

module.exports = {
  PROVIDERS,
  buildAuthorizeUrl,
  exchangeCodeForToken,
  refreshToken,
  getValidAccessToken,
  getStatus,
  disconnect,
  verifyState,
  // exposed for tests
  _persistTokens: persistTokens,
};
