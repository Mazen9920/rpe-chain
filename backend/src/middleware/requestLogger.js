// pino-http request logger.
// Emits one JSON line per request with reqId, method, url, status, durMs, userId.

const pinoHttp = require('pino-http');
const logger = require('../lib/logger');

module.exports = pinoHttp({
  logger,
  genReqId: (req) => req.id, // populated by requestId middleware
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customProps: (req) => ({
    userId: req.user?.id || null,
    role: req.user?.role || null,
  }),
  serializers: {
    req: (req) => ({
      method: req.method,
      url: req.url,
      remoteAddress: req.remoteAddress,
    }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
});
