const { ALLOWED_SERVERS } = require('../config/constants');

function respondValidationError(res, message) {
  return res.status(400).json({
    success: false,
    message: 'Validation failed',
    data: null,
    error: message,
  });
}

function requireFields(fields = []) {
  return (req, res, next) => {
    const missing = fields.filter((field) => {
      const value = req.body?.[field];
      return value === undefined || value === null || String(value).trim() === '';
    });

    if (missing.length) {
      return respondValidationError(res, `Missing required field(s): ${missing.join(', ')}`);
    }

    return next();
  };
}

function validateSourcePayload(req, res, next) {
  const server = String(req.body?.server || '').trim().toLowerCase();
  const url = String(req.body?.url || '').trim();

  if (!server || !url) {
    return respondValidationError(res, 'Both server and url are required.');
  }

  if (!ALLOWED_SERVERS.includes(server)) {
    return respondValidationError(res, `server must be one of: ${ALLOWED_SERVERS.join(', ')}.`);
  }

  return next();
}

function validateSourceReplacePayload(req, res, next) {
  const url = String(req.body?.url || '').trim();
  if (!url) {
    return respondValidationError(res, 'url is required.');
  }

  const server = req.body?.server;
  if (server !== undefined) {
    const normalized = String(server).trim().toLowerCase();
    if (!ALLOWED_SERVERS.includes(normalized)) {
      return respondValidationError(res, `server must be one of: ${ALLOWED_SERVERS.join(', ')}.`);
    }
  }

  return next();
}

function validateSourceOrderPayload(req, res, next) {
  const orderedSourceIds = req.body?.orderedSourceIds;

  if (!Array.isArray(orderedSourceIds) || !orderedSourceIds.length) {
    return respondValidationError(res, 'orderedSourceIds must be a non-empty array.');
  }

  const hasInvalid = orderedSourceIds.some((value) => !String(value || '').trim());
  if (hasInvalid) {
    return respondValidationError(res, 'orderedSourceIds contains an invalid source id.');
  }

  return next();
}

function validateTmdbImportPayload(req, res, next) {
  const tmdbId = parseInt(req.body?.tmdbId, 10);
  if (!tmdbId) {
    return respondValidationError(res, 'tmdbId is required.');
  }
  return next();
}

function validateTmdbBulkPayload(req, res, next) {
  if (!Array.isArray(req.body?.items) || !req.body.items.length) {
    return respondValidationError(res, 'items must be a non-empty array.');
  }
  return next();
}

module.exports = {
  requireFields,
  validateSourcePayload,
  validateSourceReplacePayload,
  validateSourceOrderPayload,
  validateTmdbImportPayload,
  validateTmdbBulkPayload,
};
