// ══════════════════════════════════════════
// CINE STREAM — Analytics Routes
// GET /api/analytics/overview
// GET /api/analytics/content
// GET /api/analytics/users
// GET /api/analytics/engagement
// ══════════════════════════════════════════
const express      = require('express');
const router       = express.Router();
const mongoose     = require('mongoose');
const Movie        = require('../models/Movie');
const User         = require('../models/User');
const Comment      = require('../models/Comment');
const WatchHistory = require('../models/WatchHistory');
const { protect, adminOnly } = require('../middleware/authMiddleware');

// All routes require admin
router.use(protect, adminOnly);

// ══════════════════════════════════════════
// GET /api/analytics/overview
// Top-level platform stats
// ══════════════════════════════════════════
router.get('/overview', async (req, res) => {
  try {
    const now        = new Date();
    const day7ago    = new Date(now - 7  * 86400000);
    const day30ago   = new Date(now - 30 * 86400000);
    const day365ago  = new Date(now - 365* 86400000);

    const [
      totalMovies,
      totalUsers,
      totalComments,
      totalWatches,
      newMovies7d,
      newUsers7d,
      newComments7d,
      newWatches7d,
      newUsers30d,
      completedWatches,
      moviesAgg,
    ] = await Promise.all([
      Movie.countDocuments(),
      User.countDocuments(),
      Comment.countDocuments(),
      WatchHistory.countDocuments(),
      Movie.countDocuments({ createdAt: { $gte: day7ago } }),
      User.countDocuments({ createdAt: { $gte: day7ago } }),
      Comment.countDocuments({ createdAt: { $gte: day7ago } }),
      WatchHistory.countDocuments({ updatedAt: { $gte: day7ago } }),
      User.countDocuments({ createdAt: { $gte: day30ago } }),
      WatchHistory.countDocuments({ completed: true }),
      Movie.aggregate([
        { $group: { _id: null, totalViews: { $sum: '$views' } } },
      ]),
    ]);

    const totalViews = moviesAgg[0]?.totalViews || 0;

    // Watch time total
    const watchTimeAgg = await WatchHistory.aggregate([
      { $group: { _id: null, totalSeconds: { $sum: '$progress' } } },
    ]);
    const totalWatchSeconds = watchTimeAgg[0]?.totalSeconds || 0;

    res.json({
      totals: {
        movies:     totalMovies,
        users:      totalUsers,
        comments:   totalComments,
        watches:    totalWatches,
        views:      totalViews,
        watchHours: Math.floor(totalWatchSeconds / 3600),
      },
      growth7d: {
        movies:   newMovies7d,
        users:    newUsers7d,
        comments: newComments7d,
        watches:  newWatches7d,
      },
      growth30d: {
        users: newUsers30d,
      },
      completionRate: totalWatches > 0
        ? Math.round((completedWatches / totalWatches) * 100)
        : 0,
    });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════
// GET /api/analytics/content
// Content breakdown + top performers
// ══════════════════════════════════════════
router.get('/content', async (req, res) => {
  try {
    const [byCategory, byStatus, topByViews, topByRating, uploadTimeline] =
      await Promise.all([

        // Count + views by category
        Movie.aggregate([
          { $group: {
            _id:        '$category',
            count:      { $sum: 1 },
            totalViews: { $sum: '$views' },
            avgRating:  { $avg: '$averageRating' },
          }},
          { $sort: { count: -1 } },
        ]),

        // Count by status
        Movie.aggregate([
          { $group: { _id: '$status', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
        ]),

        // Top 10 by views
        Movie.find()
          .sort({ views: -1 })
          .limit(10)
          .select('title category views averageRating thumbnailUrl releaseYear createdAt'),

        // Top 10 by rating (min 3 ratings)
        Movie.find({ numRatings: { $gte: 3 } })
          .sort({ averageRating: -1 })
          .limit(10)
          .select('title category averageRating numRatings thumbnailUrl'),

        // Upload count by month (last 12 months)
        Movie.aggregate([
          { $match: { createdAt: { $gte: new Date(Date.now() - 365 * 86400000) } } },
          { $group: {
            _id: {
              year:  { $year:  '$createdAt' },
              month: { $month: '$createdAt' },
            },
            count: { $sum: 1 },
            views: { $sum: '$views' },
          }},
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),
      ]);

    res.json({ byCategory, byStatus, topByViews, topByRating, uploadTimeline });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════
// GET /api/analytics/users
// User growth + activity breakdown
// ══════════════════════════════════════════
router.get('/users', async (req, res) => {
  try {
    const [growthTimeline, byRole, recentUsers, watchlistStats] =
      await Promise.all([

        // New users per month (last 12 months)
        User.aggregate([
          { $match: { createdAt: { $gte: new Date(Date.now() - 365 * 86400000) } } },
          { $group: {
            _id: {
              year:  { $year:  '$createdAt' },
              month: { $month: '$createdAt' },
            },
            count: { $sum: 1 },
          }},
          { $sort: { '_id.year': 1, '_id.month': 1 } },
        ]),

        // Users by role
        User.aggregate([
          { $group: { _id: '$role', count: { $sum: 1 } } },
        ]),

        // 10 most recent users
        User.find()
          .sort({ createdAt: -1 })
          .limit(10)
          .select('username email role isVerified createdAt avatar'),

        // Watchlist size distribution
        User.aggregate([
          { $project: { watchlistSize: { $size: '$watchlist' } } },
          { $group: {
            _id:     null,
            avgSize: { $avg:  '$watchlistSize' },
            maxSize: { $max:  '$watchlistSize' },
            total:   { $sum:  '$watchlistSize' },
          }},
        ]),
      ]);

    res.json({ growthTimeline, byRole, recentUsers, watchlistStats: watchlistStats[0] || {} });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════
// GET /api/analytics/engagement
// Watch behaviour + comments + ratings
// ══════════════════════════════════════════
router.get('/engagement', async (req, res) => {
  try {
    const [
      watchByCategory,
      watchTimeline,
      commentTimeline,
      ratingDistribution,
      topCommentedMovies,
    ] = await Promise.all([

        // Watch history by movie category
        WatchHistory.aggregate([
          { $lookup: { from: 'movies', localField: 'movie', foreignField: '_id', as: 'movieData' } },
          { $unwind: { path: '$movieData', preserveNullAndEmptyArrays: true } },
          { $group: {
            _id:          '$movieData.category',
            watchCount:   { $sum: 1 },
            totalSeconds: { $sum: '$progress' },
            completed:    { $sum: { $cond: ['$completed', 1, 0] } },
          }},
          { $sort: { watchCount: -1 } },
        ]),

        // Watch sessions per day (last 30 days)
        WatchHistory.aggregate([
          { $match: { updatedAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
          { $group: {
            _id: {
              year:  { $year:  '$updatedAt' },
              month: { $month: '$updatedAt' },
              day:   { $dayOfMonth: '$updatedAt' },
            },
            count: { $sum: 1 },
          }},
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]),

        // Comments per day (last 30 days)
        Comment.aggregate([
          { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
          { $group: {
            _id: {
              year:  { $year:  '$createdAt' },
              month: { $month: '$createdAt' },
              day:   { $dayOfMonth: '$createdAt' },
            },
            count: { $sum: 1 },
          }},
          { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } },
        ]),

        // Rating distribution (1-5 stars)
        Comment.aggregate([
          { $match: { rating: { $ne: null } } },
          { $group: { _id: '$rating', count: { $sum: 1 } } },
          { $sort: { _id: 1 } },
        ]),

        // Most commented movies
        Comment.aggregate([
          { $group: { _id: '$movie', commentCount: { $sum: 1 }, avgRating: { $avg: '$rating' } } },
          { $sort: { commentCount: -1 } },
          { $limit: 5 },
          { $lookup: { from: 'movies', localField: '_id', foreignField: '_id', as: 'movie' } },
          { $unwind: '$movie' },
          { $project: { commentCount: 1, avgRating: 1, 'movie.title': 1, 'movie.category': 1, 'movie.thumbnailUrl': 1 } },
        ]),
      ]);

    res.json({ watchByCategory, watchTimeline, commentTimeline, ratingDistribution, topCommentedMovies });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
