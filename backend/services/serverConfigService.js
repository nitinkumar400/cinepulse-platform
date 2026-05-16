// ══════════════════════════════════════════
// CINE STREAM — ServerConfigService
// ──────────────────────────────────────────
// Singleton service that owns all read/write access to the
// `embed_server_configs` collection.
//
//   • seedIfEmpty()       — first-run population from the legacy
//                           public/js/embedServers.js data shape.
//   • getAll()            — every server config, sorted by priority asc.
//   • getEnabled()        — only enabled servers, sorted by priority asc,
//                           memoised in-process for up to 5 minutes.
//   • create(data)        — insert with priority shift on conflict.
//   • update(key, data)   — patch mutable fields, with priority renumber.
//   • delete(key)         — remove and re-pack priorities to [1..N].
//   • reorder(keys)       — reassign priorities by submitted order.
//
// Cache strategy (Requirement 21.4):
// A simple module-level `_cache` object holds the last `getEnabled()`
// result with a `cachedAt` timestamp. Within a single Node.js process
// the cache survives at most 5 minutes; on Vercel cold starts it is
// re-populated, which still satisfies the "maximum 5 minutes" spec.
// Every write operation in this module sets `_cache = null` so the
// next read fetches fresh data from MongoDB (Requirement 21.5).
//
// Priority sequence invariant (Property 1):
// After any write operation the priority values across the collection
// always form the contiguous integer sequence [1, 2, ..., N] with no
// gaps and no duplicates. The internal `_renumberAll()` helper is the
// single source of truth for re-packing priorities and is invoked by
// `create`, `delete`, and (implicitly via `bulkWrite`) by `update`
// and `reorder`.
//
// Errors:
// All error paths throw a plain `Error` with a numeric `.status` field
// matching the existing pattern in `recommendationService.js` and the
// `routes/movies.js` error handler. The route layer translates these
// into HTTP responses unchanged.
//
// Validates: Requirements 1.2, 1.3, 1.4, 1.6, 4.2, 4.3, 5.2, 19.2,
//            19.3, 19.4, 19.5, 21.4, 21.5
// ══════════════════════════════════════════

const EmbedServerConfig = require('../models/EmbedServerConfig');
const logger = require('../config/logger');

// ── Cache ────────────────────────────────────────────────
// `_cache` is `null` when there is no cached value, otherwise:
//   { data: EmbedServerConfig[], cachedAt: number (ms epoch) }
let _cache = null;

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ══════════════════════════════════════════
// SEED DATA
// ──────────────────────────────────────────
// Mirrors the 12 servers in public/js/embedServers.js (7 standard
// + 5 anime) with these intentional differences:
//
//   1. URL patterns use {placeholder} syntax (NOT template literals)
//      so they can be stored in MongoDB and substituted at runtime
//      by ServerHealthService.substitutePattern().
//
//   2. Priorities are normalised to a CONTIGUOUS sequence [1..12].
//      The legacy file used 1-7 for standard and 100-104 for anime
//      (a deliberate gap so anime fell through after standard servers
//      were exhausted). MongoDB's priority sequence invariant
//      (Property 1) requires no gaps, so anime priorities become
//      8, 9, 10, 11, 12 in the same relative order.
//
//   3. The vidnest standard server uses key `vidnest_std` to avoid
//      colliding with the anime `vidnest` key (matches embedServers.js
//      inner `key` field).
// ══════════════════════════════════════════
const SEED_DATA = [
  // ── Standard servers (priorities 1-7) ────────────────
  {
    key:             'vidlink',
    name:            'VidLink',
    type:            'standard',
    priority:        1,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://vidlink.pro/movie/{tmdbId}',
    tvUrlPattern:    'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}',
    animeUrlPattern: null,
    timeout:         9000,
  },
  {
    key:             'videasy',
    name:            'Videasy',
    type:            'standard',
    priority:        2,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://vidsrc.cc/v2/embed/movie/{tmdbId}',
    tvUrlPattern:    'https://vidsrc.cc/v2/embed/tv/{tmdbId}/{season}/{episode}',
    animeUrlPattern: null,
    timeout:         9000,
  },
  {
    key:             'vidsrcio',
    name:            'VidSrc IO',
    type:            'standard',
    priority:        3,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://vidsrc.io/embed/movie?tmdb={tmdbId}',
    tvUrlPattern:    'https://vidsrc.io/embed/tv?tmdb={tmdbId}&season={season}&episode={episode}',
    animeUrlPattern: null,
    timeout:         9000,
  },
  {
    key:             'vidsrcicu',
    name:            'VidSrc ICU',
    type:            'standard',
    priority:        4,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://vidsrc.icu/embed/movie/{tmdbId}',
    tvUrlPattern:    'https://vidsrc.icu/embed/tv/{tmdbId}/{season}/{episode}',
    animeUrlPattern: null,
    timeout:         9000,
  },
  {
    key:             'embed2',
    name:            '2Embed',
    type:            'standard',
    priority:        5,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://www.2embed.cc/embed/{tmdbId}',
    tvUrlPattern:    'https://www.2embed.cc/embedtv/{tmdbId}&s={season}&e={episode}',
    animeUrlPattern: null,
    timeout:         8000,
  },
  {
    key:             'vidsrc',
    name:            'VidSrc',
    type:            'standard',
    priority:        6,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://vidsrc.to/embed/movie/{tmdbId}',
    tvUrlPattern:    'https://vidsrc.to/embed/tv/{tmdbId}/{season}/{episode}',
    animeUrlPattern: null,
    timeout:         9000,
  },
  {
    key:             'vidnest_std',
    name:            'VidNest',
    type:            'standard',
    priority:        7,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: 'https://vidnest.fun/movie/{tmdbId}',
    tvUrlPattern:    'https://vidnest.fun/tv/{tmdbId}/{season}/{episode}',
    animeUrlPattern: null,
    timeout:         10000,
  },

  // ── Anime servers (priorities 8-12, normalised from 100-104) ──
  {
    key:             'vidnest',
    name:            'VidNest Anime',
    type:            'anime',
    priority:        8,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: null,
    tvUrlPattern:    null,
    animeUrlPattern: 'https://vidnest.fun/anime/{anilistId}/{episode}/sub',
    timeout:         10000,
  },
  {
    key:             'vidnestpahe',
    name:            'VidNest Pahe',
    type:            'anime',
    priority:        9,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: null,
    tvUrlPattern:    null,
    animeUrlPattern: 'https://vidnest.fun/animepahe/{anilistId}/{episode}/sub',
    timeout:         10000,
  },
  {
    key:             'animevidsrc',
    name:            'Anime VidSrc',
    type:            'anime',
    priority:        10,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: null,
    tvUrlPattern:    null,
    animeUrlPattern: 'https://vidsrc.cc/v2/embed/tv/{anilistId}/1/{episode}?anilist=true',
    timeout:         9000,
  },
  {
    key:             'anime2embed',
    name:            'Anime 2Embed',
    type:            'anime',
    priority:        11,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: null,
    tvUrlPattern:    null,
    animeUrlPattern: 'https://www.2embed.cc/embedanime/anilist-{anilistId}&ep={episode}',
    timeout:         9000,
  },
  {
    key:             'animevidsrcto',
    name:            'Anime VidSrc.to',
    type:            'anime',
    priority:        12,
    enabled:         true,
    sandboxPolicy:   'none',
    movieUrlPattern: null,
    tvUrlPattern:    null,
    animeUrlPattern: 'https://vidsrc.to/embed/anime/anilist/{anilistId}/{episode}',
    timeout:         9000,
  },
];

// ══════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════

/**
 * Seed the embed_server_configs collection on first run.
 *
 * Idempotent: if the collection already contains at least one
 * document, the function is a no-op (Requirement 1.3). On a fresh
 * deployment with an empty collection it inserts all 12 SEED_DATA
 * entries in a single bulk operation and invalidates the cache.
 *
 * Errors are logged but never thrown — a seeding failure must not
 * crash the server bootstrap. The runtime falls back to the legacy
 * hardcoded embedServers.js list in that case.
 *
 * @returns {Promise<{ seeded: boolean, count: number }>}
 */
async function seedIfEmpty() {
  try {
    const existing = await EmbedServerConfig.countDocuments({});
    if (existing > 0) {
      logger.info('ServerConfigService.seedIfEmpty: collection already populated, skipping seed', {
        existingCount: existing,
      });
      return { seeded: false, count: existing };
    }

    await EmbedServerConfig.insertMany(SEED_DATA, { ordered: true });

    // Any write must invalidate the cache (Requirement 21.5).
    _cache = null;

    logger.info('ServerConfigService.seedIfEmpty: seeded embed_server_configs', {
      inserted: SEED_DATA.length,
    });
    return { seeded: true, count: SEED_DATA.length };
  } catch (err) {
    logger.error('ServerConfigService.seedIfEmpty: failed to seed collection', {
      error: err.message,
      stack:  err.stack,
    });
    return { seeded: false, count: 0, error: err.message };
  }
}

/**
 * Return every server config, sorted by priority ascending.
 * Always reads fresh from MongoDB — used by the admin dashboard
 * which needs the canonical order including disabled servers.
 *
 * @returns {Promise<EmbedServerConfig[]>}
 */
async function getAll() {
  return EmbedServerConfig.find({}).sort({ priority: 1 }).lean();
}

/**
 * Return only enabled server configs, sorted by priority ascending.
 *
 * Hot-path read used by /api/watch/:id/sources, so it is memoised
 * in-process for up to CACHE_TTL_MS (5 minutes). The cache is
 * invalidated by every write operation in this service.
 *
 * @returns {Promise<EmbedServerConfig[]>}
 */
async function getEnabled() {
  const now = Date.now();
  if (_cache && now - _cache.cachedAt < CACHE_TTL_MS) {
    return _cache.data;
  }

  const data = await EmbedServerConfig.find({ enabled: true })
    .sort({ priority: 1 })
    .lean();

  _cache = { data, cachedAt: now };
  return data;
}

/**
 * Test-only cache reset. Not part of the public contract — exposed
 * for unit/property tests that need a clean cache between cases.
 * @private
 */
function _invalidateCache() {
  _cache = null;
}

// ══════════════════════════════════════════
// INTERNAL HELPERS
// ══════════════════════════════════════════

/**
 * Build a numeric-status error matching the project's existing
 * error-handling pattern (see backend/services/recommendationService.js
 * and backend/middleware/errorHandler.js).
 *
 * @param {string} message
 * @param {number} status
 * @returns {Error}
 * @private
 */
function _httpError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Re-pack all documents in `embed_server_configs` so their priority
 * values form the contiguous sequence [1, 2, ..., N] in their current
 * sort order. Invoked after operations that may leave gaps (delete) or
 * are easier to express as "remove + re-insert" (update with priority
 * change). Uses bulkWrite for an atomic single-round-trip update.
 *
 * The `docs` parameter is the desired ordering — index 0 becomes
 * priority 1, index 1 becomes priority 2, and so on. If `docs` is not
 * supplied, the current persisted order (sorted by priority asc) is
 * used.
 *
 * @param {Array<{ _id: any, key: string }>} [docs]
 * @returns {Promise<void>}
 * @private
 */
async function _renumberAll(docs) {
  const ordered = docs
    || (await EmbedServerConfig.find({}, { _id: 1, key: 1 }).sort({ priority: 1 }).lean());

  if (ordered.length === 0) return;

  const ops = ordered.map((doc, idx) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { priority: idx + 1 } },
    },
  }));

  await EmbedServerConfig.bulkWrite(ops, { ordered: false });
}

// ══════════════════════════════════════════
// CRUD + REORDER (Requirements 1.6, 4.2, 4.3, 5.2, 19.2-19.5)
// ══════════════════════════════════════════

/**
 * Insert a new server config.
 *
 * Behaviour:
 *   1. Reject duplicate `key` with HTTP 409 (Requirement 5.2, 19.4).
 *   2. If `priority` is supplied:
 *        a. Clamp to a positive integer, capped at (max + 1) so we
 *           never leave a gap above the new doc.
 *        b. Shift every existing doc with `priority >= newPriority`
 *           up by 1 (Requirement 1.6).
 *      Else: assign `priority = (currentMax) + 1`.
 *   3. Insert the new document.
 *   4. Re-pack to guarantee Property 1 (no gaps, no duplicates).
 *   5. Invalidate cache.
 *
 * @param {Object} data — fields accepted by EmbedServerConfig schema.
 * @returns {Promise<EmbedServerConfig>} the created doc as a POJO.
 * @throws  {Error} status=409 on duplicate key.
 */
async function create(data) {
  if (!data || typeof data !== 'object') {
    throw _httpError('create() requires a data object', 400);
  }
  if (!data.key) {
    throw _httpError('key is required', 400);
  }

  // 1. Duplicate-key guard.
  const existing = await EmbedServerConfig.findOne({ key: data.key }).lean();
  if (existing) {
    throw _httpError('Server key already exists', 409);
  }

  // Snapshot of current docs ordered by priority — used for both the
  // shift step (to know what max+1 is) and the final renumber pass.
  const currentDocs = await EmbedServerConfig.find({}, { _id: 1, key: 1, priority: 1 })
    .sort({ priority: 1 })
    .lean();

  const maxPriority = currentDocs.length > 0
    ? currentDocs[currentDocs.length - 1].priority
    : 0;

  // 2. Resolve target priority.
  let targetPriority;
  if (data.priority === undefined || data.priority === null) {
    targetPriority = maxPriority + 1;
  } else {
    const parsed = Number.parseInt(data.priority, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw _httpError('priority must be a positive integer', 400);
    }
    // Cap at maxPriority + 1 so the final sequence stays contiguous.
    targetPriority = Math.min(parsed, maxPriority + 1);

    // Shift existing docs whose priority collides.
    if (targetPriority <= maxPriority) {
      await EmbedServerConfig.updateMany(
        { priority: { $gte: targetPriority } },
        { $inc: { priority: 1 } },
      );
    }
  }

  // 3. Insert the new doc.
  const created = await EmbedServerConfig.create({
    ...data,
    priority: targetPriority,
  });

  // 4. Final safety pass — re-pack to [1..N] in case any historical
  //    drift (manual DB edits, partial failures) left gaps.
  await _renumberAll();

  // 5. Cache invalidation (Requirement 21.5).
  _cache = null;

  // Return the freshly-renumbered doc so callers see canonical priority.
  return EmbedServerConfig.findById(created._id).lean();
}

/**
 * Update mutable fields of an existing server config.
 *
 * Mutable fields: name, type, enabled, sandboxPolicy, movieUrlPattern,
 * tvUrlPattern, animeUrlPattern, timeout, priority. The `key` field is
 * immutable — silently ignored if present in `data`.
 *
 * Priority changes are handled by removing the doc from its current
 * slot in an in-memory ordering, re-inserting it at the new slot, and
 * re-numbering 1..N via bulkWrite. This keeps Property 1 intact even
 * when the new priority exceeds the current maximum.
 *
 * @param {string} key
 * @param {Object} data
 * @returns {Promise<EmbedServerConfig>} the updated doc as a POJO.
 * @throws  {Error} status=404 when no doc matches `key`.
 */
async function update(key, data) {
  if (!key) {
    throw _httpError('key is required', 400);
  }
  if (!data || typeof data !== 'object') {
    throw _httpError('update() requires a data object', 400);
  }

  const existing = await EmbedServerConfig.findOne({ key });
  if (!existing) {
    throw _httpError('Server not found', 404);
  }

  // Whitelist of mutable fields. `key`, `_id`, and timestamps are not
  // patchable through this surface.
  const MUTABLE_FIELDS = [
    'name',
    'type',
    'enabled',
    'sandboxPolicy',
    'movieUrlPattern',
    'tvUrlPattern',
    'animeUrlPattern',
    'timeout',
  ];
  for (const field of MUTABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, field)) {
      existing[field] = data[field];
    }
  }

  // Priority change: validated and clamped before being written so the
  // post-renumber state is always [1..N].
  let priorityChanging = false;
  let newPriority = existing.priority;
  if (Object.prototype.hasOwnProperty.call(data, 'priority')
    && data.priority !== null
    && data.priority !== undefined
    && data.priority !== existing.priority) {
    const parsed = Number.parseInt(data.priority, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw _httpError('priority must be a positive integer', 400);
    }
    newPriority = parsed;
    priorityChanging = true;
  }

  if (priorityChanging) {
    // Compose the desired ordering by removing `existing` from the
    // current sorted list and re-inserting at the requested slot.
    const allDocs = await EmbedServerConfig.find({}, { _id: 1, key: 1, priority: 1 })
      .sort({ priority: 1 })
      .lean();

    const without = allDocs.filter((d) => String(d._id) !== String(existing._id));
    const targetIndex = Math.min(Math.max(newPriority, 1), without.length + 1) - 1;
    const reordered = [
      ...without.slice(0, targetIndex),
      { _id: existing._id, key: existing.key, priority: newPriority },
      ...without.slice(targetIndex),
    ];

    // Save the non-priority field changes first, *without* touching
    // priority, so the bulk renumber below is the only write that
    // sets priority values (avoids a transient duplicate-priority
    // state — the field has no unique index but cleanliness matters
    // for tests that assert intermediate states).
    await existing.save();

    await _renumberAll(reordered);
  } else {
    await existing.save();
  }

  // Cache invalidation (Requirement 21.5).
  _cache = null;

  return EmbedServerConfig.findOne({ key }).lean();
}

/**
 * Remove a server config by key.
 *
 * After deletion, remaining docs are re-numbered to [1..N] so the
 * priority sequence stays contiguous (Property 1).
 *
 * @param {string} key
 * @returns {Promise<{ deleted: true, key: string }>}
 * @throws  {Error} status=404 when no doc matches `key`.
 */
async function remove(key) {
  if (!key) {
    throw _httpError('key is required', 400);
  }

  const result = await EmbedServerConfig.deleteOne({ key });
  if (result.deletedCount === 0) {
    throw _httpError('Server not found', 404);
  }

  // Re-pack remaining docs to close the gap left by the removal.
  await _renumberAll();

  _cache = null;

  return { deleted: true, key };
}

/**
 * Reassign priorities to match the submitted key order.
 *
 * `orderedKeys[0]` becomes priority 1, `orderedKeys[1]` becomes
 * priority 2, and so on. The submitted array MUST contain exactly the
 * same set of keys currently in the collection — no missing entries,
 * no extras, no duplicates. Mismatches raise HTTP 400 (Requirement
 * 19.5).
 *
 * @param {string[]} orderedKeys
 * @returns {Promise<{ reordered: true, count: number }>}
 * @throws  {Error} status=400 on key set mismatch.
 */
async function reorder(orderedKeys) {
  if (!Array.isArray(orderedKeys)) {
    throw _httpError('orderedKeys must be an array', 400);
  }

  // Check for duplicates within the submitted list before hitting DB.
  const submittedSet = new Set(orderedKeys);
  if (submittedSet.size !== orderedKeys.length) {
    throw _httpError('orderedKeys must include every server key exactly once', 400);
  }

  const allDocs = await EmbedServerConfig.find({}, { _id: 1, key: 1 }).lean();
  const existingSet = new Set(allDocs.map((d) => d.key));

  if (allDocs.length !== orderedKeys.length) {
    throw _httpError('orderedKeys must include every server key exactly once', 400);
  }
  for (const k of orderedKeys) {
    if (!existingSet.has(k)) {
      throw _httpError('orderedKeys must include every server key exactly once', 400);
    }
  }

  // Build the desired ordering by mapping submitted keys to their
  // corresponding docs, then renumber atomically via bulkWrite.
  const byKey = new Map(allDocs.map((d) => [d.key, d]));
  const ordered = orderedKeys.map((k) => byKey.get(k));

  await _renumberAll(ordered);

  _cache = null;

  return { reordered: true, count: ordered.length };
}

// ══════════════════════════════════════════
// SINGLETON EXPORT
// ──────────────────────────────────────────
// Frozen so callers cannot monkey-patch the service at runtime.
// SEED_DATA is exposed (read-only) for tests that want to assert
// the seed corpus matches the legacy embedServers.js file.
//
// Note: `delete` is a reserved word in strict mode, so the underlying
// implementation is named `remove` and re-exported as `delete` on the
// public surface to match the documented API and the routes/admin
// dashboard call sites.
// ══════════════════════════════════════════
module.exports = Object.freeze({
  seedIfEmpty,
  getAll,
  getEnabled,
  create,
  update,
  delete: remove,
  reorder,
  _invalidateCache,
  SEED_DATA,
});
