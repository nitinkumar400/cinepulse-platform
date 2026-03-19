function createApiError(message, response, payload = null) {
  const error = new Error(message || 'Request failed');
  error.status = response?.status || 0;
  error.payload = payload;
  return error;
}

async function apiRequest(url, options = {}) {
  const token = localStorage.getItem('token');
  const hasAuthorizationHeader =
    !!options.headers &&
    Object.keys(options.headers).some((key) => key.toLowerCase() === 'authorization');

  const requestOptions = {
    ...options,
    headers: {
      ...(options.headers || {}),
      ...(!hasAuthorizationHeader && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    maxRetries: Number.isInteger(options.maxRetries) ? options.maxRetries : 2,
  };

  try {
    const response = await apiFetch(url, requestOptions);
    const payload = await readJsonResponse(response);

    if (!response.ok) {
      throw createApiError(payload.message || 'Request failed', response, payload);
    }

    return payload;
  } catch (error) {
    if (!requestOptions.silent) {
      showToast(error.message || 'Something went wrong', 'error');
    }
    throw error;
  }
}

window.apiRequest = apiRequest;
