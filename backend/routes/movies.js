// ══════════════════════════════════════════
// CINE STREAM — Movies Routes
// ══════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const mongoose = require('mongoose');
const Movie    = require('../models/Movie');
const { protect, adminOnly, optionalProtect } = require('../middleware/authMiddleware');
const {
  validateSourcePayload,
  validateSourceReplacePayload,
  validateSourceOrderPayload,
} = require('../middleware/requestValidator');
const { inspectPlaybackSource, inferSourceType } = require('../middleware/sourceQualityCheck');
const { getPersonalizedRecommendations, getBecauseYouWatched, getTrendingRanked } = require('../services/recommendationService');
const { sendSuccess, asyncHandler } = require('../utils/apiResponse');
const logger = require('../config/logger');

// ══════════════════════════════════════════
// CLOUDINARY SETUP
// ══════════════════════════════════════════
const {
  uploadToCloudinary,
  deleteFromCloudinary,
  mixedStorage,
} = require('../config/cloudinary');

const upload = mixedStorage;
const SEARCH_QUERY_TIMEOUT_MS = 5000;

// ══════════════════════════════════════════
// HELPER — extract Cloudinary public_id from URL
// e.g. "https://res.cloudinary.com/.../cinestream/videos/vid-123.mp4"
//   → "cinestream/videos/vid-123"
// ══════════════════════════════════════════
function extractPublicId(url = '') {
  if (!url) return null;
  try {
    const parts    = url.split('/');
    const upload   = parts.indexOf('upload');
    if (upload === -1) return null;
    // skip version segment (v1234567) if present
    const start    = /^v\d+$/.test(parts[upload + 1]) ? upload + 2 : upload + 1;
    const filePart = parts.slice(start).join('/');
    // strip file extension
    return filePart.replace(/\.[^/.]+$/, '');
  } catch {
    return null;
  }
}

function normalizeSourcePayload(body = {}, existingSource = null) {
  const requestedServer = String(body.server || existingSource?.server || '').trim().toLowerCase();
  const incomingUrl = String(body.url || existingSource?.url || '').trim();
  const quality = String(body.quality || existingSource?.quality || 'HD').trim();
  const incomingMeta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  const existingMeta = existingSource?.meta || {};
  let server = requestedServer === 'local' || requestedServer === 'storage' ? 'upload' : requestedServer;
  let type = server === 'upload' ? 'storage' : server;
  let id = '';
  let path = '';
  let url = incomingUrl;
  let sourceType = inferSourceType(url, body.sourceType || existingSource?.sourceType || server);

  if (type === 'youtube') {
    id = extractYouTubeId(url);
    url = buildCanonicalSourceUrl('youtube', id);
    server = 'youtube';
    sourceType = 'youtube';
  } else if (type === 'dailymotion') {
    id = extractDailymotionId(url);
    url = buildCanonicalSourceUrl('dailymotion', id);
    server = 'dailymotion';
    sourceType = 'dailymotion';
  } else if (type === 'vimeo') {
    id = extractVimeoId(url);
    url = buildCanonicalSourceUrl('vimeo', id);
    server = 'vimeo';
    sourceType = 'vimeo';
  } else {
    type = 'storage';
    path = String(body.path || existingSource?.path || url).trim();
    url = buildCanonicalSourceUrl('storage', '', path);
    server = 'upload';
    sourceType = 'local';
  }

  return {
    type,
    id,
    path,
    sourceType,
    server,
    url,
    quality,
    meta: {
      title: String(incomingMeta.title ?? existingMeta.title ?? '').trim(),
      duration_seconds: Math.max(0, parseInt(incomingMeta.duration_seconds ?? existingMeta.duration_seconds, 10) || 0),
      thumbnail: String(incomingMeta.thumbnail ?? existingMeta.thumbnail ?? '').trim(),
      canonical_id: String(incomingMeta.canonical_id ?? existingMeta.canonical_id ?? id).trim(),
    },
    is_broken: Boolean(body.is_broken ?? existingSource?.is_broken ?? false),
    last_checked: body.last_checked || existingSource?.last_checked || null,
  };
}

function extractYouTubeId(url = '') {
  const match = String(url || '').trim().match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  return match ? match[1] : '';
}

function extractVimeoId(url = '') {
  const match = String(url || '').trim().match(/vimeo\.com\/(\d+)/i);
  return match ? match[1] : '';
}

function extractDailymotionId(url = '') {
  const match = String(url || '').trim().match(/(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([^_?&/]+)/i);
  return match ? match[1] : '';
}

function buildCanonicalSourceUrl(type = '', id = '', path = '') {
  if (type === 'youtube' && id) return `https://youtu.be/${id}`;
  if (type === 'dailymotion' && id) return `https://dai.ly/${id}`;
  if (type === 'vimeo' && id) return `https://vimeo.com/${id}`;
  if (type === 'storage') return String(path || '').trim();
  return '';
}

function normalizeIncomingSources(rawSources = [], storagePath = '') {
  const seen = new Set();
  const normalized = [];

  if (storagePath) {
    const trimmedPath = String(storagePath).trim();
    if (trimmedPath) {
      const key = `storage:${trimmedPath}`;
      seen.add(key);
      normalized.push({
        type: 'storage',
        id: '',
        path: trimmedPath,
        sourceType: 'local',
        server: 'upload',
        url: trimmedPath,
        quality: 'HD',
        meta: {
          canonical_id: '',
        },
      });
    }
  }

  for (const source of Array.isArray(rawSources) ? rawSources : []) {
    const requestedType = String(source?.type || source?.server || source?.sourceType || '').trim().toLowerCase();
    let type = requestedType;
    let id = String(source?.id || '').trim();
    let path = String(source?.path || '').trim();

    if (type === 'youtube') id = id || extractYouTubeId(source?.url);
    if (type === 'dailymotion') id = id || extractDailymotionId(source?.url);
    if (type === 'vimeo') id = id || extractVimeoId(source?.url);
    if (type === 'local' || type === 'upload') type = 'storage';

    const dedupeKey = type === 'storage' ? `storage:${path}` : `${type}:${id}`;
    if (!type || seen.has(dedupeKey)) continue;
    if (type === 'storage' && !path) continue;
    if (type !== 'storage' && !id) continue;

    seen.add(dedupeKey);
    normalized.push({
      type,
      id: type === 'storage' ? '' : id,
      path: type === 'storage' ? path : '',
      sourceType: type === 'storage' ? 'local' : type,
      server: type === 'storage' ? 'upload' : type,
      url: buildCanonicalSourceUrl(type, id, path),
      quality: String(source?.quality || 'HD').trim() || 'HD',
      meta: {
        canonical_id: type === 'storage' ? '' : id,
      },
    });
  }

  return normalized;
}

function parseStructuredSources(body = {}, storagePath = '') {
  try {
    const raw = typeof body.sources === 'string'
      ? JSON.parse(body.sources || '[]')
      : Array.isArray(body.sources)
        ? body.sources
        : [];

    return normalizeIncomingSources(raw, storagePath);
  } catch {
    return normalizeIncomingSources([], storagePath);
  }
}





// ══════════════════════════════════════════
// GET ALL MOVIES
// GET /api/movies
// Public — no auth required
// ══════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const {
      category  = '',
      search    = '',
      genre     = '',
      original_language = '',
      tmdb_genre_id = '',
      year      = '',
      yearMin   = '',
      yearMax   = '',
      minRating = '',
      featured  = '',
      sort      = 'newest',
      page      = 1,
      limit     = 20,
    } = req.query;

    const filter = {};

    if (search.trim()) {
      filter.$or = [
        { title:       { $regex: search.trim(), $options: 'i' } },
        { description: { $regex: search.trim(), $options: 'i' } },
        { category:    { $regex: search.trim(), $options: 'i' } },
        { genre:       { $in: [new RegExp(search.trim(), 'i')] } },
        { director:    { $regex: search.trim(), $options: 'i' } },
        { studio:      { $regex: search.trim(), $options: 'i' } },
        { cast:        { $in: [new RegExp(search.trim(), 'i')] } },
      ];
    }

    if (category)            filter.category      = category;
    if (genre)               filter.genre         = { $in: [new RegExp(genre, 'i')] };
    if (original_language)   filter.original_language = String(original_language).trim().toLowerCase();
    if (tmdb_genre_id) {
      const parsedGenreId = parseInt(tmdb_genre_id, 10);
      if (Number.isFinite(parsedGenreId)) {
        filter.tmdb_genre_ids = parsedGenreId;
      }
    }
    if (year) {
      filter.releaseYear = parseInt(year);
    } else if (yearMin || yearMax) {
      filter.releaseYear = {};
      if (yearMin) filter.releaseYear.$gte = parseInt(yearMin, 10);
      if (yearMax) filter.releaseYear.$lte = parseInt(yearMax, 10);
    }
    if (minRating)           filter.averageRating = { $gte: parseFloat(minRating) };
    
    // Strict Dark Catalog: Homepage lockdown.
    // Default to isFeatured: true unless it's a search query or requested otherwise.
    if (featured === 'true') {
      filter.isFeatured = true;
    } else if (featured === 'false') {
      filter.isFeatured = false;
    } else if (featured === 'all') {
      // open catalog access
    } else {
      if (!search.trim()) {
        filter.isFeatured = true;
      }
    }

    const sortOptions = {
      newest:        { createdAt: -1 },
      oldest:        { createdAt:  1 },
      views:         { views: -1 },
      rating:        { averageRating: -1 },
      titleAZ:       { title:  1 },
      titleZA:       { title: -1 },
      most_viewed:   { views: -1 },
      highest_rated: { averageRating: -1 },
    };
    const sortBy = sortOptions[sort] || sortOptions.newest;

    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNumber - 1) * limitNumber;

    const total = await Movie.countDocuments(filter).maxTimeMS(SEARCH_QUERY_TIMEOUT_MS);
    const movies = await Movie.find(filter)
      .sort(sortBy)
      .skip(skip)
      .limit(limitNumber)
      .maxTimeMS(SEARCH_QUERY_TIMEOUT_MS)
      .lean()
      .select('title thumbnailUrl bannerUrl logoUrl category genre releaseYear duration averageRating vote_average numRatings views isFeatured anilistId status createdAt spoken_languages subDubTag nextAiringEpisode provider tmdbId tmdb_id totalEpisodes');

    return res.json({
      movies,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / limitNumber),
        limit: limitNumber,
      },
    });

  } catch (error) {
    logger.error('GET /movies error', {
      error: error.message,
      query: req.query,
    });
    if (error?.code === 50 || /maxTimeMS/i.test(error?.message || '')) {
      return res.status(200).json({
        movies: [],
        pagination: {
          total: 0,
          page: Math.max(1, parseInt(req.query.page, 10) || 1),
          pages: 0,
          limit: Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20)),
        },
        degraded: true,
        message: 'Search is taking longer than expected. Please try again.',
      });
    }

    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// ADVANCED SEARCH
// GET /api/movies/search
// ⚠️ Must be BEFORE /:id route
// Public — no auth required
// ══════════════════════════════════════════
router.get('/search', async (req, res) => {
  try {
    const {
      q         = '',
      sort      = 'newest',
      page      = 1,
      limit     = 20,
    } = req.query;

    const filter = q.trim()
      ? { title: { $regex: q.trim(), $options: 'i' } }
      : {};

    const sortOptions = {
      newest:        { createdAt: -1 },
      oldest:        { createdAt:  1 },
      most_viewed:   { views: -1 },
      highest_rated: { averageRating: -1 },
      title_az:      { title:  1 },
      title_za:      { title: -1 },
    };
    const sortBy = sortOptions[sort] || sortOptions.newest;
    const pageNumber = Math.max(1, parseInt(page, 10) || 1);
    const limitNumber = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNumber - 1) * limitNumber;
    const total = await Movie.countDocuments(filter).maxTimeMS(SEARCH_QUERY_TIMEOUT_MS);
    const movies = await Movie.find(filter)
      .sort(sortBy)
      .skip(skip)
      .limit(limitNumber)
      .maxTimeMS(SEARCH_QUERY_TIMEOUT_MS)
      .lean()
      .select('title thumbnailUrl bannerUrl logoUrl category genre releaseYear duration averageRating vote_average numRatings views createdAt spoken_languages subDubTag nextAiringEpisode provider tmdbId tmdb_id totalEpisodes');

    res.json({
      movies,
      pagination: {
        total,
        page: pageNumber,
        pages: Math.ceil(total / limitNumber),
        limit: limitNumber,
      },
      query: { q, sort },
    });

  } catch (error) {
    if (error?.code === 50 || /maxTimeMS/i.test(error?.message || '')) {
      return res.status(200).json({
        movies: [],
        pagination: {
          total: 0,
          page: Math.max(1, parseInt(req.query.page, 10) || 1),
          pages: 0,
          limit: Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20)),
        },
        query: {
          q: req.query.q || '',
          sort: req.query.sort || 'newest',
        },
        degraded: true,
        message: 'Search is taking longer than expected. Please try again.',
      });
    }

    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET TRENDING
// GET /api/movies/trending
// ⚠️ Must be BEFORE /:id route
// Public — no auth required
// ══════════════════════════════════════════
router.get('/trending', asyncHandler(async (req, res) => {
  const category = String(req.query.category || '').trim();
  const limit = Math.min(20, Math.max(1, parseInt(req.query.limit, 10) || 10));
  const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
  const currentYear = new Date().getFullYear();
  const filter = {
    createdAt: { $gte: sevenDaysAgo },
    releaseYear: { $gte: currentYear - 1 },
    isFeatured: true,
    ...(category ? { category } : {}),
  };

  let trending = await Movie.find(filter)
    .sort({ averageRating: -1, views: -1, createdAt: -1 })
    .limit(limit)
    .select('title thumbnailUrl bannerUrl logoUrl category genre releaseYear duration averageRating vote_average views createdAt spoken_languages subDubTag nextAiringEpisode provider tmdbId tmdb_id totalEpisodes')
    .lean();

  if (!trending.length) {
    trending = await Movie.find({
      isFeatured: true,
      ...(category ? { category } : {}),
      releaseYear: { $gte: currentYear - 1 },
    })
      .sort({ averageRating: -1, views: -1, createdAt: -1 })
      .limit(limit)
      .select('title thumbnailUrl bannerUrl logoUrl category genre releaseYear duration averageRating vote_average views createdAt spoken_languages subDubTag nextAiringEpisode provider tmdbId tmdb_id totalEpisodes')
      .lean();
  }

  const rankedTrending = trending.map((movie, index) => ({
    ...movie,
    trendingRank: index + 1,
  }));

  return sendSuccess(res, { trending: rankedTrending }, {
    message: 'Trending titles loaded',
  });
}));

// ══════════════════════════════════════════
// GET PERSONALIZED RECOMMENDATIONS
// POST /api/movies/personalized
// ⚠️ Must be BEFORE /:id route
// ══════════════════════════════════════════
router.post('/personalized', optionalProtect, asyncHandler(async (req, res) => {
  const limit = parseInt(req.body.limit, 10) || 12;
  const watchedIds = Array.isArray(req.body.watchedIds) ? req.body.watchedIds : [];

  if (req.user?._id) {
    const payload = await getPersonalizedRecommendations(req.user._id, limit);
    return sendSuccess(res, payload, { message: 'Personalized recommendations loaded' });
  }

  if (!watchedIds.length) {
    const popular = await getTrendingRanked(limit);
    return sendSuccess(res, {
      recommendations: popular,
      type: 'popular',
      basedOn: { genres: [], categories: [] },
    }, {
      message: 'Popular recommendations loaded',
    });
  }

  const watchedMovies = await Movie.find({ _id: { $in: watchedIds } }).select('genre category');
  const genreSet = new Set();
  const categorySet = new Set();

  watchedMovies.forEach((movie) => {
    (movie.genre || []).forEach((genre) => genreSet.add(genre));
    if (movie.category) categorySet.add(movie.category);
  });

  const recommendations = await Movie.find({
    _id: { $nin: watchedIds },
    $or: [
      { genre: { $in: [...genreSet] } },
      { category: { $in: [...categorySet] } },
    ],
  })
    .sort({ averageRating: -1, views: -1 })
    .limit(limit)
    .select('title thumbnailUrl bannerUrl logoUrl category genre releaseYear averageRating views duration _id');

  return sendSuccess(res, {
    recommendations,
    type: 'personalized',
    basedOn: {
      genres: [...genreSet].slice(0, 5),
      categories: [...categorySet].slice(0, 3),
    },
  }, {
    message: 'Personalized recommendations loaded',
  });
}));

// ══════════════════════════════════════════
// GET BROKEN SOURCES
// GET /api/movies/sources/broken
// Admin only
// ══════════════════════════════════════════
router.get('/sources/broken', protect, adminOnly, asyncHandler(async (req, res) => {
  const movies = await Movie.find({ 'sources.is_broken': true })
    .select('title sources updatedAt')
    .lean();

  const sources = movies.flatMap((movie) =>
    (movie.sources || [])
      .filter((source) => source.is_broken)
      .map((source, index) => ({
        movieId: movie._id,
        movieTitle: movie.title,
        sourceId: source._id,
        server: source.server,
        url: source.url,
        quality: source.quality || 'HD',
        meta: source.meta || {},
        is_broken: true,
        last_checked: source.last_checked || null,
        priority: index,
      }))
  );

  return res.json({
    message: 'Broken sources loaded',
    sources,
  });
}));

// ══════════════════════════════════════════
// GET SINGLE MOVIE
// GET /api/movies/:id
// ✅ FIX: Removed `protect` — public can view movie details
// ✅ FIX: View count only increments for logged-in users
// ⚠️ Must be AFTER all named routes
// ══════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: 'Invalid movie ID format' });
    }

    // Only increment view if user is logged in (optional auth)
    let movie;
    const authHeader = req.headers.authorization;
    const isLoggedIn = authHeader && authHeader.startsWith('Bearer ');

    if (isLoggedIn) {
      movie = await Movie.findByIdAndUpdate(
        req.params.id,
        { $inc: { views: 1 } },
        { new: true }
      ).populate('uploadedBy', 'username');
    } else {
      movie = await Movie.findById(req.params.id)
        .populate('uploadedBy', 'username');
    }

    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    const movieObject = movie.toObject();
    movieObject.sourceType = movie.sourceType || inferSourceType(movie.videoUrl);
    movieObject.playback = inspectPlaybackSource({
      videoUrl: movie.videoUrl,
      sourceType: movie.sourceType,
    });

    res.json(movieObject);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// ADD SOURCE TO MOVIE
// POST /api/movies/:id/source
// Admin only
// ══════════════════════════════════════════
router.post('/:id/source', protect, adminOnly, validateSourcePayload, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const sourcePayload = normalizeSourcePayload(req.body);
    const { server, url, meta } = sourcePayload;

    const canonicalId = meta?.canonical_id || '';
    const alreadyExists = (movie.sources || []).some((source) =>
      (source.server === server && source.url === url) ||
      (canonicalId && source.server === server && source.meta?.canonical_id === canonicalId)
    );

    if (alreadyExists) {
      return res.json({
        message: 'Source already exists',
        sources: movie.sources,
      });
    }

    movie.sources.push(sourcePayload);
    await movie.save();

    return res.status(201).json({
      message: 'Source added successfully',
      sources: movie.sources,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to add source', error: error.message });
  }
});

// ══════════════════════════════════════════
// UPDATE SOURCE
// PUT /api/movies/:id/source/:sourceId
// Admin only
// ══════════════════════════════════════════
router.put('/:id/source/:sourceId', protect, adminOnly, validateSourceReplacePayload, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const source = movie.sources.id(req.params.sourceId);
    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    const updatedSource = normalizeSourcePayload(req.body, source);
    const duplicate = movie.sources.some((item) =>
      String(item._id) !== String(source._id) &&
      (
        (item.server === updatedSource.server && item.url === updatedSource.url) ||
        (
          updatedSource.meta?.canonical_id &&
          item.server === updatedSource.server &&
          item.meta?.canonical_id === updatedSource.meta.canonical_id
        )
      )
    );

    if (duplicate) {
      return res.status(409).json({
        message: 'Duplicate source detected',
        error: 'Another source already uses this canonical URL or id',
      });
    }

    source.server = updatedSource.server;
    source.url = updatedSource.url;
    source.quality = updatedSource.quality;
    source.meta = updatedSource.meta;
    source.is_broken = false;
    source.last_checked = new Date();

    await movie.save();

    return res.json({
      message: 'Source updated successfully',
      sources: movie.sources,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update source', error: error.message });
  }
});

// ══════════════════════════════════════════
// DELETE SOURCE
// DELETE /api/movies/:id/source/:sourceId
// Admin only
// ══════════════════════════════════════════
router.delete('/:id/source/:sourceId', protect, adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const source = movie.sources.id(req.params.sourceId);
    if (!source) {
      return res.status(404).json({ message: 'Source not found' });
    }

    source.deleteOne();
    await movie.save();

    return res.json({
      message: 'Source deleted successfully',
      sources: movie.sources,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete source', error: error.message });
  }
});

// ══════════════════════════════════════════
// REORDER SOURCES
// PUT /api/movies/:id/source-order
// Admin only
// ══════════════════════════════════════════
router.put('/:id/source-order', protect, adminOnly, validateSourceOrderPayload, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const orderedSourceIds = req.body.orderedSourceIds.map((value) => String(value));
    const existingSourceIds = movie.sources.map((source) => String(source._id));

    if (orderedSourceIds.length !== existingSourceIds.length) {
      return res.status(400).json({
        message: 'Invalid source order payload',
        error: 'orderedSourceIds must include every source exactly once',
      });
    }

    const missing = existingSourceIds.filter((id) => !orderedSourceIds.includes(id));
    const extra = orderedSourceIds.filter((id) => !existingSourceIds.includes(id));
    if (missing.length || extra.length) {
      return res.status(400).json({
        message: 'Invalid source order payload',
        error: 'orderedSourceIds must match the current movie sources',
      });
    }

    const sourceMap = new Map(movie.sources.map((source) => [String(source._id), source.toObject()]));
    movie.sources = orderedSourceIds.map((id) => sourceMap.get(id));
    await movie.save();

    return res.json({
      message: 'Source order updated successfully',
      sources: movie.sources,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reorder sources', error: error.message });
  }
});

// ══════════════════════════════════════════
// UPLOAD MOVIE
// POST /api/movies
// Admin only
// ══════════════════════════════════════════
router.post('/',
  protect, adminOnly,
  upload.fields([
    { name: 'video',     maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
    { name: 'banner',    maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const externalVideoUrl = String(req.body.videoUrl || '').trim();
      const requestedSourceType = String(req.body.sourceType || '').trim().toLowerCase();
      const incomingSources = parseStructuredSources(req.body);
      const primaryExternalSource = incomingSources.find((source) => source.server !== 'upload') || null;
      const sourceType = primaryExternalSource?.sourceType || inferSourceType(externalVideoUrl, requestedSourceType);
      const isExternalSource = !req.files?.video && (
        (Boolean(externalVideoUrl) && sourceType !== 'local') ||
        Boolean(primaryExternalSource)
      );

      const {
        title, description, category,
        genre, releaseYear, duration,
        rating, language, studio,
        director, cast, tags,
        isFeatured, trailerUrl,
        thumbnailUrl: externalThumbnailUrl,
      } = req.body;

      const parseArr = (val) =>
        Array.isArray(val) ? val
        : typeof val === 'string' && val.trim()
          ? val.split(',').map(v => v.trim()).filter(Boolean)
          : [];

      if (isExternalSource) {
        if (!title?.trim()) {
          return res.status(400).json({ message: 'Title is required' });
        }

        const primaryVideoUrl = primaryExternalSource?.url || externalVideoUrl;
        const normalizedSources = parseStructuredSources(req.body);

        const movie = await Movie.create({
          title:       title.trim(),
          description: description?.trim(),
          category,
          genre:       parseArr(genre),
          cast:        parseArr(cast),
          tags:        parseArr(tags),
          releaseYear: parseInt(releaseYear) || new Date().getFullYear(),
          duration:    parseInt(duration) || 0,
          rating:      rating || 'PG',
          language:    language || 'English',
          studio:      studio || '',
          director:    director || '',
          trailerUrl:  trailerUrl || '',
          sourceType:  primaryExternalSource?.sourceType || sourceType,
          videoUrl:    primaryVideoUrl,
          thumbnailUrl: String(externalThumbnailUrl || '').trim(),
          bannerUrl:    String(externalThumbnailUrl || '').trim(),
          sources:     normalizedSources,
          isFeatured:  isFeatured === 'true',
          uploadedBy:  req.user._id,
        });

        return res.status(201).json({ message: 'Movie uploaded successfully!', movie });
      }

      if (!req.files?.video || !req.files?.thumbnail)
        return res.status(400).json({ message: 'Video and thumbnail are required' });

      // Upload to Cloudinary
      const [videoResult, thumbResult] = await Promise.all([
        uploadToCloudinary(req.files.video[0].buffer, {
          folder:        'cinestream/videos',
          resource_type: 'video',
          public_id:     `vid-${Date.now()}`,
        }),
        uploadToCloudinary(req.files.thumbnail[0].buffer, {
          folder:        'cinestream/images',
          resource_type: 'image',
          public_id:     `thumb-${Date.now()}`,
        }),
      ]);

      const videoUrl     = videoResult.secure_url;
      const thumbnailUrl = thumbResult.secure_url;
      const normalizedSources = parseStructuredSources(req.body, videoUrl);

      let bannerUrl = thumbnailUrl;
      if (req.files.banner) {
        const bannerResult = await uploadToCloudinary(req.files.banner[0].buffer, {
          folder:        'cinestream/images',
          resource_type: 'image',
          public_id:     `banner-${Date.now()}`,
        });
        bannerUrl = bannerResult.secure_url;
      }

      const movie = await Movie.create({
        title:       title?.trim(),
        description: description?.trim(),
        category,
        genre:       parseArr(genre),
        cast:        parseArr(cast),
        tags:        parseArr(tags),
        releaseYear: parseInt(releaseYear) || new Date().getFullYear(),
        duration:    parseInt(duration)    || 0,
        rating:      rating    || 'PG',
        language:    language  || 'English',
        studio:      studio    || '',
        director:    director  || '',
        trailerUrl:  trailerUrl || '',
        sourceType:  'local',
        videoUrl,
        thumbnailUrl,
        bannerUrl,
        sources:     normalizedSources,
        isFeatured:  isFeatured === 'true',
        uploadedBy:  req.user._id,
      });

      // Notify users (non-blocking)
      try {
        const { notifyAllUsers } = require('../notificationHelper');
        await notifyAllUsers({
          type:    'new_content',
          title:   `🎬 New ${movie.category} added!`,
          message: `"${movie.title}" is now available to watch.`,
          link:    `/pages/movie-details.html?id=${movie._id}`,
          image:   movie.thumbnailUrl,
        });
      } catch (err) {
        logger.warn('Movie notification broadcast failed', {
          error: err.message,
          movieId: movie._id,
        });
      }

      res.status(201).json({ message: 'Movie uploaded successfully!', movie });

    } catch (error) {
      console.error('[MOVIE UPLOAD FATAL]:', error);
      logger.error('Movie upload error', {
        error: error.message,
        name: error.name,
        body: {
          title: req.body?.title,
          category: req.body?.category,
          sourceType: req.body?.sourceType,
          videoUrl: req.body?.videoUrl,
          hasSources: Boolean(req.body?.sources),
        },
      });
      if (error?.name === 'ValidationError') {
        return res.status(400).json({
          message: error.message,
          errors: Object.fromEntries(
            Object.entries(error.errors || {}).map(([key, value]) => [key, value.message])
          ),
        });
      }
      res.status(500).json({ message: error.message });
    }
  }
);

// ══════════════════════════════════════════
// UPDATE MOVIE
// PUT /api/movies/:id
// Admin only
// ✅ FIX: Added trailerUrl and status to allowed fields
// ══════════════════════════════════════════
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    const allowed = [
      'title', 'description', 'category', 'genre', 'cast',
      'releaseYear', 'duration', 'rating', 'language',
      'studio', 'director', 'isFeatured', 'tags',
      'trailerUrl', 'status', 'sourceType', 'videoUrl', 'thumbnailUrl', 'logoUrl',
    ];

    allowed.forEach(field => {
      if (req.body[field] !== undefined) movie[field] = req.body[field];
    });

    if (req.body.sources !== undefined) {
      const normalizedSources = parseStructuredSources(req.body, movie.sourceType === 'local' ? movie.videoUrl : '');
      movie.sources = normalizedSources;

      if (movie.sourceType !== 'local') {
        const primaryExternalSource = normalizedSources.find((source) => source.server !== 'upload') || null;
        if (primaryExternalSource) {
          movie.sourceType = primaryExternalSource.sourceType;
          movie.videoUrl = primaryExternalSource.url;
        }
      }
    }

    await movie.save();
    res.json({ message: 'Movie updated!', movie });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// DELETE MOVIE
// DELETE /api/movies/:id
// Admin only
// ✅ FIX: Extract public_id before calling deleteFromCloudinary
// ══════════════════════════════════════════
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    // ✅ FIX: Extract public_id from Cloudinary URL first
    const videoId  = extractPublicId(movie.videoUrl);
    const thumbId  = extractPublicId(movie.thumbnailUrl);
    const bannerId = movie.bannerUrl !== movie.thumbnailUrl
      ? extractPublicId(movie.bannerUrl)
      : null;

    await Promise.all([
      videoId  ? deleteFromCloudinary(videoId,  'video') : Promise.resolve(),
      thumbId  ? deleteFromCloudinary(thumbId,  'image') : Promise.resolve(),
      bannerId ? deleteFromCloudinary(bannerId, 'image') : Promise.resolve(),
    ]);

    // Also delete subtitle files from Cloudinary
    if (movie.subtitles && movie.subtitles.length > 0) {
      await Promise.all(
        movie.subtitles.map(sub => {
          const subId = extractPublicId(sub.url);
          return subId ? deleteFromCloudinary(subId, 'raw') : Promise.resolve();
        })
      );
    }

    await movie.deleteOne();
    res.json({ message: 'Movie deleted successfully' });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// RATE MOVIE
// POST /api/movies/:id/rate
// ✅ FIX: Prevent same user rating twice
// ══════════════════════════════════════════

// In-memory rate tracking for upload burst protection
const ratedBy = new Map(); // movieId → Set of userIds

router.post('/:id/rate', protect, async (req, res) => {
  try {
    const { rating } = req.body;
    const r          = parseInt(rating);

    if (!r || r < 1 || r > 10)
      return res.status(400).json({ message: 'Rating must be 1–10' });

    const movieId = req.params.id;
    const userId  = req.user._id.toString();

    // ✅ FIX: Block duplicate ratings
    if (!ratedBy.has(movieId)) ratedBy.set(movieId, new Set());
    if (ratedBy.get(movieId).has(userId))
      return res.status(400).json({ message: 'You have already rated this' });

    const movie = await Movie.findById(movieId);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    const newTotal      = (movie.averageRating * movie.numRatings) + r;
    movie.numRatings   += 1;
    movie.averageRating = parseFloat((newTotal / movie.numRatings).toFixed(1));
    await movie.save();
    ratedBy.get(movieId).add(userId);

    res.json({
      message:       'Rating saved!',
      averageRating: movie.averageRating,
      numRatings:    movie.numRatings,
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET RECOMMENDATIONS
// GET /api/movies/:id/recommendations
// Public — no auth required
// ══════════════════════════════════════════
router.get('/:id/recommendations', asyncHandler(async (req, res) => {
  const payload = await getBecauseYouWatched(req.params.id, parseInt(req.query.limit, 10) || 12);
  return sendSuccess(res, payload, {
    message: 'Recommendations loaded',
  });
}));

router.get('/:id/more-like-this', asyncHandler(async (req, res) => {
  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const current = await Movie.findById(req.params.id).lean().select('_id genre original_language category');
  if (!current?._id) {
    return res.status(404).json({ message: 'Movie not found' });
  }

  const genreList = Array.isArray(current.genre) ? current.genre.filter(Boolean) : [];
  const language = String(current.original_language || '').trim().toLowerCase();

  const filter = {
    _id: { $ne: current._id },
    $or: [
      ...(genreList.length ? [{ genre: { $in: genreList } }] : []),
      ...(language ? [{ original_language: language }] : []),
      ...(current.category ? [{ category: current.category }] : []),
    ],
  };

  const recommendations = await Movie.find(filter)
    .sort({ averageRating: -1, views: -1, createdAt: -1 })
    .limit(limit)
    .lean()
    .select('title thumbnailUrl bannerUrl category genre releaseYear duration averageRating views original_language spoken_languages');

  return res.json({
    recommendations,
    basedOn: {
      genre: genreList.slice(0, 5),
      language: language || '',
      category: current.category || '',
    },
  });
}));

router.get('/:id/other-seasons', asyncHandler(async (req, res) => {
  const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const current = await Movie.findById(req.params.id)
    .lean()
    .select('_id title provider category franchiseKey animeSeasonNumber releaseYear averageRating thumbnailUrl');

  if (!current?._id) {
    return res.status(404).json({ message: 'Movie not found' });
  }

  const normalizedFromTitle = String(current.title || '')
    .toLowerCase()
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\bs\d+\b/gi, '')
    .replace(/[:\-–—].*$/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const baseKey = String(current.franchiseKey || normalizedFromTitle).trim().toLowerCase();
  if (!baseKey) {
    return res.json({ seasons: [] });
  }

  const seasons = await Movie.find({
    _id: { $ne: current._id },
    provider: current.provider || 'anilist',
    category: 'anime',
    $or: [
      { franchiseKey: baseKey },
      { title: { $regex: `^${baseKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, $options: 'i' } },
    ],
  })
    .sort({ animeSeasonNumber: 1, releaseYear: 1, createdAt: 1 })
    .limit(limit)
    .lean()
    .select('title thumbnailUrl releaseYear averageRating animeSeasonNumber franchiseKey provider category');

  return res.json({ seasons });
}));

// ══════════════════════════════════════════
// UPLOAD SUBTITLE
// POST /api/movies/:id/subtitles
// Admin only
// ══════════════════════════════════════════
router.post('/:id/subtitles',
  protect, adminOnly,
  upload.single('subtitle'),
  async (req, res) => {
    try {
      const movie = await Movie.findById(req.params.id);
      if (!movie) return res.status(404).json({ message: 'Movie not found' });

      if (!req.file)
        return res.status(400).json({ message: 'No subtitle file uploaded' });

      const { language, label, isDefault } = req.body;

      const result = await uploadToCloudinary(req.file.buffer, {
        folder:        'cinestream/subtitles',
        resource_type: 'raw',
        public_id:     `sub-${movie._id}-${language}-${Date.now()}`,
        format:        'vtt',
      });

      // If set as default, unset all others first
      if (isDefault === 'true') {
        movie.subtitles.forEach(s => { s.default = false; });
      }

      movie.subtitles.push({
        language: language || 'English',
        label:    label    || language || 'English',
        url:      result.secure_url,
        default:  isDefault === 'true',
      });

      await movie.save();

      res.json({ message: 'Subtitle uploaded!', subtitles: movie.subtitles });

    } catch (error) {
      logger.error('Subtitle upload error', {
        error: error.message,
        movieId: req.params.id,
      });
      res.status(500).json({ message: error.message });
    }
  }
);

// ══════════════════════════════════════════
// DELETE SUBTITLE
// DELETE /api/movies/:id/subtitles/:subId
// Admin only
// ══════════════════════════════════════════
router.delete('/:id/subtitles/:subId', protect, adminOnly, async (req, res) => {
  try {
    const movie = await Movie.findById(req.params.id);
    if (!movie) return res.status(404).json({ message: 'Movie not found' });

    const sub = movie.subtitles.id(req.params.subId);
    if (!sub)
      return res.status(404).json({ message: 'Subtitle not found' });

    // Delete from Cloudinary
    const subPublicId = extractPublicId(sub.url);
    if (subPublicId) {
      await deleteFromCloudinary(subPublicId, 'raw');
    }

    movie.subtitles = movie.subtitles.filter(
      s => s._id.toString() !== req.params.subId
    );
    await movie.save();

    res.json({ message: 'Subtitle removed', subtitles: movie.subtitles });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});
// ══════════════════════════════════════════
// UPLOAD QUALITY VARIANT
// POST /api/movies/:id/quality
// Admin uploads a 360p/720p/1080p version
// ══════════════════════════════════════════
router.post('/:id/quality',
  protect, adminOnly,
  upload.single('video'),
  async (req, res) => {
    try {
      const { quality } = req.body;  // '360p' | '720p' | '1080p'
      if (!['360p','720p','1080p'].includes(quality))
        return res.status(400).json({ message: 'quality must be 360p, 720p, or 1080p' });

      if (!req.file)
        return res.status(400).json({ message: 'Video file required' });

      const movie = await Movie.findById(req.params.id);
      if (!movie) return res.status(404).json({ message: 'Movie not found' });

      const result = await uploadToCloudinary(req.file.buffer, {
        folder:        'cinestream/videos',
        resource_type: 'video',
        public_id:     `${movie._id}-${quality}-${Date.now()}`,
      });

      movie.qualities[quality] = result.secure_url;
      await movie.save();

      res.json({ message: `${quality} uploaded!`, qualities: movie.qualities });
    } catch (error) {
      res.status(500).json({ message: error.message });
    }
  }
);

module.exports = router;
