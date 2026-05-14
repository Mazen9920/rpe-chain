// Controllers for /api/integrations/* — OAuth connect/callback/status/disconnect.
const oauth = require('../services/integrations/oauth.service');
const logger = require('../lib/logger');

const SUPPORTED = ['quickbooks', 'xero'];

function wrap(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      sendErr(res, err);
    }
  };
}

function sendErr(res, err) {
  const code = err.code || 'INTERNAL';
  const msg = err.message || 'internal error';
  let status = 500;
  if (['UNKNOWN_PROVIDER', 'INVALID_STATE'].includes(code)) status = 400;
  if (code === 'INTEGRATION_NOT_CONFIGURED') status = 400;
  if (code === 'INTEGRATION_DISCONNECTED') status = 409;
  if (err.status) status = err.status;
  logger.warn({ code, msg, status }, 'integrations: error');
  res.status(status).json({ error: code, message: msg });
}

function checkSupported(provider) {
  if (!SUPPORTED.includes(provider)) {
    const e = new Error(`unsupported_provider: ${provider}`);
    e.code = 'UNKNOWN_PROVIDER';
    throw e;
  }
}

const connect = wrap(async (req, res) => {
  const { provider } = req.params;
  checkSupported(provider);
  const userId = req.user && req.user.userId;
  const { url } = oauth.buildAuthorizeUrl(provider, userId);
  // 302 redirect — frontend triggers via window.location.href.
  res.redirect(302, url);
});

const callback = wrap(async (req, res) => {
  const { provider } = req.params;
  checkSupported(provider);
  const { code, state, realmId, error: providerErr } = req.query;
  if (providerErr) {
    return res.status(400).send(`Provider error: ${String(providerErr).slice(0, 120)}`);
  }
  if (!code || !state) {
    const e = new Error('missing code or state');
    e.code = 'INVALID_STATE';
    throw e;
  }
  oauth.verifyState(state);
  await oauth.exchangeCodeForToken(provider, code, realmId ? { realmId } : {});
  // Redirect back to the GL Export page with a success flag.
  const ret = process.env.FRONTEND_ORIGIN || '';
  res.redirect(302, `${ret}/gl-export?connected=${provider}`);
});

const status = wrap(async (req, res) => {
  const { provider } = req.params;
  checkSupported(provider);
  const s = await oauth.getStatus(provider);
  res.json(s);
});

const disconnect = wrap(async (req, res) => {
  const { provider } = req.params;
  checkSupported(provider);
  const out = await oauth.disconnect(provider);
  res.json(out);
});

module.exports = { connect, callback, status, disconnect };
