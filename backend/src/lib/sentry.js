// Sentry initialization for the backend.
// No-op when SENTRY_DSN is not set.
//
// Usage: require this once at startup BEFORE creating the Express app
// (so its instrumentation can hook handlers). app.js then calls
// `attach(app)` to install the request & error handlers.

const Sentry = require('@sentry/node');
const logger = require('./logger');

const dsn = process.env.SENTRY_DSN;
let initialized = false;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    release: process.env.GIT_SHA || undefined,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    integrations: [
      Sentry.httpIntegration(),
      Sentry.expressIntegration(),
    ],
  });
  initialized = true;
  logger.info('Sentry initialized');
} else {
  logger.debug('SENTRY_DSN not set — Sentry disabled');
}

module.exports = {
  Sentry,
  initialized,
  attach(app) {
    if (!initialized) return;
    // Must be called AFTER all routes are mounted (see app.js).
    Sentry.setupExpressErrorHandler(app);
  },
};
