// ══════════════════════════════════════════
// CINE STREAM — Movie Model
// ══════════════════════════════════════════
const mongoose = require('mongoose');
const { ALLOWED_SERVERS } = require('../config/constants');

// ── Subtitle sub-schema ──
const SubtitleSchema = new mongoose.Schema({
  language: { type: String, required: true },
  label:    { type: String, required: true },
  url:      { type: String, required: true },
  default:  { type: Boolean, default: false },
}, { _id: true });

// ── Quality sub-schema ──
// Stores Cloudinary URLs for each resolution variant
const QualitySchema = new mongoose.Schema({
  '360p':  { type: String, default: '' },
  '720p':  { type: String, default: '' },
  '1080p': { type: String, default: '' },
}, { _id: false });

const SourceSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['youtube', 'vimeo', 'dailymotion', 'storage'],
    default: undefined,
    lowercase: true,
    trim: true,
  },
  id: {
    type: String,
    default: '',
    trim: true,
  },
  path: {
    type: String,
    default: '',
    trim: true,
  },
  sourceType: {
    type: String,
    enum: ['local', 'youtube', 'dailymotion', 'vimeo'],
    default: 'local',
    lowercase: true,
    trim: true,
  },
  server: {
    type: String,
    enum: ALLOWED_SERVERS,
    required: true,
    lowercase: true,
    trim: true,
  },
  url: {
    type: String,
    required: true,
    trim: true,
  },
  quality: {
    type: String,
    default: 'HD',
    trim: true,
  },
  meta: {
    title: { type: String, default: '' },
    duration_seconds: { type: Number, default: 0 },
    thumbnail: { type: String, default: '' },
    canonical_id: { type: String, default: '' },
  },
  is_broken: {
    type: Boolean,
    default: false,
  },
  last_checked: {
    type: Date,
    default: null,
  },
}, { _id: true });

const MovieSchema = new mongoose.Schema({

  title: {
    type:     String,
    required: [true, 'Title is required'],
    trim:     true,
  },

  description: {
    type:    String,
    default: 'No description available.',
  },

  category: {
    type:     String,
    required: true,
    enum:     ['movie', 'anime', 'cartoon', 'series', 'documentary', 'short'],
    default:  'movie',
  },

  genre:       [{ type: String }],
  releaseYear: { type: Number, default: 2024 },
  duration:    { type: Number, default: 0 },
  rating:      { type: String, default: 'PG' },

  averageRating: { type: Number, default: 0, min: 0, max: 10 },
  numRatings:    { type: Number, default: 0 },

  // ── Media URLs ──
  sourceType:   {
    type: String,
    enum: ['local', 'youtube', 'dailymotion', 'vimeo'],
    default: 'local',
    lowercase: true,
    trim: true,
  },
  videoUrl:     { type: String, default: '' },  // original / highest quality
  thumbnailUrl: { type: String, default: '' },
  bannerUrl:    { type: String, default: '' },
  logoUrl:      { type: String, default: '' },
  trailerUrl:   { type: String, default: '' },

  // ── Multi-quality video URLs ──
  // Populated when admin uploads quality variants
  // If empty, player falls back to videoUrl
  qualities: {
    type:    QualitySchema,
    default: () => ({ '360p': '', '720p': '', '1080p': '' }),
  },

  sources: {
    type: [SourceSchema],
    default: [],
  },

  // ── Subtitles / Captions ──
  subtitles: [SubtitleSchema],

  language:  { type: String, default: 'English' },
  studio:    { type: String, default: '' },
  director:  { type: String, default: '' },
  cast:      [String],
  tags:      [String],

  views:      { type: Number,  default: 0 },
  isFeatured: { type: Boolean, default: false },

  isNewRelease: { type: Boolean, default: true },

  uploadedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref:  'User',
  },

  // ── AniList Fields ──
  anilistId:    { type: Number, default: null },
  anilistScore: { type: Number, default: 0 },

  // ── TMDb Fields ──
  tmdbId: { type: Number },
  // ── Shared Fields ──
  totalEpisodes: { type: Number, default: 0 },
  status: {
    type:    String,
    enum:    ['Completed', 'Ongoing', 'Upcoming', 'Cancelled'],
    default: 'Completed',
  },

}, {
  timestamps: true,
  suppressReservedKeysWarning: true,
});

// ── Virtual: isActuallyNew ──
MovieSchema.virtual('isActuallyNew').get(function () {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  return this.createdAt > thirtyDaysAgo;
});

// ── Pre-save: auto-update isNewRelease ──
MovieSchema.pre('save', function (next) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  this.isNewRelease = this.createdAt > thirtyDaysAgo;
  next();
});

// ── Indexes ──
MovieSchema.index({ title:      1 });
MovieSchema.index({ category:   1 });
MovieSchema.index({ views:     -1 });
MovieSchema.index({ createdAt: -1 });
MovieSchema.index({ anilistId:  1 }, { sparse: true });
MovieSchema.index({ tmdbId:     1 }, { unique: true, sparse: true });
MovieSchema.index({ category: 1, genre: 1 });
MovieSchema.index({ isFeatured: 1, createdAt: -1 });
MovieSchema.index({ title: 'text', description: 'text' });

module.exports = mongoose.model('Movie', MovieSchema);
