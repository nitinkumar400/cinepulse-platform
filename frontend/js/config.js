const CURRENT_ORIGIN = window.location.origin || `http://${window.location.hostname || 'localhost'}`;
const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname);

const API_BASE = `${CURRENT_ORIGIN}/api`;
const MEDIA_BASE = CURRENT_ORIGIN;
window.__APP_CONFIG = {
  origin: CURRENT_ORIGIN,
  apiBase: API_BASE,
  mediaBase: MEDIA_BASE,
};
