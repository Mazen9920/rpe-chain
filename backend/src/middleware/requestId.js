// Request ID middleware.
// Reads X-Request-Id if provided (e.g. by nginx), otherwise generates a UUID.
// Echoes it back on the response so clients/logs can correlate.

const { randomUUID } = require('crypto');

module.exports = function requestId(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = (typeof incoming === 'string' && incoming.length > 0 && incoming.length < 200)
    ? incoming
    : randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
};
