// ══════════════════════════════════════════
// CINE STREAM — Comment Model
// ══════════════════════════════════════════
const mongoose = require('mongoose');

const CommentSchema = new mongoose.Schema({

  movie: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'Movie',
    required: [true, 'Movie reference is required'],
  },

  user: {
    type:     mongoose.Schema.Types.ObjectId,
    ref:      'User',
    required: [true, 'User reference is required'],
  },

  text: {
    type:      String,
    required:  [true, 'Review text is required'],
    trim:      true,
    minlength: [3,   'Review must be at least 3 characters'],
    maxlength: [500, 'Review cannot exceed 500 characters'],
  },

  // 1–5 star rating (optional)
  rating: {
    type:    Number,
    min:     1,
    max:     5,
    default: null,
  },

  // Derived from likedBy.length — single source of truth
  likes: {
    type:    Number,
    default: 0,
    min:     0,
  },

  // FIX: Added default: [] so likedBy is always an array
  // Old schema had no default — runtime code had to patch it with
  // `if (!comment.likedBy) comment.likedBy = []` which is a red flag
  likedBy: {
    type:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    default: [],
  },

  // FIX: Added isEdited flag — useful for showing "edited" badge on reviews
  isEdited: {
    type:    Boolean,
    default: false,
  },

  // FIX: Added reported flag — admin moderation
  isReported: {
    type:    Boolean,
    default: false,
  },

}, {
  // FIX: Use timestamps:true — gives both createdAt AND updatedAt
  // Old schema had only manual createdAt, no updatedAt
  // Without updatedAt you can never tell if a review was edited
  timestamps: true,
  suppressReservedKeysWarning: true,
});

// ══════════════════════════════════════════
// VIRTUAL — hasRating
// Convenience check used in templates
// ══════════════════════════════════════════
CommentSchema.virtual('hasRating').get(function () {
  return this.rating !== null && this.rating !== undefined;
});

CommentSchema.set('toJSON',   { virtuals: true });
CommentSchema.set('toObject', { virtuals: true });

// ══════════════════════════════════════════
// INDEXES
// FIX: Old schema had ZERO indexes
// Every GET /comments/movie/:movieId was a full collection scan
// ══════════════════════════════════════════

// Primary query — get all comments for a movie sorted by date
CommentSchema.index({ movie: 1, createdAt: -1 });

// Most liked comments (for sort=most_liked)
CommentSchema.index({ movie: 1, likes: -1 });

// One-per-user enforcement — enforce at DB level not just app level
CommentSchema.index({ movie: 1, user: 1 }, { unique: true });

// User's own comments (profile page "my reviews")
CommentSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Comment', CommentSchema);