const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..', '..');
const runtime = process.env.APP_ENV || process.env.NODE_ENV || 'development';

const DEFAULTS = {
  NODE_ENV: runtime,
  PORT: '5001',
  HOST: '0.0.0.0',
  MONGO_URI: 'mongodb://127.0.0.1:27017/cinestream',
  FRONTEND_URL: runtime === 'production' ? '' : 'http://localhost:5001',
  CORS_ORIGINS: runtime === 'production' ? '*' : '',
  JWT_EXPIRES_IN: runtime === 'production' ? '7d' : '30d',
  ADMIN_USERNAME: 'admin',
  ADMIN_EMAIL: 'admin@cinestream.local',
  ADMIN_PASSWORD: 'Admin@12345',
  LOG_LEVEL: runtime === 'production' ? 'info' : 'debug',
  SOURCE_HEALTH_TIMEOUT_MS: '7000',
  SOURCE_HEALTH_BATCH_SIZE: '100',
  SOURCE_HEALTH_MAX_ERRORS: '500',
  OLLAMA_URL: 'http://127.0.0.1:11434/api/generate',
  OLLAMA_MODEL: 'llama3',
  OLLAMA_TIMEOUT_MS: '10000',
};

function loadEnvFiles() {
  const explicitPath = process.env.DOTENV_PATH;
  const candidates = explicitPath
    ? [path.resolve(projectRoot, explicitPath)]
    : [
        path.resolve(projectRoot, '.env'),
        path.resolve(projectRoot, `.env.${runtime}`),
        path.resolve(projectRoot, '.env.local'),
        path.resolve(projectRoot, `.env.${runtime}.local`),
      ];

  candidates
    .filter((filePath, index) => candidates.indexOf(filePath) === index)
    .filter((filePath) => fs.existsSync(filePath))
    .forEach((filePath) => {
      dotenv.config({
        path: filePath,
        override: false,
      });
    });
}

loadEnvFiles();

function getEnv(name, fallback = undefined) {
  const value = process.env[name];
  if (value !== undefined && value !== null && String(value).trim() !== '') {
    return String(value).trim();
  }

  if (fallback !== undefined) {
    return String(fallback);
  }

  return DEFAULTS[name] || '';
}

function getRequiredEnv(name) {
  const value = getEnv(name);
  if (!value) {
    const error = new Error(`Missing required environment variable: ${name}`);
    error.status = 500;
    error.code = 'ENV_MISSING';
    throw error;
  }
  return value;
}

function getNumberEnv(name, fallback) {
  const parsed = Number(getEnv(name, fallback));
  return Number.isFinite(parsed) ? parsed : Number(fallback);
}

function getBooleanEnv(name, fallback = false) {
  const value = getEnv(name, fallback ? 'true' : 'false').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function getArrayEnv(name, fallback = []) {
  const raw = getEnv(name, '');
  if (!raw) return fallback;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasEnv(name) {
  const value = process.env[name];
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function getTmdbCredentials() {
  const bearerToken =
    getEnv('TMDB_TOKEN', '') ||
    getEnv('TMDB_READ_ACCESS_TOKEN', '') ||
    getEnv('TMDB_ACCESS_TOKEN', '');

  return {
    apiKey: getEnv('TMDB_API_KEY', ''),
    bearerToken,
  };
}

function getFrontendOrigin() {
  return getEnv('FRONTEND_URL', DEFAULTS.FRONTEND_URL).replace(/\/+$/, '');
}

function getCanonicalHost() {
  const frontend = getFrontendOrigin();
  if (!frontend) return '';
  try {
    return new URL(frontend).host.toLowerCase();
  } catch {
    return '';
  }
}

function getCorsOrigins() {
  const explicit = getArrayEnv('CORS_ORIGINS');
  const frontend = getFrontendOrigin();
  const origins = [...explicit, frontend].filter(Boolean);
  return [...new Set(origins)];
}

module.exports = {
  runtime,
  projectRoot,
  defaults: DEFAULTS,
  getEnv,
  getRequiredEnv,
  getNumberEnv,
  getBooleanEnv,
  getArrayEnv,
  hasEnv,
  getTmdbCredentials,
  getFrontendOrigin,
  getCanonicalHost,
  getCorsOrigins,
};
