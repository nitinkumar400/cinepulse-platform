// ══════════════════════════════════════════
// CINE STREAM — Browse Routes
// Public, paginated, filtered catalog endpoint
// powering the Netflix-style /browse/:category pages
// ══════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const Movie   = require('../models/Movie');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');
const logger  = require('../config/logger');

const QUERY_TIMEOUT_MS = 5000;
const DEFAULT_LIMIT    = 24;
const MAX_LIMIT        = 48;

// ── Category → base filter mapping ──
// Drives `/browse/:category` URL handling.
const CATEGORY_FILTERS = {
  movies:  { category: 'movie' },
  anime:   { category: 'anime' },
  series:  { category: 'series' },
  kdrama:  { original_language: 'ko' },
  chinese: { original_language: 'zh' },
  hindi:   { original_language: 'hi' },
};

const VALID_CATEGORIES = Object.keys(CATEGORY_FILTERS);

// ── sortBy → MongoDB sort spec ──
const SORT_OPTIONS = {
  newest:  { createdAt: -1 },
  oldest:  { createdAt:  1 },
  rating:  { averageRating: -1 },
  popular: { views: -1 },
  az:      { title:  1 },
  za:      { title: -1 },
};

// ── Field projection — same shape as movies.js list endpoints ──
const BROWSE_PROJECTION = [
  'title',
  'thumbnailUrl',
  'bannerUrl',
  'logoUrl',
  'category',
  'genre',
  'releaseYear',
  'duration',
  'averageRating',
  'vote_average',
  'numRatings',
  'views',
  'isFeatured',
  'anilistId',
  'status',
  'createdAt',
  'spoken_languages',
  'subDubTag',
  'nextAiringEpisode',
  'provider',
  'tmdbId',
  'tmdb_id',
  'totalEpisodes',
  'original_language',
].join(' ');

// ── Helpers ──
function splitCsv(value) {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function parseIntOr(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatOr(value, fallback) {
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ══════════════════════════════════════════
// GET /api/browse/:category
// Public — no auth required
// ══════════════════════════════════════════
router.get('/:category', asyncHandler(async (req, res) => {
  const category = String(req.params.category || '').trim().toLowerCase();
  const baseFilter = CATEGORY_FILTERS[category];

  if (!baseFilter) {
    return sendError(res, new Error('Unknown category'), {
      status: 400,
      code: 'INVALID_CATEGORY',
      message: `Unknown category. Valid values: ${VALID_CATEGORIES.join(', ')}`,
    });
  }

  // ── Pagination ──
  const page  = Math.max(1, parseIntOr(req.query.page, 1));
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseIntOr(req.query.limit, DEFAULT_LIMIT)));
  const skip  = (page - 1) * limit;

  // ── Sort ──
  const sortKey = String(req.query.sortBy || '').trim();
  const sortBy  = SORT_OPTIONS[sortKey] || SORT_OPTIONS.newest;

  // ── Build filter starting from category mapping ──
  const filter = { ...baseFilter };

  // Genre — comma-separated, case-insensitive regex match
  const genres = splitCsv(req.query.genre);
  if (genres.length) {
    filter.genre = { $in: genres.map((g) => new RegExp(`^${g}$`, 'i')) };
  }

  // Year range
  const yearMin = parseIntOr(req.query.yearMin, null);
  const yearMax = parseIntOr(req.query.yearMax, null);
  if (yearMin !== null || yearMax !== null) {
    filter.releaseYear = {};
    if (yearMin !== null) filter.releaseYear.$gte = yearMin;
    if (yearMax !== null) filter.releaseYear.$lte = yearMax;
  }

  // Rating range
  const ratingMin = parseFloatOr(req.query.ratingMin, null);
  const ratingMax = parseFloatOr(req.query.ratingMax, null);
  if (ratingMin !== null || ratingMax !== null) {
    filter.averageRating = {};
    if (ratingMin !== null) filter.averageRating.$gte = ratingMin;
    if (ratingMax !== null) filter.averageRating.$lte = ratingMax;
  }

  // Language — comma-separated. For kdrama/chinese/hindi categories the base
  // filter already pins original_language; an explicit `language` param
  // overrides for cases where the operator wants finer control.
  const languages = splitCsv(req.query.language).map((l) => l.toLowerCase());
  if (languages.length) {
    filter.original_language = { $in: languages };
  }

  // Status — comma-separated
  const statuses = splitCsv(req.query.status);
  if (statuses.length) {
    filter.status = { $in: statuses };
  }

  // Sub/Dub — only meaningful for the anime category
  const subDub = String(req.query.subDub || '').trim().toLowerCase();
  if (category === 'anime' && (subDub === 'subbed' || subDub === 'dubbed')) {
    if (subDub === 'dubbed') {
      filter.subDubTag = 'Dubbed';
    } else {
      // Subbed: explicit "Subbed" or anything that isn't "Dubbed"
      // (covers null / missing tags per Requirement 16.2).
      filter.subDubTag = { $ne: 'Dubbed' };
    }
  }

  // Free-text search across title + description
  const q = String(req.query.q || '').trim();
  if (q) {
    const regex = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$and = [
      ...(filter.$and || []),
      { $or: [{ title: regex }, { description: regex }] },
    ];
  }

  try {
    const [total, items] = await Promise.all([
      Movie.countDocuments(filter).maxTimeMS(QUERY_TIMEOUT_MS),
      Movie.find(filter)
        .sort(sortBy)
        .skip(skip)
        .limit(limit)
        .lean()
        .select(BROWSE_PROJECTION)
        .maxTimeMS(QUERY_TIMEOUT_MS),
    ]);

    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const hasMore    = page < totalPages;

    return sendSuccess(res, {
      items,
      total,
      page,
      totalPages,
      hasMore,
    }, {
      message: 'Browse results loaded',
    });
  } catch (error) {
    logger.error('GET /browse/:category error', {
      error: error.message,
      category,
      query: req.query,
    });

    // Graceful degradation on MongoDB query timeouts (mirrors movies.js)
    if (error?.code === 50 || /maxTimeMS/i.test(error?.message || '')) {
      return res.status(200).json({
        success: true,
        message: 'Browse is taking longer than expected. Please try again.',
        items: [],
        total: 0,
        page,
        totalPages: 0,
        hasMore: false,
        degraded: true,
        meta: {},
        error: null,
      });
    }

    return sendError(res, error, {
      status: 500,
      code: 'BROWSE_QUERY_FAILED',
      message: 'Failed to load browse results',
    });
  }
}));

module.exports = router;
