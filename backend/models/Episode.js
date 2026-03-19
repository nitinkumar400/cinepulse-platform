// ══════════════════════════════════════════
// CINE STREAM — Episode Model
// ══════════════════════════════════════════
const mongoose = require('mongoose');

const EpisodeSchema = new mongoose.Schema({

  // ── Parent series ──
  series: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Movie',   // Episodes belong to a Movie (which acts as the series)
    required: [true, 'Series is required'],
  },

  // ── Episode identity ──
  season: {
    type:    Number,
    default: 1,
    min:     [1, 'Season must be at least 1'],
  },

  episodeNumber: {
    type:     Number,
    required: [true, 'Episode number is required'],
    min:      [1, 'Episode number must be at least 1'],
  },

  title: {
    type:     String,
    required: [true, 'Title is required'],
    trim:     true,
  },

  description: {
    type:    String,
    default: '',
    trim:    true,
  },

  // Duration in minutes
  duration: {
    type:    Number,
    default: 24,
    min:     0,
  },

  // ── Media URLs (Cloudinary) ──
  sourceType: {
    type: String,
    enum: ['local', 'youtube', 'dailymotion'],
    default: 'local',
    lowercase: true,
    trim: true,
  },

  videoUrl: {
    type:    String,
    default: '',
  },

  thumbnailUrl: {
    type:    String,
    default: '',
  },

  // ── Stats ──
  views: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // FIX: Added averageRating + numRatings
  // Episodes can be rated independently of the series
  averageRating: {
    type:    Number,
    default: 0,
    min:     0,
    max:     10,
  },

  numRatings: {
    type:    Number,
    default: 0,
  },

  // FIX: Added isFeatured — admin can highlight specific episodes
  isFeatured: {
    type:    Boolean,
    default: false,
  },

  // FIX: Added airDate — important for anime/series release tracking
  airDate: {
    type:    Date,
    default: null,
  },

  // FIX: Added filler flag — common in anime (Naruto filler arcs etc.)
  isFiller: {
    type:    Boolean,
    default: false,
  },

}, {
  // Automatically adds createdAt + updatedAt
  timestamps: true,
  suppressReservedKeysWarning: true,
});

// ══════════════════════════════════════════
// VIRTUAL — displayTitle
// e.g. "S1E4 · The Battle Begins"
// ══════════════════════════════════════════
EpisodeSchema.virtual('displayTitle').get(function () {
  return `S${this.season}E${this.episodeNumber} · ${this.title}`;
});

EpisodeSchema.set('toJSON',   { virtuals: true });
EpisodeSchema.set('toObject', { virtuals: true });

// ══════════════════════════════════════════
// INDEXES
// ══════════════════════════════════════════

// FIX: Unique constraint — no two episodes with same series + season + number
// This is what causes the 11000 duplicate key error on double-upload
EpisodeSchema.index(
  { series: 1, season: 1, episodeNumber: 1 },
  { unique: true }
);

// Fast lookup for "get all episodes of a series ordered"
EpisodeSchema.index({ series: 1, season: 1, episodeNumber: 1 });

// Fast lookup for next/prev episode queries
EpisodeSchema.index({ series: 1, season: 1 });

// Trending episodes
EpisodeSchema.index({ views: -1 });

module.exports = mongoose.model('Episode', EpisodeSchema);
