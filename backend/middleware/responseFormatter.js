function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isFormattedContract(payload) {
  return isPlainObject(payload) &&
    Object.prototype.hasOwnProperty.call(payload, 'success') &&
    Object.prototype.hasOwnProperty.call(payload, 'message') &&
    Object.prototype.hasOwnProperty.call(payload, 'data') &&
    Object.prototype.hasOwnProperty.call(payload, 'error');
}

function normalizePayload(statusCode, payload) {
  if (isFormattedContract(payload)) return payload;

  const isError = statusCode >= 400;
  const defaultMessage = isError ? 'Request failed' : 'OK';

  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isPlainObject(payload)) {
    if (typeof payload === 'string') {
      return {
        success: !isError,
        message: payload,
        data: isError ? null : payload,
        error: isError ? payload : null,
      };
    }

    return {
      success: !isError,
      message: defaultMessage,
      data: isError ? null : payload,
      error: isError ? defaultMessage : null,
    };
  }

  const message = typeof payload.message === 'string' && payload.message.trim() ? payload.message : defaultMessage;
  const base = { ...payload, success: !isError, message };

  if (isError) {
    const error = typeof payload.error === 'string' && payload.error.trim() ? payload.error : message;
    return {
      ...base,
      success: false,
      data: null,
      error,
    };
  }

  const data = {};
  Object.keys(payload).forEach((key) => {
    if (key !== 'message' && key !== 'error' && key !== 'success') data[key] = payload[key];
  });

  return {
    ...base,
    data: Object.keys(data).length ? data : null,
    error: null,
  };
}

function responseFormatter(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = function (payload) {
    return originalJson(normalizePayload(res.statusCode || 200, payload));
  };

  next();
}

module.exports = responseFormatter;
