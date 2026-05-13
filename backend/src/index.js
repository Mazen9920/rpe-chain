require('dotenv').config();
// Sentry MUST be initialized before requiring app (instrumentation hooks).
require('./lib/sentry');

const app = require('./app');
const scheduler = require('./scheduler');
const logger = require('./lib/logger');

const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, env: process.env.NODE_ENV || 'development' }, 'RPE Supply API listening');
  if (process.env.DISABLE_SCHEDULER === 'true') {
    logger.info('Scheduler disabled via DISABLE_SCHEDULER=true');
  } else {
    scheduler.start();
  }
});

function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => logger.error({ err }, 'uncaughtException'));
