// Thin fetch wrapper for integration API calls.
// Centralised so handlers stay free of boilerplate and so tests can point
// providers at a local stub server via *_API_BASE / *_TOKEN_URL env vars.
const logger = require('../../lib/logger');

const DEFAULT_TIMEOUT_MS = 15000;

async function request(method, url, { headers = {}, body, timeoutMs = DEFAULT_TIMEOUT_MS, expectJson = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Accept: 'application/json', ...headers },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    logger.warn({ url, method, err: err.message }, 'httpClient: network error');
    throw Object.assign(new Error(`http_network_error: ${err.message}`), { code: 'NETWORK_ERROR' });
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  const ms = Date.now() - t0;
  // Redact authorization header in logs.
  logger.info({ url, method, status: res.status, ms }, 'httpClient: response');
  let data = null;
  if (expectJson && text) {
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
  } else {
    data = text;
  }
  if (!res.ok) {
    const err = new Error(`http_${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data).slice(0, 500)}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

module.exports = {
  request,
  get: (url, opts) => request('GET', url, opts),
  post: (url, opts) => request('POST', url, opts),
  put: (url, opts) => request('PUT', url, opts),
  delete: (url, opts) => request('DELETE', url, opts),
};
