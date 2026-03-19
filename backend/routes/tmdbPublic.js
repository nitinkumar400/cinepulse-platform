const express = require('express');

const Movie = require('../models/Movie');
const { fetchList, normalizeRoutePayload } = require('../services/tmdbService');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

const router = express.Router();

async function markImported(items) {
  const ids = items.map((item) => item.tmdbId).filter(Boolean);
  const existing = await Movie.find({ tmdbId: { $in: ids } }).select('tmdbId');
  const imported = new Set(existing.map((movie) => movie.tmdbId));
  return items.map((item) => ({ ...item, alreadyImported: imported.has(item.tmdbId) }));
}

router.get('/search', asyncHandler(async (req, res) => {
  const query = String(req.query.query || '').trim();
  const type = req.query.type === 'tv' ? 'tv' : 'movie';

  if (!query) {
    return sendError(res, new Error('Search query required'), {
      status: 400,
      code: 'TMDB_PUBLIC_QUERY_REQUIRED',
    });
  }

  const raw = await fetchList(type, 'search', {
    query,
    page: parseInt(req.query.page, 10) || 1,
    include_adult: false,
    language: 'en-US',
  });

  const payload = normalizeRoutePayload(raw);
  payload.results = await markImported(payload.results);

  return sendSuccess(res, payload, {
    message: 'Public TMDb search loaded',
    meta: {
      source: 'tmdb',
      public: true,
      type,
    },
  });
}));

module.exports = router;
