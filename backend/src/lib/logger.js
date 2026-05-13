// Structured logger (pino).
// Use everywhere in the backend instead of console.log/error.
//
//   const logger = require('../lib/logger');
//   logger.info({ orderId }, 'order created');
//   logger.error({ err }, 'failed to charge card');
//
// Per-request loggers (with reqId/userId bound) are available on `req.log`,
// installed by middleware/requestLogger.js.

const pino = require('pino');

const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');

const logger = pino({
  level,
  base: { service: 'rpe-supply-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.refreshToken',
      '*.totpSecret',
    ],
    censor: '[redacted]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = logger;
