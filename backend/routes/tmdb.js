const express = require('express');

const Movie = require('../models/Movie');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');
const { fetchList, fetchDetails, normalizeRoutePayload, buildMovieDocument } = require('../services/tmdbService');

const router = express.Router();
const importJobs = new Map();
const inflightImports = new Map();

async function markImported(items) {
  const ids = items.map((item) => item.tmdbId).filter(Boolean);
  const existing = await Movie.find({ tmdbId: { $in: ids } }).select('tmdbId');
  const imported = new Set(existing.map((movie) => movie.tmdbId));
  return items.map((item) => ({ ...item, alreadyImported: imported.has(item.tmdbId) }));
}

async function upsertTmdbMovie(tmdbId, type, uploadedBy) {
  const numericTmdbId = parseInt(tmdbId, 10);
  const existing = await Movie.findOne({ tmdbId: numericTmdbId });
  if (existing) {
    return {
      status: 'skipped',
      movie: existing,
      title: existing.title,
      message: `"${existing.title}" already imported`,
    };
  }

  const lockKey = `${type}:${numericTmdbId}`;
  if (inflightImports.has(lockKey)) {
    return inflightImports.get(lockKey);
  }

  const task = (async () => {
    const secondCheck = await Movie.findOne({ tmdbId: numericTmdbId });
    if (secondCheck) {
      return {
        status: 'skipped',
        movie: secondCheck,
        title: secondCheck.title,
        message: `"${secondCheck.title}" already imported`,
      };
    }

    const details = await fetchDetails(numericTmdbId, type);
    const payload = buildMovieDocument(details, type, uploadedBy);

    try {
      const movie = await Movie.create(payload);
      return {
        status: 'imported',
        movie,
        title: movie.title,
        message: `"${movie.title}" imported successfully!`,
      };
    } catch (error) {
      if (error.code === 11000) {
        const dupe = await Movie.findOne({ tmdbId: payload.tmdbId });
        return {
          status: 'skipped',
          movie: dupe,
          title: dupe?.title || payload.title,
          message: 'This title is already imported',
        };
      }
      throw error;
    }
  })();

  inflightImports.set(lockKey, task);

  try {
    return await task;
  } finally {
    inflightImports.delete(lockKey);
  }
}

async function handleListRequest(res, type, mode, params, message) {
  const raw = await fetchList(type, mode, params);
  const normalized = normalizeRoutePayload(raw);
  normalized.results = await markImported(normalized.results);

  return sendSuccess(res, normalized, {
    message,
    meta: {
      source: 'tmdb',
      mode,
      type,
    },
  });
}

function runBulkImportJob(jobId, items, userId) {
  const job = importJobs.get(jobId);
  if (!job) return;

  (async () => {
    const results = { imported: [], skipped: [], failed: [] };

    for (const item of items) {
      try {
        const result = await upsertTmdbMovie(item.tmdbId, item.type || 'movie', userId);
        if (result.status === 'imported') results.imported.push(result.title);
        if (result.status === 'skipped') results.skipped.push(result.title);
      } catch (error) {
        results.failed.push(`ID:${item.tmdbId} - ${error.message}`);
      }

      job.processed += 1;
      job.progress = Math.round((job.processed / job.total) * 100);
      job.results = results;
      job.updatedAt = new Date();
    }

    job.status = 'completed';
    job.finishedAt = new Date();
  })().catch((error) => {
    job.status = 'failed';
    job.error = error.message;
    job.updatedAt = new Date();
  });
}

router.get('/search', protect, adminOnly, asyncHandler(async (req, res) => {
  const query = String(req.query.q || '').trim();
  const type = req.query.type === 'tv' ? 'tv' : 'movie';

  if (!query) {
    return sendError(res, new Error('Search query required'), {
      status: 400,
      code: 'TMDB_SEARCH_QUERY_REQUIRED',
    });
  }

  return handleListRequest(
    res,
    type,
    'search',
    {
      query,
      page: parseInt(req.query.page, 10) || 1,
      include_adult: false,
      language: 'en-US',
    },
    'TMDb search loaded'
  );
}));

router.get('/trending', protect, adminOnly, asyncHandler(async (req, res) => {
  const type = ['movie', 'tv', 'all'].includes(req.query.type) ? req.query.type : 'movie';
  const time = ['day', 'week'].includes(req.query.time) ? req.query.time : 'week';

  return handleListRequest(
    res,
    type,
    'trending',
    {
      page: parseInt(req.query.page, 10) || 1,
      time,
    },
    'TMDb trending titles loaded'
  );
}));

router.get('/popular', protect, adminOnly, asyncHandler(async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';

  return handleListRequest(
    res,
    type,
    'popular',
    {
      page: parseInt(req.query.page, 10) || 1,
      language: 'en-US',
      region: req.query.region || '',
      with_networks: req.query.network || '',
    },
    'TMDb popular titles loaded'
  );
}));

router.get('/top-rated', protect, adminOnly, asyncHandler(async (req, res) => {
  const type = req.query.type === 'tv' ? 'tv' : 'movie';

  return handleListRequest(
    res,
    type,
    'top-rated',
    {
      page: parseInt(req.query.page, 10) || 1,
      language: 'en-US',
      genre: req.query.genre || '',
    },
    'TMDb top rated titles loaded'
  );
}));

router.post('/import', protect, adminOnly, asyncHandler(async (req, res) => {
  const tmdbId = parseInt(req.body.tmdbId, 10);
  const type = req.body.type === 'tv' ? 'tv' : 'movie';

  if (!tmdbId) {
    return sendError(res, new Error('TMDb ID required'), {
      status: 400,
      code: 'TMDB_ID_REQUIRED',
    });
  }

  const result = await upsertTmdbMovie(tmdbId, type, req.user._id);

  return sendSuccess(res, {
    movie: result.movie,
    imported: result.status === 'imported',
  }, {
    status: result.status === 'imported' ? 201 : 200,
    message: result.message,
    meta: {
      source: 'tmdb',
      duplicate: result.status === 'skipped',
    },
  });
}));

router.post('/bulk-import', protect, adminOnly, asyncHandler(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!items.length) {
    return sendError(res, new Error('No items provided'), {
      status: 400,
      code: 'TMDB_BULK_EMPTY',
    });
  }

  if (items.length > 50) {
    return sendError(res, new Error('Max 50 items per request'), {
      status: 400,
      code: 'TMDB_BULK_LIMIT',
    });
  }

  const jobId = `tmdb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const job = {
    id: jobId,
    status: 'running',
    total: items.length,
    processed: 0,
    progress: 0,
    results: { imported: [], skipped: [], failed: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  importJobs.set(jobId, job);
  runBulkImportJob(jobId, items, req.user._id);

  return sendSuccess(res, {
    jobId,
    status: job.status,
    total: job.total,
  }, {
    status: 202,
    message: 'Bulk import started',
    meta: {
      async: true,
    },
  });
}));

router.get('/bulk-import/:jobId', protect, adminOnly, asyncHandler(async (req, res) => {
  const job = importJobs.get(req.params.jobId);
  if (!job) {
    return sendError(res, new Error('Import job not found'), {
      status: 404,
      code: 'TMDB_IMPORT_JOB_NOT_FOUND',
    });
  }

  return sendSuccess(res, job, {
    message: 'Bulk import status loaded',
  });
}));

module.exports = router;
