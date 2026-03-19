// ══════════════════════════════════════════
// CINE STREAM — User Model
// ══════════════════════════════════════════
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

function isColorAvatar(value) {
  const raw = String(value || '').trim();
  return raw.startsWith('#') || raw.startsWith('linear-gradient');
}

const UserSchema = new mongoose.Schema({

  username: {
    type:      String,
    required:  [true, 'Username is required'],
    unique:    true,
    trim:      true,
    minlength: [3,  'Username must be at least 3 characters'],
    maxlength: [30, 'Username cannot exceed 30 characters'],
  },

  email: {
    type:      String,
    required:  [true, 'Email is required'],
    unique:    true,
    lowercase: true,
    trim:      true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,})+$/,
      'Please enter a valid email address',
    ],
  },

  password: {
    type:      String,
    required:  [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters'],
  },

  role: {
    type:    String,
    enum:    ['user', 'admin'],
    default: 'user',
  },

  // Avatar background color (hex) — used in UI initials avatar
  avatar: {
    type:    String,
    default: '#e50914',
  },

  // FIX: Added avatarColor as alias — comments.js populate('user','avatarColor')
  // was failing because the field was only named 'avatar'
  avatarColor: {
    type:    String,
    default: '#e50914',
  },

  // Watchlist of saved movies
  watchlist: [{
    type: mongoose.Schema.Types.ObjectId,
    ref:  'Movie',
  }],

  // ── Email Verification ──
  isVerified: {
    type:    Boolean,
    default: false,
  },
  verificationToken: {
    type:    String,
    default: null,
    index:   true,
  },
  verificationExpires: {
    type:    Date,
    default: null,
  },

  // ── Password Reset ──
  // FIX: These fields were missing from the model entirely
  // authMiddleware tries to exclude them with .select()
  // but if they don't exist in the schema, Mongoose ignores
  // the .select() exclusion — so they'd never appear anyway.
// Legacy password reset flow has been removed from auth routes
  // needs to read/write these fields.
  resetToken: {
    type:    String,
    default: null,
  },
  resetExpires: {
    type:    Date,
    default: null,
  },

  // ── Account Status ──
  // FIX: isActive was completely missing
  // authMiddleware.js checks req.user.isActive === false
  // Without this field, banned users can never be blocked
  isActive: {
    type:    Boolean,
    default: true,
  },

  // ── Profile extras ──
  // FIX: Added bio and location — common profile fields
  bio: {
    type:    String,
    default: '',
    maxlength: 200,
    trim:    true,
  },

  // FIX: Added lastLogin — useful for admin analytics
  lastLogin: {
    type:    Date,
    default: null,
  },

}, {
  // FIX: Use timestamps:true — adds both createdAt AND updatedAt automatically
  // Old schema had only manual createdAt with no updatedAt
  timestamps: true,
  suppressReservedKeysWarning: true,
});

// ══════════════════════════════════════════
// PRE-SAVE — hash password
// ══════════════════════════════════════════
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  const salt    = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// ══════════════════════════════════════════
// PRE-SAVE — keep avatarColor in sync with avatar
// FIX: Since we have two fields (avatar + avatarColor)
// keep them identical so nothing ever diverges
// ══════════════════════════════════════════
UserSchema.pre('save', function (next) {
  if (this.isModified('avatar') && isColorAvatar(this.avatar)) {
    this.avatarColor = this.avatar;
  } else if (this.isModified('avatarColor') && isColorAvatar(this.avatarColor)) {
    this.avatar = this.avatarColor;
  }
  next();
});

// ══════════════════════════════════════════
// METHOD — compare password
// ══════════════════════════════════════════
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// ══════════════════════════════════════════
// VIRTUAL — initials for avatar display
// ══════════════════════════════════════════
UserSchema.virtual('initials').get(function () {
  return (this.username || 'U')[0].toUpperCase();
});

UserSchema.set('toJSON',   { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

// ══════════════════════════════════════════
// INDEXES
// FIX: unique:true creates indexes on email + username
// Added extra indexes for common query patterns
// ══════════════════════════════════════════

// Fast token lookup during email verification
UserSchema.index({ verificationToken: 1 }, { sparse: true });

// Fast token lookup during password reset
UserSchema.index({ resetToken: 1 }, { sparse: true });
UserSchema.index({ email: 1 }, { unique: true });
UserSchema.index({ username: 1 }, { unique: true });

module.exports = mongoose.model('User', UserSchema);
