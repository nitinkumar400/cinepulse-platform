const axios = require('axios');

const connectDB = require('../backend/database/db');
const Movie = require('../backend/models/Movie');
const logger = require('../backend/config/logger');

const REQUEST_TIMEOUT_MS = Number(process.env.SOURCE_HEALTH_TIMEOUT_MS || 7000);
const MAX_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 500;
const CURSOR_BATCH_SIZE = Number(process.env.SOURCE_HEALTH_BATCH_SIZE || 100);
const MAX_RECORDED_ERRORS = Number(process.env.SOURCE_HEALTH_MAX_ERRORS || 500);
const HEALTHY_CODES = new Set([200, 204, 206]);
const BROKEN_CODES = new Set([401, 403, 404, 410]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestWithRetry(config, label) {
  let attempt = 0;

  while (attempt < MAX_ATTEMPTS) {
    try {
      return await axios({
        timeout: REQUEST_TIMEOUT_MS,
        maxRedirects: 5,
        validateStatus: () => true,
        ...config,
      });
    } catch (error) {
      attempt += 1;
      if (attempt >= MAX_ATTEMPTS) {
        throw error;
      }

      logger.warn('Source health retry scheduled', {
        label,
        attempt,
        error: error.message,
      });
      await sleep(BACKOFF_BASE_MS * (2 ** (attempt - 1)));
    }
  }

  throw new Error(`${label} failed`);
}

async function probeSource(url) {
  let response = await requestWithRetry({ method: 'HEAD', url }, `HEAD ${url}`);

  if (response.status === 405 || response.status === 400) {
    response = await requestWithRetry({
      method: 'GET',
      url,
      headers: {
        Range: 'bytes=0-0',
      },
    }, `GET ${url}`);
  }

  if (HEALTHY_CODES.has(response.status)) {
    return { isBroken: false, reason: null, status: response.status };
  }

  if (BROKEN_CODES.has(response.status) || response.status >= 500) {
    return { isBroken: true, reason: `HTTP ${response.status}`, status: response.status };
  }

  return { isBroken: false, reason: null, status: response.status };
}

async function updateSourceStatus(movieId, sourceId, isBroken, timestamp) {
  await Movie.updateOne(
    { _id: movieId, 'sources._id': sourceId },
    {
      $set: {
        'sources.$.is_broken': isBroken,
        'sources.$.last_checked': timestamp,
      },
    }
  );
}

function recordBroken(report, entry) {
  if (report.errors.length < MAX_RECORDED_ERRORS) {
    report.errors.push(entry);
    return;
  }

  report.truncatedErrors += 1;
}

async function run() {
  await connectDB();

  const cursor = Movie.find({ 'sources.0': { $exists: true } })
    .select('title sources')
    .lean()
    .cursor({ batchSize: CURSOR_BATCH_SIZE });

  const report = {
    checked: 0,
    healthy: 0,
    broken: 0,
    truncatedErrors: 0,
    errors: [],
  };

  for await (const movie of cursor) {
    for (const source of movie.sources || []) {
      const timestamp = new Date();
      report.checked += 1;

      try {
        const result = await probeSource(source.url);
        await updateSourceStatus(movie._id, source._id, result.isBroken, timestamp);

        if (result.isBroken) {
          report.broken += 1;
          recordBroken(report, {
            movieId: movie._id,
            movieTitle: movie.title,
            sourceId: source._id,
            server: source.server,
            url: source.url,
            reason: result.reason,
          });
          logger.warn('Source flagged as broken', {
            movieId: movie._id,
            sourceId: source._id,
            server: source.server,
            url: source.url,
            reason: result.reason,
          });
        } else {
          report.healthy += 1;
          logger.info('Source healthy', {
            movieId: movie._id,
            sourceId: source._id,
            server: source.server,
            url: source.url,
          });
        }
      } catch (error) {
        await updateSourceStatus(movie._id, source._id, true, timestamp);
        report.broken += 1;
        recordBroken(report, {
          movieId: movie._id,
          movieTitle: movie.title,
          sourceId: source._id,
          server: source.server,
          url: source.url,
          reason: error.code === 'ECONNABORTED' ? 'timeout' : error.message,
        });
        logger.error('Source health probe failed', {
          movieId: movie._id,
          sourceId: source._id,
          server: source.server,
          url: source.url,
          error: error.message,
          stack: error.stack,
        });
      }

      await sleep(200);
    }
  }

  logger.info('Source health scan completed', report);
  process.exit(0);
}

run().catch((error) => {
  logger.error('Source health scan failed', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});
