// ══════════════════════════════════════════
// CINE STREAM — Admin Server Management Routes
// ──────────────────────────────────────────
// CRUD + reorder + health-trigger endpoints for the
// `embed_server_configs` collection. Backs the admin Server Health
// dashboard (public/js/serverHealthDashboard.js) and the Vercel Cron
// entry that runs the health-check cycle every 30 minutes.
//
// All routes are mounted by api/server.js at:
//
//   /api/admin/servers
//
// Route table (registered in this order — order matters because
// `/reorder`, `/health`, and `/health/run` MUST be matched before
// the `/:key` parameter route, otherwise Express will treat
// "reorder", "health", or "health/run" as a key value):
//
//   GET    /api/admin/servers              List all server configs
//   POST   /api/admin/servers              Create new server config
//   PUT    /api/admin/servers/reorder      Reorder by submitted key array
//   GET    /api/admin/servers/health       Latest health result per server
//   POST   /api/admin/servers/health/run   Trigger immediate health cycle
//   PUT    /api/admin/servers/:key         Update mutable fields
//   DELETE /api/admin/servers/:key         Delete server config
//
// Auth model:
//   • Every endpoint except the cron trigger uses `protect + adminOnly`,
//     so a missing or non-admin JWT yields HTTP 401/403.
//   • POST /health/run uses `cronOrAdmin` so Vercel Cron (which sends
//     `x-vercel-cron: 1`) can fire the cycle without a user session.
//
// Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8
// ══════════════════════════════════════════

const express = require('express');

const { protect, adminOnly, cronOrAdmin } = require('../middleware/authMiddleware');
const { sendSuccess, sendError, asyncHandler } = require('../utils/apiResponse');

const serverConfigService = require('../services/serverConfigService');
const serverHealthService = require('../services/serverHealthService');
const EmbedServerHealth   = require('../models/EmbedServerHealth');
const logger              = require('../config/logger');

const router = express.Router();

// `delete` is a reserved word — pull the implementation off the
// frozen service surface via bracket access and bind locally for
// readability inside the DELETE handler below.
const removeServer = serverConfigService.delete;

// ══════════════════════════════════════════
// VALIDATION HELPERS
// ──────────────────────────────────────────
// Route-level validation for POST /api/admin/servers. Mirrors the
// "Add Server" modal contract from Requirement 5.1 and the type-
// specific URL pattern rules from Requirement 19.2.
//
// Each validator returns either `null` (valid) or a string error
// message that the route handler turns into a 400 response.
// ══════════════════════════════════════════

const KEY_PATTERN = /^[a-z0-9_]+$/;

/**
 * Validate the body of POST /api/admin/servers.
 *
 * Required fields: `key`, `name`, `type` (must be 'standard' or 'anime').
 *
 * Type-specific rules:
 *   • type === 'standard'
 *       → at least one of movieUrlPattern / tvUrlPattern must be present.
 *       → movieUrlPattern (if present) must contain `{tmdbId}`.
 *       → tvUrlPattern    (if present) must contain `{tmdbId}`,
 *                          `{season}`, and `{episode}`.
 *   • type === 'anime'
 *       → animeUrlPattern is required and must contain `{anilistId}`
 *         and `{episode}`.
 *
 * @param {object} body
 * @returns {string|null} error message, or null on success.
 * @private
 */
function _validateCreatePayload(body) {
  if (!body || typeof body !== 'object') {
    return 'Request body is required';
  }

  // --- required identifiers ----------------------------------------
  if (typeof body.key !== 'string' || !body.key.trim()) {
    return 'key is required';
  }
  if (!KEY_PATTERN.test(body.key.trim())) {
    return 'key must match ^[a-z0-9_]+$';
  }
  if (typeof body.name !== 'string' || !body.name.trim()) {
    return 'name is required';
  }

  // --- type discriminator ------------------------------------------
  if (body.type !== 'standard' && body.type !== 'anime') {
    return "type must be 'standard' or 'anime'";
  }

  // --- type-specific URL patterns ----------------------------------
  if (body.type === 'standard') {
    const hasMovie = typeof body.movieUrlPattern === 'string' && body.movieUrlPattern.trim();
    const hasTv    = typeof body.tvUrlPattern    === 'string' && body.tvUrlPattern.trim();
    if (!hasMovie && !hasTv) {
      return 'standard servers require at least one of movieUrlPattern or tvUrlPattern';
    }
    if (hasMovie && !body.movieUrlPattern.includes('{tmdbId}')) {
      return 'movieUrlPattern must contain {tmdbId}';
    }
    if (hasTv) {
      const missing = ['{tmdbId}', '{season}', '{episode}'].filter((p) => !body.tvUrlPattern.includes(p));
      if (missing.length > 0) {
        return `tvUrlPattern must contain ${missing.join(', ')}`;
      }
    }
  } else {
    // type === 'anime'
    if (typeof body.animeUrlPattern !== 'string' || !body.animeUrlPattern.trim()) {
      return 'animeUrlPattern is required for anime servers';
    }
    const missing = ['{anilistId}', '{episode}'].filter((p) => !body.animeUrlPattern.includes(p));
    if (missing.length > 0) {
      return `animeUrlPattern must contain ${missing.join(', ')}`;
    }
  }

  return null;
}

// ══════════════════════════════════════════
// ROUTES
// ══════════════════════════════════════════

// ──────────────────────────────────────────
// GET /api/admin/servers/public    ← MUST come before /:key and the
//                                    auth-protected GET '/' below
//
// Public, read-only endpoint that returns the MongoDB-driven server
// list for the frontend's `embedServers.js` `loadFromMongoDB()` mode.
//
// We deliberately do NOT reuse the protected `GET /` endpoint here:
//   • Player pages run in the unauthenticated public site, so they
//     cannot present an admin JWT.
//   • This response only ever exposes URL patterns and timing data
//     that are already present in the legacy hardcoded
//     `public/js/embedServers.js` fallback — there is no privileged
//     information leaked by serving them from MongoDB instead.
//   • Health stats (`successRate`, `avgLoadTime`, `lastStatus`,
//     `lastCheckedAt`) and admin-only flags are stripped before
//     responding.
//
// Returns ONLY enabled servers (Requirement 21.3) ordered ascending
// by priority (Requirement 21.1). Disabled servers are filtered out
// at the service layer via `getEnabled()`, which itself respects
// the same 5-minute in-process cache used by the watch route
// (Requirement 21.4).
//
// Response shape:
//   {
//     success: true,
//     servers: [
//       { key, name, type, priority, sandboxPolicy,
//         movieUrlPattern, tvUrlPattern, animeUrlPattern, timeout },
//       ...
//     ],
//     ...
//   }
//
// Validates: Requirements 21.1, 21.2, 21.3
// ──────────────────────────────────────────
router.get('/public', asyncHandler(async (req, res) => {
  const enabled = await serverConfigService.getEnabled();

  // Strip every field that is not needed by the frontend URL builder.
  // In particular, withhold health stats and timestamps so the public
  // response can never become a covert observability channel.
  const servers = enabled.map((s) => ({
    key:             s.key,
    name:            s.name,
    type:            s.type,
    priority:        s.priority,
    sandboxPolicy:   s.sandboxPolicy || 'none',
    movieUrlPattern: s.movieUrlPattern || null,
    tvUrlPattern:    s.tvUrlPattern    || null,
    animeUrlPattern: s.animeUrlPattern || null,
    timeout:         typeof s.timeout === 'number' ? s.timeout : 9000,
  }));

  return sendSuccess(res, { servers });
}));

// ──────────────────────────────────────────
// GET /api/admin/servers
//
// List every Embed_Server stored in MongoDB, ordered ascending by
// `priority`. Used by the admin dashboard's initial render. The
// public `embedServers.js` `loadFromMongoDB()` mode hits the
// dedicated `/public` endpoint above instead.
//
// Validates: Requirement 19.1
// ──────────────────────────────────────────
router.get('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const servers = await serverConfigService.getAll();
  return sendSuccess(res, { servers });
}));

// ──────────────────────────────────────────
// POST /api/admin/servers
//
// Create a new Embed_Server. Validates required fields + type-
// specific URL pattern rules at the route layer; the service layer
// owns priority management, duplicate-key detection, and cache
// invalidation.
//
// Status codes:
//   201 — created
//   400 — validation failure (missing field, bad URL pattern)
//   409 — duplicate key (thrown by serverConfigService.create)
//
// Validates: Requirements 19.2, 19.4
// ──────────────────────────────────────────
router.post('/', protect, adminOnly, asyncHandler(async (req, res) => {
  const validationError = _validateCreatePayload(req.body);
  if (validationError) {
    return sendError(res, new Error(validationError), {
      status: 400,
      code:   'SERVER_VALIDATION_ERROR',
    });
  }

  try {
    const created = await serverConfigService.create(req.body);
    return sendSuccess(
      res,
      { server: created },
      { status: 201, message: 'Server created' },
    );
  } catch (err) {
    // serverConfigService throws plain Errors with a numeric `.status`
    // field (409 on duplicate, 400 on bad input). Forward the status
    // through to the caller so the admin UI can render the right
    // inline error.
    if (err && Number.isInteger(err.status)) {
      return sendError(res, err, { status: err.status });
    }
    throw err;
  }
}));

// ──────────────────────────────────────────
// PUT /api/admin/servers/reorder    ← MUST come before /:key
//
// Reassign priorities to match the submitted `orderedKeys` array.
// `orderedKeys[0]` becomes priority 1, `[1]` becomes 2, and so on.
// The service rejects (HTTP 400) any submission that does not
// contain exactly the same set of keys currently in the collection.
//
// Validates: Requirement 19.5
// ──────────────────────────────────────────
router.put('/reorder', protect, adminOnly, asyncHandler(async (req, res) => {
  const orderedKeys = Array.isArray(req.body && req.body.orderedKeys)
    ? req.body.orderedKeys
    : null;

  if (!orderedKeys) {
    return sendError(res, new Error('orderedKeys must be an array'), {
      status: 400,
      code:   'SERVER_REORDER_INVALID_PAYLOAD',
    });
  }

  try {
    await serverConfigService.reorder(orderedKeys);
    return sendSuccess(res, { reordered: true });
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return sendError(res, err, { status: err.status });
    }
    throw err;
  }
}));

// ──────────────────────────────────────────
// GET /api/admin/servers/health    ← MUST come before /:key
//
// Return the most recent Health_Check result per Embed_Server,
// merged with the rolling stats stored on the EmbedServerConfig
// document. Drives the live status badges on the admin dashboard
// and the 60-second polling refresh.
//
// Response shape per entry:
//   {
//     serverKey, name, enabled,
//     status, responseTime, httpStatusCode, checkedAt,    ← from latest probe
//     lastCheckedAt, lastStatus, successRate, avgLoadTime  ← from config doc
//   }
//
// Servers that have never been probed yield a `null` for every
// probe-derived field; the config-derived fields still reflect
// the schema defaults (lastStatus=null, successRate=0, etc).
//
// Validates: Requirements 19.6, 2.1, 2.2
// ──────────────────────────────────────────
router.get('/health', protect, adminOnly, asyncHandler(async (req, res) => {
  const servers = await serverConfigService.getAll();

  // Fan out the per-server "latest health record" lookups in
  // parallel. Each probe is an independent indexed read, so the
  // fan-out cost is bounded by the slowest single round-trip.
  const health = await Promise.all(servers.map(async (server) => {
    const latest = await EmbedServerHealth
      .findOne({ serverKey: server.key })
      .sort({ checkedAt: -1 })
      .lean();

    return {
      serverKey:      server.key,
      name:           server.name,
      enabled:        server.enabled,
      // Latest probe sample (null when never probed).
      status:         latest ? latest.status         : null,
      responseTime:   latest ? latest.responseTime   : null,
      httpStatusCode: latest ? latest.httpStatusCode : null,
      checkedAt:      latest ? latest.checkedAt      : null,
      // Rolling stats from the config doc (populated by the cycle).
      lastCheckedAt:  server.lastCheckedAt || null,
      lastStatus:     server.lastStatus    || null,
      successRate:    typeof server.successRate === 'number' ? server.successRate : 0,
      avgLoadTime:    typeof server.avgLoadTime === 'number' ? server.avgLoadTime : 0,
    };
  }));

  return sendSuccess(res, { health });
}));

// ──────────────────────────────────────────
// POST /api/admin/servers/health/run    ← MUST come before /:key
// GET  /api/admin/servers/health/run    ← Vercel Cron uses GET
//
// Trigger a Health_Check cycle out-of-band (vs. the scheduled
// every-30-minutes cron run). Used by:
//
//   • Vercel Cron        — `x-vercel-cron: 1` header authorises
//                          the request via `cronOrAdmin`. Vercel
//                          always issues a GET for cron jobs, so
//                          we expose both verbs against the same
//                          handler.
//   • Admin dashboard    — "Run Health Check Now" button uses an
//                          admin JWT, also accepted by cronOrAdmin.
//
// The cycle can take several seconds to probe every server, so we
// reply HTTP 202 immediately and run the cycle in the background.
// `setImmediate` defers execution to the next event-loop tick,
// guaranteeing the response is flushed before any probe starts.
//
// The cycle promise is wrapped in `.catch()` so an unexpected
// rejection (which serverHealthService.runHealthCheckCycle is
// designed to never produce — it is itself wrapped in a top-level
// try/catch) cannot raise an unhandled-rejection warning.
//
// Validates: Requirements 19.7, 6.1, 6.9
// ──────────────────────────────────────────
const triggerHealthCycle = asyncHandler(async (req, res) => {
  // Capture whether the call came from Vercel Cron so we can log
  // the cycle source for downstream observability.
  const triggeredBy = req.user && req.user.isCron ? 'cron' : 'admin';

  // Send the response first — runHealthCheckCycle never resolves
  // before completing the probe loop, which can outlast a serverless
  // request budget. The cycle itself logs progress and outcomes.
  res.status(202).json({
    success: true,
    message: 'Health check cycle started',
    accepted: true,
    error: null,
  });

  // Defer to the next tick so the HTTP response flushes before any
  // probe network I/O begins.
  setImmediate(() => {
    serverHealthService.runHealthCheckCycle()
      .then((summary) => {
        logger.info('adminServers: health check cycle complete', {
          triggeredBy,
          ...summary,
        });
      })
      .catch((err) => {
        // serverHealthService is contractually obligated to never
        // throw, but we catch defensively so a future regression
        // cannot raise an unhandled-rejection warning on Vercel.
        logger.error('adminServers: health check cycle threw unexpectedly', {
          triggeredBy,
          error: err && err.message,
          stack: err && err.stack,
        });
      });
  });
});

router.post('/health/run', cronOrAdmin, triggerHealthCycle);
router.get('/health/run', cronOrAdmin, triggerHealthCycle);

// ──────────────────────────────────────────
// PUT /api/admin/servers/:key
//
// Patch mutable fields on an existing Embed_Server. The service
// layer enforces the mutable-field whitelist (key/_id/timestamps
// are immutable through this surface) and re-runs the priority
// renumber when `priority` changes.
//
// Status codes:
//   200 — updated (returns the canonical doc)
//   400 — validation failure raised by the service
//   404 — no doc with the supplied key
//
// Validates: Requirement 19.3
// ──────────────────────────────────────────
router.put('/:key', protect, adminOnly, asyncHandler(async (req, res) => {
  try {
    const updated = await serverConfigService.update(req.params.key, req.body || {});
    return sendSuccess(res, { server: updated });
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return sendError(res, err, { status: err.status });
    }
    throw err;
  }
}));

// ──────────────────────────────────────────
// DELETE /api/admin/servers/:key
//
// Remove an Embed_Server. The service layer handles the post-
// deletion priority renumber so the remaining sequence stays
// contiguous (Property 1 / Requirement 19.5).
//
// Status codes:
//   200 — deleted
//   404 — no doc with the supplied key
//
// Validates: Requirement 19.4
// ──────────────────────────────────────────
router.delete('/:key', protect, adminOnly, asyncHandler(async (req, res) => {
  try {
    const result = await removeServer(req.params.key);
    return sendSuccess(res, result);
  } catch (err) {
    if (err && Number.isInteger(err.status)) {
      return sendError(res, err, { status: err.status });
    }
    throw err;
  }
}));

module.exports = router;
