// ══════════════════════════════════════════
// CINE STREAM — ServerHealthService
// ──────────────────────────────────────────
// Service responsible for probing every enabled embed server,
// classifying the result, recording it to the embed_server_health
// collection, updating rolling health stats on the parent
// EmbedServerConfig document, and emitting in-app/email notifications
// on status transitions.
//
// Pure helpers (task 3.1):
//   • substitutePattern(pattern, vars)
//       Render a stored URL template for a probe call.
//
//   • classifyProbeResult(responseTime, httpStatusCode, timeout)
//       Three-way classification — Working / Degraded / Down.
//       Validates: Property 3 (Requirements 6.3, 6.4, 6.5).
//
//   • computeSuccessRate(results)
//       Percentage of `Working` results in [0, 100].
//       Validates: Property 4 (Requirements 6.7).
//
//   • computeAvgLoadTime(results)
//       Arithmetic mean of `responseTime` values, rounded to int.
//
// I/O surface (task 3.4):
//   • probeServer(server)
//       Fetch one server with AbortController-driven timeout and
//       classify the response. Never rejects.
//
//   • runHealthCheckCycle()
//       Probe every enabled server in parallel, persist probe
//       records, refresh rolling stats on each EmbedServerConfig,
//       prune health records older than 30 days, and dispatch
//       transition notifications. Never throws — the cron entry
//       point relies on this contract (Req 6.9).
//
// Notifications (task 3.5):
//   • shouldNotify(previousStatus, newStatus)
//       Pure predicate — true only on a real transition between
//       non-null statuses. Validates Property 6 (Req 7.6).
//
// The pure helpers above have no MongoDB access, no I/O, and no
// module-level state. The I/O surface uses MongoDB and the global
// `fetch` (Node 18+) but isolates every external call inside its
// own try/catch so that one bad server can never poison the cycle.
//
// Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8,
//            6.9, 6.10, 7.1, 7.2, 7.3, 7.5, 7.6, 21.2
// ══════════════════════════════════════════
const EmbedServerHealth   = require('../models/EmbedServerHealth');
const EmbedServerConfig   = require('../models/EmbedServerConfig');
const Notification        = require('../models/Notification');
const User                = require('../models/User');
const serverConfigService = require('./serverConfigService');
const logger              = require('../config/logger');
const { getEnv, hasEnv }  = require('../config/env');

// ── Constants ────────────────────────────────────────────
// 30 days in milliseconds. Used both as the rolling window for
// successRate / avgLoadTime aggregation and as the cutoff for
// the explicit cleanup pass that backstops the TTL index on
// EmbedServerHealth (Req 6.10).
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Default Probe_Title IDs used when the deployment has not
// configured HEALTH_CHECK_PROBE_TMDB_ID / HEALTH_CHECK_PROBE_ANILIST_ID.
//   • 577922 — "Tenet" (2020), a stable, widely-cached TMDB entry.
//   • 1      — "Cowboy Bebop", AniList ID 1, equally stable.
// These IDs live on virtually every embed provider, so a probe
// missing here genuinely indicates the server is misbehaving.
const DEFAULT_PROBE_TMDB_ID    = '577922';
const DEFAULT_PROBE_ANILIST_ID = '1';

// Fallback timeout in milliseconds. EmbedServerConfig.timeout has a
// schema default of 9000 so this is only reached when a malformed
// server doc reaches probeServer with timeout = null/undefined/NaN.
const DEFAULT_PROBE_TIMEOUT_MS = 9000;

// ══════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════

/**
 * Substitute placeholders in a stored URL pattern with concrete
 * values from a `vars` object.
 *
 * Recognised placeholders (matched case-sensitively, all occurrences
 * replaced):
 *
 *   {tmdbId}     → vars.tmdbId
 *   {season}     → vars.season
 *   {episode}    → vars.episode
 *   {anilistId}  → vars.anilistId
 *
 * Any placeholder whose corresponding key is `undefined` or `null`
 * on `vars` is replaced with an empty string. Unknown placeholders
 * inside the pattern are left untouched. The function never throws.
 *
 * Used by the probe loop (task 3.4) to build the request URL for a
 * given EmbedServerConfig + Probe_Title pair, and by the watch route
 * (task 7.1) when constructing the player's source list. This is the
 * forward direction of the round-trip described in Property 2.
 *
 * @example
 *   substitutePattern(
 *     'https://x.com/{tmdbId}/{season}/{episode}',
 *     { tmdbId: 100, season: 1, episode: 5 }
 *   )
 *   // → 'https://x.com/100/1/5'
 *
 * @param {string}  pattern  URL template with {placeholder} markers.
 * @param {object}  [vars]   Values for the recognised placeholders.
 * @returns {string} The pattern with all known placeholders replaced.
 */
function substitutePattern(pattern, vars) {
  if (typeof pattern !== 'string') {
    return '';
  }

  const safeVars = vars || {};

  // `replaceAll` is available on Node 18+ (see package.json engines).
  // Each replacement coerces the value via String() so numeric
  // tmdb/anilist IDs round-trip cleanly. `?? ''` collapses both
  // `undefined` and `null` to empty string per the contract above.
  return pattern
    .replaceAll('{tmdbId}',    String(safeVars.tmdbId    ?? ''))
    .replaceAll('{season}',    String(safeVars.season    ?? ''))
    .replaceAll('{episode}',   String(safeVars.episode   ?? ''))
    .replaceAll('{anilistId}', String(safeVars.anilistId ?? ''));
}

/**
 * Three-way classification of a single probe result, implementing
 * the truth table from Requirement 6.3 / 6.4 / 6.5.
 *
 *   responseTime  httpStatusCode  →  classification
 *   ────────────  ──────────────     ─────────────
 *   ≤ timeout      === 200          Working
 *   ≤ timeout      !== 200          Degraded
 *   > timeout       (any)           Down
 *
 * Note that the timeout case takes precedence: a probe that overran
 * its budget is `Down` regardless of the status code received late.
 * The probe loop (task 3.4) is expected to call this with
 * `responseTime = timeout` when the underlying request actually
 * timed out, which correctly falls into the `Down` branch via the
 * `>` boundary check above (`> timeout` is strict, not `>=`, because
 * a probe that returned at exactly the timeout deadline did succeed).
 *
 * @param {number}      responseTime    Measured response time in ms.
 * @param {number|null} httpStatusCode  HTTP status, or null on timeout.
 * @param {number}      timeout         Configured timeout budget in ms.
 * @returns {'Working'|'Degraded'|'Down'}
 */
function classifyProbeResult(responseTime, httpStatusCode, timeout) {
  if (responseTime > timeout) {
    return 'Down';
  }
  if (httpStatusCode === 200) {
    return 'Working';
  }
  return 'Degraded';
}

/**
 * Compute the success rate of a sequence of probe results — the
 * percentage of entries with `status === 'Working'`.
 *
 * Returns a number in the closed interval [0, 100]. An empty input
 * array yields 0 (no observations means no demonstrated successes).
 * Non-`Working` statuses (`Degraded`, `Down`, missing/unknown) all
 * count toward the denominator but never the numerator.
 *
 * Property 4 guarantees the result is always within [0, 100] for
 * any input length 1..1000.
 *
 * @param {{ status?: string }[]} results
 * @returns {number} Success percentage in [0, 100].
 */
function computeSuccessRate(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 0;
  }

  let workingCount = 0;
  for (const r of results) {
    if (r && r.status === 'Working') {
      workingCount += 1;
    }
  }

  return (workingCount / results.length) * 100;
}

/**
 * Compute the arithmetic mean of `responseTime` values across a
 * sequence of probe results, rounded to the nearest integer.
 *
 * Returns 0 for an empty input. Non-numeric or missing
 * `responseTime` fields contribute 0 to the sum but still count
 * toward the divisor — i.e. the function reports the average over
 * the full result set, not just the entries with a valid timing.
 *
 * The output is always a non-negative integer because:
 *   1. probe response times are measured durations (≥ 0), and
 *   2. `Math.round` of a non-negative real is a non-negative int.
 *
 * @param {{ responseTime?: number }[]} results
 * @returns {number} Mean response time in ms, rounded to integer.
 */
function computeAvgLoadTime(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return 0;
  }

  let sum = 0;
  for (const r of results) {
    const rt = r && typeof r.responseTime === 'number' ? r.responseTime : 0;
    sum += rt;
  }

  return Math.round(sum / results.length);
}

/**
 * Return `true` when a server's classified status has changed
 * between consecutive checks — i.e. when a notification is required
 * by Requirement 7.1, 7.2, or 7.3. Used by the runtime cycle to
 * suppress duplicate alerts (Requirement 7.6).
 *
 * Special cases:
 *   • `previousStatus` is `null` / `undefined` → return `false`.
 *     This is the "first probe ever" state where a fresh
 *     EmbedServerConfig has no recorded history. Treating the
 *     transition `null → Working` (or any other value) as a
 *     notifiable event would produce a startup alert storm on
 *     fresh deployments, which is not the spec's intent.
 *
 *   • Both statuses equal → return `false`. This is the steady
 *     state covered explicitly by Property 6 (Requirement 7.6).
 *
 *   • Statuses differ and `previousStatus` is non-null → `true`.
 *
 * The function is intentionally agnostic about *which* statuses
 * are involved; the caller decides which Notification template
 * to emit based on the new status. This keeps the predicate
 * trivially testable in isolation (Property 6).
 *
 * @param {string|null|undefined} previousStatus
 * @param {string} newStatus
 * @returns {boolean}
 */
function shouldNotify(previousStatus, newStatus) {
  if (previousStatus === null || previousStatus === undefined) {
    return false;
  }
  return previousStatus !== newStatus;
}

// ══════════════════════════════════════════
// PROBE LOOP (task 3.4) — Requirements 6.1, 6.2, 6.6, 6.7,
//                         6.8, 6.9, 6.10
// ══════════════════════════════════════════

/**
 * Pick the URL pattern to probe for a single server document.
 *
 * Priority within a `standard` server:
 *   1. tvUrlPattern  — preferred when present, exercises the full
 *                      {tmdbId}/{season}/{episode} substitution.
 *   2. movieUrlPattern — fallback when only movie playback is wired up.
 *
 * For an `anime` server, animeUrlPattern is the only valid choice.
 *
 * Returns `null` when the server is misconfigured (no usable pattern).
 * The probe loop treats that as a Down result with httpStatusCode null.
 *
 * @param {{ type: string, movieUrlPattern?: string|null, tvUrlPattern?: string|null, animeUrlPattern?: string|null }} server
 * @returns {string|null}
 * @private
 */
function _pickPattern(server) {
  if (!server) return null;

  if (server.type === 'anime') {
    return server.animeUrlPattern || null;
  }

  // Default to standard — be permissive about unknown types so a
  // future schema migration can't crash the probe loop.
  return server.tvUrlPattern || server.movieUrlPattern || null;
}

/**
 * Build the substitution variables for a probe call from the
 * configured Probe_Title env vars (with safe defaults).
 *
 * The same vars object is fed into substitutePattern() regardless of
 * the server type because pattern strings only contain the
 * placeholders relevant to their own type — extras are simply not
 * matched (substitutePattern is a no-op on unmatched placeholders).
 *
 * @returns {{ tmdbId: string, season: number, episode: number, anilistId: string }}
 * @private
 */
function _probeVars() {
  return {
    tmdbId:    getEnv('HEALTH_CHECK_PROBE_TMDB_ID',    DEFAULT_PROBE_TMDB_ID),
    season:    1,
    episode:   1,
    anilistId: getEnv('HEALTH_CHECK_PROBE_ANILIST_ID', DEFAULT_PROBE_ANILIST_ID),
  };
}

/**
 * Probe a single embed server.
 *
 * Issues a GET request via Node's built-in `fetch` with an
 * AbortController wired to the server's configured timeout. Measures
 * elapsed wall-clock time around the await, classifies the outcome
 * via `classifyProbeResult`, and returns a normalised result object.
 *
 * Failure modes (network error, DNS failure, abort/timeout) all
 * collapse into `{ status: 'Down', responseTime: timeout, httpStatusCode: null }`
 * so the cycle never sees a rejection from this function. This keeps
 * the `Promise.allSettled` post-processing in `runHealthCheckCycle`
 * trivial — every fulfilment is a usable result, but `allSettled`
 * still defends against the impossible "this throws synchronously"
 * case (Req 6.9).
 *
 * @param {object} server — EmbedServerConfig POJO (lean read).
 * @returns {Promise<{ serverKey: string, status: 'Working'|'Degraded'|'Down', responseTime: number, httpStatusCode: number|null }>}
 */
async function probeServer(server) {
  const serverKey = server && server.key ? server.key : 'unknown';

  const timeout = Number.isInteger(server && server.timeout) && server.timeout > 0
    ? server.timeout
    : DEFAULT_PROBE_TIMEOUT_MS;

  const pattern = _pickPattern(server);
  if (!pattern) {
    logger.warn('ServerHealthService.probeServer: no usable URL pattern for server', {
      serverKey,
      type: server && server.type,
    });
    return {
      serverKey,
      status:         'Down',
      responseTime:   timeout,
      httpStatusCode: null,
    };
  }

  const url = substitutePattern(pattern, _probeVars());

  // Wire AbortController to the server's timeout budget. The
  // timer is cleared in the `finally` block so a fast probe does
  // not leave a dangling setTimeout handle.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  const startedAt = Date.now();
  let responseTime = timeout; // overwritten only on a real response
  let httpStatusCode = null;

  try {
    const response = await fetch(url, {
      method: 'GET',
      signal: controller.signal,
      // `redirect: 'follow'` is fetch's default; many embed providers
      // 302 to a CDN. We accept the redirected status as the probe
      // outcome — a Working server is one that ultimately returns 200.
      redirect: 'follow',
    });

    responseTime   = Date.now() - startedAt;
    httpStatusCode = response.status;

    return {
      serverKey,
      status: classifyProbeResult(responseTime, httpStatusCode, timeout),
      responseTime,
      httpStatusCode,
    };
  } catch (err) {
    // AbortError, network/DNS failures, and TLS errors all funnel
    // here. We always log at warn (not error) because individual
    // probe failures are expected operational signal, not bugs.
    const elapsed = Date.now() - startedAt;
    const isAbort = err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');

    logger.warn('ServerHealthService.probeServer: probe failed', {
      serverKey,
      url,
      timeoutMs:    timeout,
      elapsedMs:    elapsed,
      aborted:      isAbort,
      errorName:    err && err.name,
      errorMessage: err && err.message,
    });

    // Per spec: on network error or timeout, responseTime equals
    // the configured timeout. This makes downstream classification
    // and stats reporting consistent regardless of *why* the probe
    // failed (Req 6.5).
    return {
      serverKey,
      status:         'Down',
      responseTime:   timeout,
      httpStatusCode: null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Refresh rolling stats on a single EmbedServerConfig document
 * using the last 30 days of EmbedServerHealth records.
 *
 * Splits out from runHealthCheckCycle so the per-server failure of
 * a stats refresh (e.g. transient Mongo error) cannot abort the
 * outer loop.
 *
 * @param {string} serverKey
 * @param {{ status: string, responseTime: number, httpStatusCode: number|null, checkedAt: Date }} latest
 * @param {Date}   thirtyDaysAgo
 * @returns {Promise<void>}
 * @private
 */
async function _refreshConfigStats(serverKey, latest, thirtyDaysAgo) {
  // Pull the rolling window (latest record is already inserted, so
  // it counts toward the stats — that's the contract from Req 6.7).
  const recent = await EmbedServerHealth
    .find({ serverKey, checkedAt: { $gte: thirtyDaysAgo } }, {
      status:       1,
      responseTime: 1,
      _id:          0,
    })
    .lean();

  const successRate = computeSuccessRate(recent);
  const avgLoadTime = computeAvgLoadTime(recent);

  await EmbedServerConfig.updateOne(
    { key: serverKey },
    {
      $set: {
        lastCheckedAt: latest.checkedAt,
        lastStatus:    latest.status,
        successRate,
        avgLoadTime,
      },
    },
  );
}

// ══════════════════════════════════════════
// NOTIFICATIONS (task 3.5) — Requirements 7.1, 7.2, 7.3, 7.5, 7.6
// ══════════════════════════════════════════

/**
 * Map a (previousStatus, newStatus) transition to the in-app
 * notification payload required by Requirements 7.1 / 7.2 / 7.3.
 * Returns `null` when the transition does not match any of the
 * three notification templates (e.g. a `Down → Degraded` recovery
 * still warrants an info recovery — see below).
 *
 * Templates per spec:
 *   newStatus === 'Down'      → server_down,      severity 'critical'
 *   newStatus === 'Degraded'  → server_degraded,  severity 'warning'
 *   newStatus === 'Working'   → server_recovered, severity 'info'
 *
 * Note: Requirement 7.3 fires the recovery notification on
 * `Down → Working` OR `Degraded → Working`. Requirement 7.2 fires
 * `Working → Degraded`. We intentionally do NOT emit a notification
 * on `Down → Degraded` — the spec only lists three templates and
 * none of them cover that intermediate transition. The next probe
 * will either escalate it to Down again or progress to Working.
 *
 * @param {string} serverName
 * @param {string} newStatus
 * @returns {{ type: string, severity: string, title: string, message: string }|null}
 * @private
 */
function _buildTransitionNotification(serverName, newStatus) {
  const safeName = serverName || 'unknown';

  if (newStatus === 'Down') {
    return {
      type:     'server_down',
      severity: 'critical',
      title:    `Server ${safeName} is Down`,
      message:  `Server ${safeName} is Down`,
    };
  }
  if (newStatus === 'Degraded') {
    return {
      type:     'server_degraded',
      severity: 'warning',
      title:    `Server ${safeName} is Degraded`,
      message:  `Server ${safeName} is Degraded`,
    };
  }
  if (newStatus === 'Working') {
    return {
      type:     'server_recovered',
      severity: 'info',
      title:    `Server ${safeName} has recovered`,
      message:  `Server ${safeName} has recovered`,
    };
  }
  return null;
}

/**
 * Broadcast an in-app notification to every admin user.
 *
 * The Notification schema requires `user` to be a non-null
 * ObjectId reference, so a single "broadcast" document is not
 * supported. Instead we materialise one Notification per admin
 * via a single `insertMany` call. This matches the existing
 * `notifyAllUsers` pattern in `backend/notificationHelper.js`
 * but scopes the audience to admins and preserves the new
 * `severity` field that the in-app feed renders.
 *
 * Failure is logged at `warn` and swallowed: the spec
 * (Requirement 6.9) requires the health check cycle to never
 * crash, and Requirement 7 deliberately does not couple
 * notification delivery to probe persistence.
 *
 * @param {{ type: string, title: string, message: string, severity: string, link?: string|null }} payload
 * @returns {Promise<void>}
 * @private
 */
async function _notifyAdmins(payload) {
  try {
    const admins = await User.find({ role: 'admin' }, '_id').lean();
    if (!admins || admins.length === 0) {
      // No admins configured — there's nothing to do, but log
      // at debug level so operators investigating a missing
      // alert can see the cycle did try to fan out.
      logger.debug('ServerHealthService._notifyAdmins: no admin users to notify', {
        type: payload.type,
      });
      return;
    }

    const docs = admins.map((admin) => ({
      user:     admin._id,
      type:     payload.type,
      title:    payload.title,
      message:  payload.message,
      severity: payload.severity,
      link:     payload.link || null,
      image:    null,
    }));

    await Notification.insertMany(docs, { ordered: false });

    logger.info('ServerHealthService._notifyAdmins: admin alert dispatched', {
      type:     payload.type,
      severity: payload.severity,
      count:    docs.length,
    });
  } catch (err) {
    logger.warn('ServerHealthService._notifyAdmins: notification dispatch failed', {
      error: err.message,
      type:  payload && payload.type,
    });
  }
}

/**
 * Email the configured `ADMIN_EMAIL` address when a server
 * transitions to `Down` (Requirement 7.5). The deployment is
 * not yet wired to an SMTP provider, so this implementation
 * logs a clearly tagged `[EMAIL]` line containing every datum
 * the spec requires (server name, timestamp, dashboard link).
 * A future commit can swap the log-only body for an actual
 * mailer call without changing the call site.
 *
 * The `ADMIN_EMAIL` env var has a default value (`admin@cinestream.local`)
 * baked into `backend/config/env.js`, so we use `hasEnv` instead
 * of `getEnv` to detect *explicit* configuration. This avoids
 * spamming the placeholder address on every Down transition in
 * dev environments where the operator has not opted in.
 *
 * @param {string} serverName
 * @param {Date}   checkedAt
 * @returns {Promise<void>}
 * @private
 */
async function _sendAdminEmailOnDown(serverName, checkedAt) {
  if (!hasEnv('ADMIN_EMAIL')) {
    return;
  }

  const adminEmail = getEnv('ADMIN_EMAIL');
  const dashboardLink = '/admin.html#server-health';

  // Log-only placeholder until SMTP integration ships. Tag the
  // line with a stable `[EMAIL]` prefix so log-based alerting can
  // still pick this up downstream.
  logger.info('[EMAIL] Server Down alert', {
    to:        adminEmail,
    server:    serverName,
    timestamp: checkedAt.toISOString(),
    link:      dashboardLink,
    subject:   `[CinePulse] Server ${serverName} is Down`,
  });
}

/**
 * Run a full health check cycle:
 *
 *   1. Fetch every *enabled* server (Req 6.1) via ServerConfigService
 *      so the 5-minute config cache is honoured for adjacent reads.
 *   2. Probe all servers in parallel via Promise.allSettled (Req 6.8).
 *      A single rejected probe never aborts the cycle — although in
 *      practice probeServer never rejects.
 *   3. Insert one EmbedServerHealth document per result.
 *   4. Refresh rolling stats (lastCheckedAt, lastStatus, successRate,
 *      avgLoadTime) on each EmbedServerConfig (Req 6.6, 6.7).
 *   5. Delete EmbedServerHealth documents older than 30 days
 *      (Req 6.10) — TTL index handles this asynchronously, but the
 *      explicit pass guarantees the spec contract regardless of TTL
 *      monitor scheduling.
 *   6. Emit in-app notifications and the optional admin email for
 *      every (previousStatus, newStatus) transition (Req 7.1, 7.2,
 *      7.3, 7.5, 7.6). Notification failures are isolated and
 *      logged; they do not abort the cycle.
 *   7. Catch every error at the top level so the cron entry point
 *      never crashes (Req 6.9). Each failure mode is logged with
 *      enough context to triage from logs alone.
 *
 * Notification emission is wired in via task 3.5; the
 * (previousStatus, newStatus) pair is sampled from the lean server
 * docs BEFORE step 4 overwrites the lastStatus field, so the
 * transition check is always against last cycle's snapshot.
 *
 * @returns {Promise<{ probed: number, working: number, degraded: number, down: number, elapsedMs: number, error?: string }>}
 */
async function runHealthCheckCycle() {
  const cycleStartedAt = Date.now();
  const checkedAt      = new Date(cycleStartedAt);
  const thirtyDaysAgo  = new Date(cycleStartedAt - THIRTY_DAYS_MS);

  let summary = {
    probed:    0,
    working:   0,
    degraded:  0,
    down:      0,
    elapsedMs: 0,
  };

  try {
    // 1. Fetch enabled servers.
    const servers = await serverConfigService.getEnabled();
    if (!Array.isArray(servers) || servers.length === 0) {
      logger.info('ServerHealthService.runHealthCheckCycle: no enabled servers, nothing to probe');
      summary.elapsedMs = Date.now() - cycleStartedAt;
      return summary;
    }

    // 2. Probe in parallel. Promise.allSettled is the explicit
    //    contract from the spec — even though probeServer never
    //    rejects, the defensive `if (settled.status === 'fulfilled')`
    //    branch below means a future regression cannot silently
    //    drop probes from the cycle.
    const settledResults = await Promise.allSettled(
      servers.map((s) => probeServer(s)),
    );

    // Snapshot the previous lastStatus per server BEFORE we update
    // any EmbedServerConfig documents below. The lean docs returned
    // by serverConfigService.getEnabled() carry the lastStatus field
    // from the previous cycle (or `null` for never-probed servers).
    // We need this map for the transition check in step 6 because
    // step 4 (`_refreshConfigStats`) overwrites lastStatus.
    const previousStatusByKey = new Map();
    const serverNameByKey     = new Map();
    for (const s of servers) {
      if (s && s.key) {
        previousStatusByKey.set(s.key, s.lastStatus ?? null);
        serverNameByKey.set(s.key, s.name || s.key);
      }
    }

    // Build the array of result objects we will persist. Rejected
    // settlements (shouldn't happen, but defensible) collapse to
    // a Down record so the EmbedServerConfig still gets refreshed.
    const probeResults = settledResults.map((settled, idx) => {
      const server = servers[idx];
      if (settled.status === 'fulfilled' && settled.value) {
        return settled.value;
      }
      logger.warn('ServerHealthService.runHealthCheckCycle: probe rejected unexpectedly', {
        serverKey: server && server.key,
        reason:    settled.reason && settled.reason.message,
      });
      return {
        serverKey:      server && server.key ? server.key : 'unknown',
        status:         'Down',
        responseTime:   server && Number.isInteger(server.timeout)
          ? server.timeout
          : DEFAULT_PROBE_TIMEOUT_MS,
        httpStatusCode: null,
      };
    });

    // 3. Persist health records. insertMany is faster than
    //    individual inserts and atomic-per-document with
    //    `ordered: false` — one bad record cannot block the rest.
    const healthDocs = probeResults.map((r) => ({
      serverKey:      r.serverKey,
      status:         r.status,
      responseTime:   r.responseTime,
      httpStatusCode: r.httpStatusCode,
      checkedAt,
    }));

    try {
      await EmbedServerHealth.insertMany(healthDocs, { ordered: false });
    } catch (insertErr) {
      // BulkWriteError still records the successful inserts. We log
      // and continue so the EmbedServerConfig refresh can still run.
      logger.error('ServerHealthService.runHealthCheckCycle: insertMany partial failure', {
        error: insertErr.message,
      });
    }

    // 4. Refresh rolling stats on each EmbedServerConfig. We run
    //    these in parallel as well — they are independent updates
    //    against different documents, so there's no contention.
    await Promise.allSettled(
      probeResults.map((r) => _refreshConfigStats(r.serverKey, {
        status:       r.status,
        responseTime: r.responseTime,
        httpStatusCode: r.httpStatusCode,
        checkedAt,
      }, thirtyDaysAgo)),
    );

    // 5. Explicit cleanup of records older than 30 days. The TTL
    //    index will eventually do this, but the spec asks for an
    //    explicit pass each cycle (Req 6.10) so behaviour is
    //    deterministic even if TTL monitoring is paused.
    try {
      const deleted = await EmbedServerHealth.deleteMany({
        checkedAt: { $lt: thirtyDaysAgo },
      });
      if (deleted && deleted.deletedCount > 0) {
        logger.info('ServerHealthService.runHealthCheckCycle: pruned old health records', {
          deletedCount: deleted.deletedCount,
        });
      }
    } catch (cleanupErr) {
      // Cleanup failure is non-fatal — the TTL index is still in
      // place as a backstop.
      logger.warn('ServerHealthService.runHealthCheckCycle: cleanup pass failed', {
        error: cleanupErr.message,
      });
    }

    // 6. Notify on status transitions (Req 7.1, 7.2, 7.3, 7.5, 7.6).
    //    Each notification dispatch is independent and isolated
    //    inside its own promise so a single Mongo write failure
    //    cannot cascade into a silent drop of unrelated alerts.
    //    Promise.allSettled gives us best-effort fan-out semantics
    //    while still letting the cycle complete normally.
    const notificationTasks = [];
    for (const r of probeResults) {
      const previousStatus = previousStatusByKey.get(r.serverKey) ?? null;
      if (!shouldNotify(previousStatus, r.status)) {
        continue;
      }

      const serverName = serverNameByKey.get(r.serverKey) || r.serverKey;
      const payload    = _buildTransitionNotification(serverName, r.status);
      if (!payload) {
        // Transition is real but does not match any of the three
        // notification templates (e.g. Down → Degraded). Skip
        // silently — the spec does not require an alert here.
        continue;
      }

      notificationTasks.push(_notifyAdmins(payload));

      // Email-on-Down is fire-and-forget alongside the in-app
      // notification. Both share the same Promise.allSettled
      // bucket so a stuck email transport cannot delay the cycle.
      if (r.status === 'Down') {
        notificationTasks.push(_sendAdminEmailOnDown(serverName, checkedAt));
      }
    }

    if (notificationTasks.length > 0) {
      await Promise.allSettled(notificationTasks);
    }

    // 7. Tally summary stats.
    for (const r of probeResults) {
      summary.probed += 1;
      if      (r.status === 'Working')  summary.working  += 1;
      else if (r.status === 'Degraded') summary.degraded += 1;
      else if (r.status === 'Down')     summary.down     += 1;
    }
    summary.elapsedMs = Date.now() - cycleStartedAt;

    logger.info('ServerHealthService.runHealthCheckCycle: cycle complete', summary);
    return summary;
  } catch (err) {
    // Top-level guard (Req 6.9). The cron caller relies on this
    // function NEVER throwing — a thrown error there would surface
    // as a 500 to Vercel Cron and skew retry metrics.
    summary.elapsedMs = Date.now() - cycleStartedAt;
    logger.error('ServerHealthService.runHealthCheckCycle: cycle failed', {
      error: err.message,
      stack: err.stack,
      ...summary,
    });
    return { ...summary, error: err.message };
  }
}

// ══════════════════════════════════════════
// SINGLETON EXPORT
// ──────────────────────────────────────────
// Frozen object mirroring the shape of serverConfigService so that
// callers (route handlers, tests, the cron entry point) can import
// it consistently. `probeServer` is exposed alongside the cycle so
// task 5.1's manual-trigger admin endpoint can dry-run a single
// server without scheduling a full cycle.
// ══════════════════════════════════════════
module.exports = Object.freeze({
  // Pure helpers (task 3.1)
  substitutePattern,
  classifyProbeResult,
  computeSuccessRate,
  computeAvgLoadTime,

  // Notification predicate (task 3.5)
  shouldNotify,

  // I/O surface (task 3.4)
  probeServer,
  runHealthCheckCycle,
});
