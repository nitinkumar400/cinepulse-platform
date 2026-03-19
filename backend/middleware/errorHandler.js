const logger = require('../config/logger');
const { sendError } = require('../utils/apiResponse');

function notFoundHandler(req, res) {
  return sendError(res, new Error(`Route not found: ${req.originalUrl}`), {
    status: req.originalUrl.startsWith('/api/') ? 404 : 404,
    code: 'ROUTE_NOT_FOUND',
  });
}

function errorHandler(err, req, res, next) {
  const status =
    err.status ||
    err.statusCode ||
    (err.code === 'LIMIT_FILE_SIZE' ? 413 : null) ||
    (err.name === 'ValidationError' ? 400 : null) ||
    (err.name === 'CastError' ? 400 : null) ||
    (err.code === 11000 ? 409 : null) ||
    500;

  logger.error('Request failed', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    status,
    code: err.code || err.name || 'UNHANDLED_ERROR',
    message: err.message,
    stack: err.stack,
  });

  if (err.code === 'LIMIT_FILE_SIZE') {
    return sendError(res, err, {
      status,
      code: 'FILE_TOO_LARGE',
      message: 'Uploaded file exceeds the allowed size limit.',
    });
  }

  if (err.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((entry) => entry.message);
    return sendError(res, err, {
      status,
      code: 'MONGOOSE_VALIDATION_ERROR',
      message: 'Validation failed.',
      details,
    });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'field';
    return sendError(res, err, {
      status,
      code: 'DUPLICATE_KEY',
      message: `${field} already exists.`,
    });
  }

  if (err.name === 'CastError') {
    return sendError(res, err, {
      status,
      code: 'INVALID_IDENTIFIER',
      message: 'Invalid identifier format.',
    });
  }

  if (err.http_code) {
    return sendError(res, err, {
      status: 502,
      code: 'UPSTREAM_MEDIA_ERROR',
      message: `Media provider request failed: ${err.message}`,
    });
  }

  return sendError(res, err, {
    status,
    code: err.code || 'SERVER_ERROR',
    message: err.expose ? err.message : (status >= 500 ? 'Internal server error' : err.message),
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
