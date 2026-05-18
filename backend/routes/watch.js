// ══════════════════════════════════════════
// CINE STREAM — Watch History Routes
// ══════════════════════════════════════════
const express             = require('express');
const router              = express.Router();
const mongoose            = require('mongoose');
const WatchHistory        = require('../models/WatchHistory');
const Episode             = require('../models/Episode');
const Movie               = require('../models/Movie');
const { protect }         = require('../middleware/authMiddleware');
const serverConfigService = require('../services/serverConfigService');
const { substitutePattern } = require('../services/serverHealthService');

// ══════════════════════════════════════════
// HELPER — validate MongoDB ObjectId
// FIX: prevents Mongoose CastError crash when
// a bad/malformed id is passed in the URL or body
// ══════════════════════════════════════════
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

const PROVIDER_PRIORITY_OVERRIDES = {
  vidlink: 1,
  vidsrcnet: 2,
  autoembed: 3,
  embed2: 4,
  vidsrcin: 5,
  
  // Anime & legacy fallbacks
  vidnest: 100,
  vidnestpahe: 101,
  animevidsrc: 102,
  anime2embed: 103,
  animevidsrcto: 104,
};

function getEffectiveProviderPriority(server) {
  const key = String(server?.key || server?.server || '').trim().toLowerCase();
  return PROVIDER_PRIORITY_OVERRIDES[key] || Number(server?.priority || 999);
}

function normalizeWatchSource(url = '', fallbackType = '') {
  const raw = String(url || '').trim();
  const explicitType = String(fallbackType || '').trim().toLowerCase();

  const youtubeMatch = raw.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i);
  if (youtubeMatch?.[1]) {
    return { type: 'youtube', id: youtubeMatch[1] };
  }

  const dailymotionMatch = raw.match(/(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([A-Za-z0-9]+)/i);
  if (dailymotionMatch?.[1]) {
    return { type: 'dailymotion', id: dailymotionMatch[1] };
  }

  const vimeoMatch = raw.match(/(?:vimeo\.com\/)(\d+)/i);
  if (vimeoMatch?.[1]) {
    return { type: 'vimeo', id: vimeoMatch[1] };
  }

  if (explicitType === 'youtube' || explicitType === 'dailymotion' || explicitType === 'vimeo') {
    return { type: explicitType, id: '' };
  }

  return null;
}

function normalizeStoragePath(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';

  if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      return `${parsed.pathname}${parsed.search || ''}`;
    } catch {
      return raw;
    }
  }

  return raw;
}

function getSourcePriority(type = '') {
  const normalized = String(type || '').trim().toLowerCase();
  if (normalized === 'storage') return 0;
  if (normalized === 'dailymotion') return 1;
  if (normalized === 'youtube') return 2;
  if (normalized === 'vimeo') return 3;
  return 99;
}

// ══════════════════════════════════════════
// HELPER — detect media category for embed URL routing
// Mirrors the frontend's EmbedServers.detectCategory() logic
// in public/js/embedServers.js so the backend produces the
// same routing decisions when constructing embed URLs.
// Returns one of: 'anime' | 'tv' | 'movie'
// ══════════════════════════════════════════
function detectCategory(movie) {
  const cat = String(movie?.category || '').toLowerCase();
  if (cat === 'anime' || cat === 'anilist') return 'anime';
  if ([
    'series',
    'tv',
    'cartoon',
    'k-drama',
    'asian-drama',
    'asian_drama',
    'kdrama',
    'chinese-drama',
    'cdrama',
    'c-drama',
  ].includes(cat)) {
    return 'tv';
  }
  if (Number(movie?.totalEpisodes || 0) > 1) return 'tv';
  return 'movie';
}

// ══════════════════════════════════════════
// HELPER — build embed sources from MongoDB-driven server config
//
// Walks the enabled EmbedServerConfig list (cached up to 5 minutes by
// ServerConfigService) and produces one source descriptor per server
// that can yield a valid URL for `movie`. Servers that lack the IDs
// or URL pattern needed for this title are silently skipped, matching
// the existing frontend buildHydraSources() shape.
//
// Routing rules (Requirement 21.1, 21.2, 21.3):
//   • standard server → needs tmdbId on movie. Use tvUrlPattern when
//                       category is anime/tv (multi-episode), else
//                       movieUrlPattern. Skip if pattern is empty.
//   • anime server   → needs anilistId on movie. Use animeUrlPattern.
//                      Skip if pattern is empty.
//
// An anime title indexed on TMDB therefore receives URLs from BOTH
// pools — tmdb-id servers run first (they are higher priority by
// design) and anilist-id servers act as fallbacks. This mirrors the
// "TMDB-first" anime strategy documented in embedServers.js and
// AGENT.md.
//
// @param  {object} movie    Lean Movie POJO with tmdbId/anilistId/category fields.
// @param  {number} season   1-based season number (default 1).
// @param  {number} episode  1-based episode number (default 1).
// @returns {Promise<object[]>} Source descriptors sorted by priority asc.
// ══════════════════════════════════════════
async function buildEmbedSourcesFromConfig(movie, season = 1, episode = 1) {
  if (!movie) return [];

  const tmdbId    = movie.tmdbId    ?? movie.tmdb_id    ?? null;
  const anilistId = movie.anilistId ?? movie.anilist_id ?? null;
  const category  = detectCategory(movie);

  // Multi-episode-style media (anime / series / tv-like) uses the TV
  // URL pattern on standard servers. A standalone movie uses the
  // movie URL pattern. The boolean is precomputed once outside the
  // loop for clarity.
  const isMultiEpisode = category === 'anime' || category === 'tv';

  const seasonNum  = Number.isFinite(Number(season))  ? Number(season)  : 1;
  const episodeNum = Number.isFinite(Number(episode)) ? Number(episode) : 1;

  let enabled;
  try {
    // ServerConfigService.getEnabled() honours the 5-minute cache
    // (Requirement 21.4) and only returns docs where enabled === true
    // (Requirement 21.3).
    enabled = await serverConfigService.getEnabled();
  } catch (err) {
    // A Mongo failure here must not break the watch endpoint — the
    // frontend already builds embed sources client-side via
    // EmbedServers.buildHydraSources() as a fallback. We simply
    // return no embed sources from the backend so the response stays
    // backward-compatible.
    return [];
  }

  if (!Array.isArray(enabled) || enabled.length === 0) return [];

  const substVars = {
    tmdbId:    tmdbId    ?? '',
    season:    seasonNum,
    episode:   episodeNum,
    anilistId: anilistId ?? '',
  };

  const sources = [];

  for (const server of enabled) {
    if (!server || !server.key) continue;

    let pattern = null;

    if (server.type === 'anime') {
      // Anime-id-based server: requires AniList ID + animeUrlPattern.
      if (!anilistId) continue;
      pattern = server.animeUrlPattern;
      if (!pattern) continue;
    } else {
      // Standard server (or any unknown type — be permissive so a
      // future schema migration cannot brick the player). Requires
      // a TMDB ID.
      if (!tmdbId) continue;
      pattern = isMultiEpisode ? server.tvUrlPattern : server.movieUrlPattern;
      if (!pattern) continue;
    }

    const url = substitutePattern(pattern, substVars);
    if (!url) continue;

    const isAnime = server.type === 'anime' || category === 'anime';

    sources.push({
      id:            `hydra-${server.type === 'anime' ? 'anime' : (isMultiEpisode ? 'tv' : 'std')}-${server.key}`,
      server:        server.key,
      serverName:    server.name,
      label:         '', // assigned after sort, so labels reflect final order
      priority:      getEffectiveProviderPriority(server),
      url,
      embedUrl:      url,
      quality:       'Auto',
      isExternal:    true,
      isEmbed:       true,
      isAnime,
      timeout:       Number(server.timeout) || 9000,
      sandboxPolicy: server.sandboxPolicy || 'none',
      sourceType:    server.key,
    });
  }

  // Stable sort by priority ascending (lower priority = higher
  // preference) so callers can stream attempts in order.
  sources.sort((a, b) => getEffectiveProviderPriority(a) - getEffectiveProviderPriority(b));

  // Remove human-readable "Server N" labels here. The frontend `setupPlayback` 
  // will assign sequential labels after unifying with Native sources.

  return sources;
}

function buildMaskedMovieSources(movie) {
  const rawSources = [];

  if (movie?.videoUrl) {
    rawSources.push({
      type: movie.sourceType === 'local' ? 'storage' : movie.sourceType,
      url: movie.videoUrl,
      quality: movie.qualities?.['1080p'] ? 'Full HD' : 'HD',
    });
  }

  if (Array.isArray(movie?.sources)) {
    rawSources.push(...movie.sources.map((source) => ({
      type: source?.server || source?.sourceType,
      url: source?.url,
      quality: source?.quality || source?.meta?.quality || 'HD',
    })));
  }

  const deduped = [];
  const seen = new Set();

  for (const source of rawSources) {
    const normalizedType = String(source?.type || '').trim().toLowerCase();
    const storageLike = ['upload', 'local', 'storage'].includes(normalizedType);

    if (storageLike) {
      const path = normalizeStoragePath(source?.url);
      if (!path) continue;
      const key = `storage:${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push({
        type: 'storage',
        path,
        quality: source?.quality || 'HD',
      });
      continue;
    }

    const normalized = normalizeWatchSource(source?.url, normalizedType);
    if (!normalized?.type || !normalized?.id) continue;
    const key = `${normalized.type}:${normalized.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({
      type: normalized.type,
      id: normalized.id,
      quality: source?.quality || 'HD',
    });
  }

  const ordered = deduped.sort((left, right) => {
    return getSourcePriority(left.type) - getSourcePriority(right.type);
  });

  return ordered.map((source, index) => ({
    key: `${source.type}-${source.id || source.path || index}`,
    type: source.type,
    id: source.id || '',
    path: source.path || '',
    label: index === 0 ? 'Primary' : `Fallback ${index}`,
    quality: source.quality || 'HD',
    availability: 'available',
  }));
}

// ══════════════════════════════════════════
// GET WATCH HISTORY
// GET /api/watch/history
// ══════════════════════════════════════════
router.get('/history', protect, async (req, res) => {
  try {
    const { limit = 50, page = 1 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const history = await WatchHistory.find({ user: req.user._id })
      .populate(
        'movie',
        // FIX: Added averageRating + views — frontend progress cards need these
        'title thumbnailUrl category duration releaseYear averageRating views'
      )
      .sort({ watchedAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Filter out entries where movie was deleted
    const valid = history.filter(h => h.movie !== null);

    // FIX: Add percentWatched to each entry so frontend can render progress bars
    const watchHistory = valid.map(h => ({
      ...h.toObject(),
      percentWatched: h.totalDuration > 0
        ? Math.min(100, Math.round((h.progress / h.totalDuration) * 100))
        : 0,
    }));

    res.json({
      success: true,
      history: watchHistory,
    });

  } catch (error) {
    console.error('Watch history error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// SAVE WATCH PROGRESS
// POST /api/watch/progress
// FIX: Added movieId ObjectId validation
// FIX: Added episode support (episodeId field)
// FIX: Returns percentWatched in response
// ══════════════════════════════════════════
router.post('/progress', protect, async (req, res) => {
  try {
    const { movieId, episodeId, progress, totalDuration } = req.body;

    if (!movieId)
      return res.status(400).json({ message: 'movieId is required' });

    // FIX: Validate ObjectId to prevent CastError crash
    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    if (episodeId && !isValidId(episodeId))
      return res.status(400).json({ message: 'Invalid episodeId' });

    const progressNum      = Math.max(0, parseFloat(progress)      || 0);
    const totalDurationNum = Math.max(0, parseFloat(totalDuration) || 0);

    // Mark completed if watched >= 95%
    const completed = totalDurationNum > 0 &&
      (progressNum / totalDurationNum) >= 0.95;

    const percentWatched = totalDurationNum > 0
      ? Math.min(100, Math.round((progressNum / totalDurationNum) * 100))
      : 0;

    // Build the filter — unique per user + movie + (optional) episode
    const filter = {
      user:  req.user._id,
      movie: movieId,
      ...(episodeId ? { episode: episodeId } : {}),
    };

    // Build the update
    const update = {
      progress:      progressNum,
      totalDuration: totalDurationNum,
      completed,
      watchedAt:     new Date(),
      ...(episodeId ? { episode: episodeId } : {}),
    };

    const history = await WatchHistory.findOneAndUpdate(
      filter,
      update,
      { upsert: true, new: true }
    );

    res.json({
      message:      'Progress saved',
      history,
      percentWatched,
      completed,
    });

  } catch (error) {
    console.error('Save progress error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET SINGLE MOVIE PROGRESS
// GET /api/watch/progress/:movieId
// FIX: This route was completely missing
// movie-details.html needs it to restore resume position
// VideoPlayer.restoreProgress reads localStorage, but the
// server-side progress is the source of truth on other devices
// ══════════════════════════════════════════
router.get('/progress/:movieId', protect, async (req, res) => {
  try {
    const { movieId } = req.params;

    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    const history = await WatchHistory.findOne({
      user:  req.user._id,
      movie: movieId,
    });

    if (!history)
      return res.json({ progress: 0, percentWatched: 0, completed: false });

    const percentWatched = history.totalDuration > 0
      ? Math.min(100, Math.round((history.progress / history.totalDuration) * 100))
      : 0;

    res.json({
      progress:      history.progress,
      totalDuration: history.totalDuration,
      percentWatched,
      completed:     history.completed,
      watchedAt:     history.watchedAt,
    });

  } catch (error) {
    console.error('Get progress error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET CONTINUE WATCHING
// GET /api/watch/continue
// FIX: Added percentWatched + resumeUrl to each entry
// so the frontend can render progress bars and deep-link
// ══════════════════════════════════════════
router.get('/continue', protect, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const continueWatching = await WatchHistory.find({
      user:      req.user._id,
      completed: false,
      progress:  { $gt: 30 }, // FIX: > 30s not just > 0 — filters accidental 1s entries
    })
    .populate(
      'movie',
      'title thumbnailUrl bannerUrl category duration releaseYear averageRating'
    )
    .sort({ watchedAt: -1 })
    .limit(parseInt(limit));

    const valid = continueWatching.filter(h => h.movie !== null);

    // FIX: Add percentWatched + resumeUrl for each item
    const withMeta = valid.map(h => {
      const obj = h.toObject();
      obj.percentWatched = h.totalDuration > 0
        ? Math.min(100, Math.round((h.progress / h.totalDuration) * 100))
        : 0;
      // Deep-link back to the exact timestamp
      obj.resumeUrl =
        `/pages/movie-details.html?id=${h.movie._id}&t=${Math.floor(h.progress)}`;
      return obj;
    });

    res.json(withMeta);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET WATCH STATS
// GET /api/watch/stats
// FIX: This was completely missing
// Profile page and dashboard need total watch time, counts etc.
// ══════════════════════════════════════════
router.get('/stats', protect, async (req, res) => {
  try {
    const userId = req.user._id;

    const [total, completed, inProgress] = await Promise.all([
      WatchHistory.countDocuments({ user: userId }),
      WatchHistory.countDocuments({ user: userId, completed: true }),
      WatchHistory.countDocuments({
        user: userId, completed: false, progress: { $gt: 30 },
      }),
    ]);

    // Total minutes watched
    const timeResult = await WatchHistory.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $group: { _id: null, totalSeconds: { $sum: '$progress' } } },
    ]);
    const totalSeconds  = timeResult[0]?.totalSeconds || 0;
    const totalMinutes  = Math.floor(totalSeconds / 60);
    const totalHours    = Math.floor(totalMinutes / 60);

    // Category breakdown
    const categoryBreakdown = await WatchHistory.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(userId) } },
      { $lookup: {
          from:         'movies',
          localField:   'movie',
          foreignField: '_id',
          as:           'movieData',
      }},
      { $unwind: '$movieData' },
      { $group: {
          _id:   '$movieData.category',
          count: { $sum: 1 },
      }},
      { $sort: { count: -1 } },
    ]);

    res.json({
      total,
      completed,
      inProgress,
      watchTime: {
        seconds: totalSeconds,
        minutes: totalMinutes,
        hours:   totalHours,
        display: totalHours > 0
          ? `${totalHours}h ${totalMinutes % 60}m`
          : `${totalMinutes}m`,
      },
      categoryBreakdown,
    });

  } catch (error) {
    console.error('Stats error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// DELETE SINGLE ENTRY FROM HISTORY
// DELETE /api/watch/history/:movieId
// FIX: Added ObjectId validation
// ⚠️ Must be BEFORE DELETE /history (no param)
// to avoid Express routing conflict
// ══════════════════════════════════════════
router.delete('/history/:movieId', protect, async (req, res) => {
  try {
    const { movieId } = req.params;

    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    const result = await WatchHistory.findOneAndDelete({
      user:  req.user._id,
      movie: movieId,
    });

    if (!result)
      return res.status(404).json({ message: 'History entry not found' });

    res.json({ message: 'Removed from history' });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// CLEAR ALL HISTORY
// DELETE /api/watch/history
// ⚠️ Must be AFTER DELETE /history/:movieId
// ══════════════════════════════════════════
router.delete('/history', protect, async (req, res) => {
  try {
    const result = await WatchHistory.deleteMany({ user: req.user._id });
    res.json({
      message: 'Watch history cleared',
      deletedCount: result.deletedCount,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.get('/movie/:id/sources', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: 'Invalid movie id' });
    }

    // Pull every field needed by both source builders. The original
    // selection covered uploaded sources only — we additionally need
    // tmdbId / anilistId / category / totalEpisodes for the
    // MongoDB-driven embed source builder (Requirement 21.1, 21.2).
    const movie = await Movie
      .findById(id)
      .select('title videoUrl sourceType qualities sources tmdbId tmdb_id anilistId anilist_id category totalEpisodes')
      .lean();

    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    // Optional season/episode hints for multi-episode titles. Default
    // to 1/1 so the endpoint stays backward-compatible with existing
    // callers that don't supply them.
    const season  = Number.parseInt(req.query.season,  10);
    const episode = Number.parseInt(req.query.episode, 10);
    const seasonNum  = Number.isInteger(season)  && season  > 0 ? season  : 1;
    const episodeNum = Number.isInteger(episode) && episode > 0 ? episode : 1;

    // Run both source builders. Uploaded sources stay exactly as the
    // existing frontend expects (Primary / Fallback N entries with
    // type/id/path/quality fields); embed sources are purely additive
    // and live alongside them in the response.
    const uploadedSources = buildMaskedMovieSources(movie);
    const embedSources    = await buildEmbedSourcesFromConfig(movie, seasonNum, episodeNum);

    // Uploaded sources first (highest preference), then embed
    // sources sorted by priority ascending (handled by the helper).
    const sources = [...uploadedSources, ...embedSources];

    return res.json({
      title: movie.title,
      sources,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: 'Invalid episode id' });
    }

    const episode = await Episode.findById(id).select('title videoUrl sourceType');
    if (!episode) {
      return res.status(404).json({ message: 'Episode not found' });
    }

    const source = normalizeWatchSource(episode.videoUrl, episode.sourceType);
    if (!source?.type || !source?.id) {
      return res.status(400).json({ message: 'Unsupported or unavailable video source' });
    }

    return res.json({
      type: source.type,
      id: source.id,
      title: episode.title,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});


let cineProOfflineUntil = 0;

// ─────────────────────────────────────────────────────────────────────────
// CINEPRO BROKER NATIVE BRIDGE (GET /api/watch/native/:category/:tmdbId)
// ─────────────────────────────────────────────────────────────────────────
router.get('/native/:category/:tmdbId', async (req, res) => {
  try {
    const { category, tmdbId } = req.params;
    const { s, e } = req.query;
    const season = s || '1';
    const episode = e || '1';
    const brokerUrl = process.env.CINEPRO_URL || 'http://localhost:3000';

    if (Date.now() < cineProOfflineUntil) {
      console.log('[WatchBridge] CinePro microservice is currently cached offline. Failing fast.');
      return res.status(503).json({
        success: false,
        message: 'CinePro broker is temporarily offline'
      });
    }

    let targetUrl;
    if (category === 'movie') {
      targetUrl = `${brokerUrl}/v1/movies/${tmdbId}`;
    } else {
      targetUrl = `${brokerUrl}/v1/tv/${tmdbId}/seasons/${season}/episodes/${episode}`;
    }

    const axios = require('axios');
    const response = await axios.get(targetUrl, { timeout: 20000 });
    
    return res.json({
      success: true,
      sources: response.data?.sources || [], // Frontend expects this for native playback
      streams: response.data?.sources || [], // Legacy fallback
      subtitles: response.data?.subtitles || [],
      diagnostics: response.data?.diagnostics || []
    });
  } catch (error) {
    console.error('[WatchBridge] Error fetching from CinePro broker:', error.message);
    cineProOfflineUntil = Date.now() + 5 * 60 * 1000;
    console.log('[WatchBridge] Marked CinePro offline for 5 minutes until:', new Date(cineProOfflineUntil).toISOString());
    return res.status(502).json({ 
      success: false,
      message: 'Failed to contact native CinePro broker microservice',
      error: error.message 
    });
  }
});

module.exports = router;

