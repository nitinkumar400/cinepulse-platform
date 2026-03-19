// ══════════════════════════════════════════
// CINE STREAM — WatchHistory Model
// ══════════════════════════════════════════
const mongoose = require('mongoose');

const WatchHistorySchema = new mongoose.Schema({

  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: true,
  },

  movie: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Movie',
    required: true,
  },

  // FIX: Added episode reference — needed for per-episode progress tracking
  // Without this, all episodes of a series share one progress entry
  episode: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     'Episode',
    default: null,
  },

  // Progress in seconds
  progress: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // Total duration in seconds
  totalDuration: {
    type:    Number,
    default: 0,
    min:     0,
  },

  completed: {
    type:    Boolean,
    default: false,
  },

  watchedAt: {
    type:    Date,
    default: Date.now,
  },

}, {
  // FIX: Use mongoose timestamps — gives updatedAt automatically
  // Old code only had watchedAt (manually set) with no updatedAt
  timestamps: true,
});

// ══════════════════════════════════════════
// VIRTUAL — percentWatched
// FIX: Computed once in model, not in every route handler
// ══════════════════════════════════════════
WatchHistorySchema.virtual('percentWatched').get(function () {
  if (!this.totalDuration || this.totalDuration === 0) return 0;
  return Math.min(100, Math.round((this.progress / this.totalDuration) * 100));
});

// ══════════════════════════════════════════
// VIRTUAL — resumeUrl
// FIX: Deep-link back to the exact timestamp
// ══════════════════════════════════════════
WatchHistorySchema.virtual('resumeUrl').get(function () {
  if (!this.movie) return '';
  const movieId = this.movie._id || this.movie;
  const t       = Math.floor(this.progress);
  if (this.episode) {
    const epId = this.episode._id || this.episode;
    return `/pages/episode.html?id=${epId}&t=${t}`;
  }
  return `/pages/movie-details.html?id=${movieId}&t=${t}`;
});

// Include virtuals when converting to JSON/Object
WatchHistorySchema.set('toJSON',   { virtuals: true });
WatchHistorySchema.set('toObject', { virtuals: true });

// ══════════════════════════════════════════
// INDEXES
// FIX: Changed unique index from { user, movie } to { user, movie, episode }
//
// OLD: WatchHistorySchema.index({ user: 1, movie: 1 }, { unique: true });
// PROBLEM: With only user+movie as unique key, saving episode progress
// would fail with a duplicate key error because two episodes of the
// same movie share the same user+movie pair.
//
// NEW: user + movie + episode together = unique entry
// When episode is null (movie watch), the null itself is part of the key
// so movie and episode watches stay separate.
// ══════════════════════════════════════════
WatchHistorySchema.index(
  { user: 1, movie: 1, episode: 1 },
  { unique: true }
);

// Sort by most recently watched
WatchHistorySchema.index({ user: 1, watchedAt: -1 });

// FIX: Index for "continue watching" query (completed + progress filter)
WatchHistorySchema.index({ user: 1, completed: 1, progress: 1 });

module.exports = mongoose.model('WatchHistory', WatchHistorySchema);