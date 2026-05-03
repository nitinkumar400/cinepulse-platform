// ══════════════════════════════════════════
// CINE STREAM — Watch History Routes
// ══════════════════════════════════════════
const express      = require('express');
const router       = express.Router();
const mongoose     = require('mongoose');
const WatchHistory = require('../models/WatchHistory');
const Episode      = require('../models/Episode');
const Movie        = require('../models/Movie');
const { protect }  = require('../middleware/authMiddleware');

// ══════════════════════════════════════════
// HELPER — validate MongoDB ObjectId
// FIX: prevents Mongoose CastError crash when
// a bad/malformed id is passed in the URL or body
// ══════════════════════════════════════════
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

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

router.get('/movie/:id/sources', protect, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id)) {
      return res.status(400).json({ message: 'Invalid movie id' });
    }

    const movie = await Movie.findById(id).select('title videoUrl sourceType qualities sources');
    if (!movie) {
      return res.status(404).json({ message: 'Movie not found' });
    }

    const sources = buildMaskedMovieSources(movie);
    return res.json({
      title: movie.title,
      sources,
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.get('/:id', protect, async (req, res) => {
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

module.exports = router;
