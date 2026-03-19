const crypto = require('crypto');
const logger = require('../config/logger');

function requestContext(req, res, next) {
  const startedAt = Date.now();
  req.id = req.headers['x-request-id'] || crypto.randomUUID();
  res.setHeader('x-request-id', req.id);

  res.on('finish', () => {
    logger.info('HTTP request completed', {
      requestId: req.id,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      ip: req.ip,
      userAgent: req.get('user-agent') || '',
    });
  });

  next();
}

module.exports = {
  requestContext,
};
