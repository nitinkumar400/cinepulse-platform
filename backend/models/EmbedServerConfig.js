// ══════════════════════════════════════════
// CINE STREAM — EmbedServerConfig Model
// ──────────────────────────────────────────
// One document per embed server (VidLink, Videasy, VidNest, etc.).
// Replaces the static `public/js/embedServers.js` file so admins can
// enable/disable, reorder, and add servers without code changes.
//
// Health fields (`lastCheckedAt`, `lastStatus`, `successRate`,
// `avgLoadTime`) are populated by ServerHealthService on every cron
// run; they are read-only from the admin UI.
//
// Validates: Requirements 1.1, 1.5
// ══════════════════════════════════════════
const mongoose = require('mongoose');

const EmbedServerConfigSchema = new mongoose.Schema({

  // ── Identity ──────────────────────────────
  // Stable machine key (e.g. "vidlink", "vidnest_anime").
  // Used by the player to reference servers and as the primary
  // lookup field for the admin API (`PUT /api/admin/servers/:key`).
  key: {
    type:      String,
    required:  true,
    unique:    true,
    trim:      true,
    lowercase: true,
    match:     [/^[a-z0-9_]+$/, 'key must match ^[a-z0-9_]+$'],
  },

  // Human-friendly display name shown in the admin dashboard
  // and in the player's source picker (e.g. "VidLink").
  name: {
    type:     String,
    required: true,
    trim:     true,
  },

  // Determines which URL pattern fields apply:
  //   standard → uses tmdbId for movies and tv (movieUrlPattern / tvUrlPattern)
  //   anime    → uses anilistId per episode (animeUrlPattern)
  type: {
    type:     String,
    enum:     ['standard', 'anime'],
    required: true,
  },

  // ── Ordering & state ──────────────────────
  // Lower number = higher priority. The Player tries servers in
  // ascending priority order. Priorities are kept contiguous
  // (1, 2, ..., N) by ServerConfigService — see Property 1.
  priority: {
    type:     Number,
    required: true,
    min:      1,
    validate: {
      validator: Number.isInteger,
      message:   'priority must be an integer',
    },
  },

  // When false, the server is excluded from `/api/watch/:id/sources`
  // and skipped during health checks.
  enabled: {
    type:    Boolean,
    default: true,
  },

  // Value applied to the iframe `sandbox` attribute on the player.
  // "none" means render the iframe with no sandbox attribute at all;
  // any other value is used verbatim as a space-separated token list.
  sandboxPolicy: {
    type:    String,
    default: 'none',
    trim:    true,
  },

  // ── URL patterns ──────────────────────────
  // Placeholders supported: {tmdbId}, {season}, {episode}, {anilistId}.
  // All three are optional at the schema level so a `standard` server
  // can omit `animeUrlPattern` and vice versa. Route-level validation
  // (POST /api/admin/servers) enforces the type-specific requirements.
  movieUrlPattern: {
    type:    String,
    default: null,
    trim:    true,
  },

  tvUrlPattern: {
    type:    String,
    default: null,
    trim:    true,
  },

  animeUrlPattern: {
    type:    String,
    default: null,
    trim:    true,
  },

  // Probe + iframe load timeout in milliseconds.
  timeout: {
    type:    Number,
    default: 9000,
    min:     0,
    validate: {
      validator: Number.isInteger,
      message:   'timeout must be an integer (milliseconds)',
    },
  },

  // ── Health snapshot (written by ServerHealthService) ──
  // Timestamp of the most recent probe.
  lastCheckedAt: {
    type:    Date,
    default: null,
  },

  // Most recent classified status. `null` until the first probe runs.
  lastStatus: {
    type:    String,
    enum:    ['Working', 'Degraded', 'Down', null],
    default: null,
  },

  // Percentage of `Working` results across the last 30 days, in [0, 100].
  successRate: {
    type:    Number,
    default: 0,
    min:     0,
    max:     100,
  },

  // Arithmetic mean of probe response times (ms) over the last 30 days.
  avgLoadTime: {
    type:    Number,
    default: 0,
    min:     0,
  },

}, {
  // Auto-managed createdAt / updatedAt
  timestamps: true,
});

// ══════════════════════════════════════════
// INDEXES
// ──────────────────────────────────────────
// `key` uniqueness is already declared on the field above (unique: true),
// which creates the unique `{ key: 1 }` index. We do NOT redeclare it
// here to avoid the "Duplicate schema index" Mongoose warning.
// ══════════════════════════════════════════

// Plain priority index — supports `getAll()` ordered by priority asc.
EmbedServerConfigSchema.index({ priority: 1 });

// Compound index for the hot path: the player only ever asks for
// enabled servers ordered by priority (`getEnabled()`).
EmbedServerConfigSchema.index({ enabled: 1, priority: 1 });

module.exports = mongoose.model('EmbedServerConfig', EmbedServerConfigSchema);
