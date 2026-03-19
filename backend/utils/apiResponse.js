function sendSuccess(res, payload = {}, options = {}) {
  const {
    status = 200,
    message = 'OK',
    meta = {},
  } = options;

  return res.status(status).json({
    success: true,
    message,
    ...payload,
    meta,
    error: null,
  });
}

function sendError(res, error, options = {}) {
  const status = options.status || error.status || 500;
  const message = options.message || error.message || 'Internal server error';

  return res.status(status).json({
    success: false,
    message,
    error: {
      code: options.code || error.code || 'SERVER_ERROR',
      details: options.details || null,
    },
  });
}

function asyncHandler(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

module.exports = {
  sendSuccess,
  sendError,
  asyncHandler,
};
