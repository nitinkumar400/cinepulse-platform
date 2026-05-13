# CinePulse — System Health, SEO & Security Audit

**Audit Date:** 2026-05-13  
**Auditor Role:** Senior QA Engineer & Security Auditor  
**Scope:** Post Phase-3 architectural upgrade + 50,000-record database seed  
**Directive:** READ-ONLY. No files were modified during this audit.

---

## Executive Summary

| Category | PASS | WARNING | FAIL |
|----------|------|---------|------|
| A. Security & Cron Automation | 3 | 2 | 1 |
| B. Frontend & Player | 2 | 1 | 1 |
| C. SEO & Routing | 3 | 1 | 0 |
| D. Database Health | 1 | 1 | 0 |
| **Totals** | **9** | **5** | **2** |

Two **FAIL** items require immediate attention before the next production deployment. Five **WARNING** items should be addressed in the next sprint.

---

## A. Security & Cron Automation Audit

---

### A-1. Cron Auth — Timing-Safe Comparison `[PASS]`

**File:** `backend/middleware/authMiddleware.js`, lines 149–170

The `cronOrAdmin` middleware correctly uses `crypto.timingSafeEqual` to compare the incoming Bearer token against `CRON_SECRET`. The implementation handles the length-mismatch edge case by padding to a fixed-length buffer before comparison, which prevents a timing oracle from leaking the secret length.

```js
// Lines 152–163 — correct implementation
const secretBuf  = Buffer.from(cronSecret);
const tokenBuf   = Buffer.from(token);
const lengthsMatch = secretBuf.length === tokenBuf.length;
const a = lengthsMatch ? secretBuf : Buffer.alloc(secretBuf.length);
const b = lengthsMatch ? tokenBuf  : Buffer.alloc(secretBuf.length);
const { timingSafeEqual } = require('crypto');
if (lengthsMatch && timingSafeEqual(a, b)) { ... }
```

The 32-character minimum length check on line 152 (`cronSecret.length >= 32`) prevents accidental weak secrets. **No action required.**

---

### A-2. Cron Auth — Vercel Cron Does NOT Send Authorization Header `[FAIL]`

**File:** `vercel.json`, lines 32–35 + `backend/middleware/authMiddleware.js`

**This is the most critical finding in the audit.**

Vercel's built-in Cron Jobs (`"crons": [...]` in `vercel.json`) call the configured path as a plain HTTP GET/POST request. **Vercel does not automatically inject an `Authorization: Bearer <CRON_SECRET>` header.** The `cronOrAdmin` middleware requires a Bearer token to be present, so every Vercel-triggered cron call will receive a `401 Authentication required` response and the sync will silently fail every night.

**Evidence:**
```json
// vercel.json lines 32–35
"crons": [
  { "path": "/api/sync",       "schedule": "0 3 * * *" },
  { "path": "/api/sync/anime", "schedule": "30 3 * * *" }
]
```

Vercel Cron sends the `x-vercel-cron: 1` header (on Pro/Enterprise plans) but **not** an Authorization header. The middleware never checks for `x-vercel-cron`.

**How to patch safely (two options — pick one):**

**Option A — Check `x-vercel-cron` header (recommended for Vercel Pro):**
In `cronOrAdmin`, before the Bearer token check, add:
```js
// Add at the top of cronOrAdmin, before the token check
const isVercelCron = req.headers['x-vercel-cron'] === '1';
if (isVercelCron) {
  req.user = { _id: 'cron-scheduler', id: 'cron-scheduler',
               username: 'cron', role: 'admin', isCron: true };
  return next();
}
```
> ⚠️ `x-vercel-cron` is only sent on Vercel Pro/Enterprise. On Hobby plans, use Option B.

**Option B — Use a Vercel Cron Wrapper route (works on all plans):**
Create a separate route `/api/cron/sync` that reads `CRON_SECRET` from the environment directly (no Bearer header needed) and calls the sync logic internally. Register it without `cronOrAdmin`. Point `vercel.json` crons at this new route.

---

### A-3. Rate Limiting — `/api/sync` Has No Dedicated Limiter `[WARNING]`

**File:** `backend/server.js`, line 275 + `backend/middleware/rateLimiter.js`, lines 31–36

The `/api/sync` route is mounted without any rate limiter:
```js
// server.js line 275 — no limiter applied
app.use('/api/sync', syncRoutes);
```

The `globalApiLimiter` (250 req / 15 min) does apply to `/api/sync` because it is mounted on `/api` globally. However, the `globalApiLimiter` has a `skip()` function that exempts `/auth`, `/movies`, and `/ai` — but **not** `/sync`. So the global limiter does technically cover `/sync`.

The concern is that 250 requests per 15 minutes is generous for an endpoint that triggers expensive TMDB + AniList API calls and MongoDB bulk writes. A malicious admin token holder could hammer this endpoint and exhaust your TMDB API quota.

**How to patch:**
Add a dedicated tight limiter for sync routes in `rateLimiter.js`:
```js
const syncLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 60 * 1000, // 1 hour window
  max: 5,                    // max 5 sync calls per hour per IP
  handler: buildRateLimitHandler('Sync rate limit exceeded. Please wait before syncing again.'),
});
```
Then in `server.js`:
```js
app.use('/api/sync', syncLimiter, syncRoutes);
```

---

### A-4. Rate Limiting — `/api/movies` and `/api/auth` Are Correctly Protected `[PASS]`

**File:** `backend/server.js`, lines 270–271 + `backend/middleware/rateLimiter.js`

```js
app.use('/api/auth',   authLimiter,  authRoutes);   // 12 req / 15 min
app.use('/api/movies', movieLimiter, movieRoutes);  // 180 req / 15 min
```

`authLimiter` at 12 requests per 15-minute window is appropriately tight for login/register endpoints. `movieLimiter` at 180 requests per 15 minutes is reasonable for a public browsing API. **No action required.**

---

### A-5. CORS Wildcard in Production `[WARNING]`

**File:** `backend/server.js`, line 141 + `vercel.json`, lines 36–43

Two separate wildcard CORS configurations exist and they compound each other:

**Issue 1 — Express CORS:**
```js
// server.js line 141
origin: runtime === 'production' ? '*' : corsOriginHandler,
```
In production, Express allows requests from any origin. This means any website can make credentialed-looking API calls to your backend.

**Issue 2 — Vercel headers:**
```json
// vercel.json lines 36–43
"headers": [
  { "source": "/(.*)", "headers": [
    { "key": "Access-Control-Allow-Origin", "value": "*" }
  ]}
]
```
This applies `Access-Control-Allow-Origin: *` to **every route**, including `/api/auth` and `/api/sync`. This header on auth endpoints means any malicious site can read the JSON response body of a login attempt.

**Note:** Because `credentials: runtime !== 'production'` is set in the Express CORS config, cookies are not sent cross-origin in production. The risk is limited to token-based auth leakage via XSS on third-party sites. However, it is still a security posture concern.

**How to patch:**
In `server.js`, replace the wildcard with your actual domain:
```js
origin: runtime === 'production'
  ? ['https://cinepulse-platform.vercel.app', 'https://your-custom-domain.com']
  : corsOriginHandler,
```
In `vercel.json`, remove the global `Access-Control-Allow-Origin: *` header block entirely, or restrict it to static asset paths only:
```json
{ "source": "/pages/(.*)", "headers": [
  { "key": "Access-Control-Allow-Origin", "value": "*" }
]}
```

---

### A-6. `/health` Endpoint Leaks Internal Metrics Publicly `[WARNING]`

**File:** `backend/server.js`, lines 190–207

The `/health` endpoint is publicly accessible (no auth) and returns:
```json
{
  "uptime": 12345.67,
  "memory": { "rss": 89128960, "heapTotal": 52428800, ... },
  "dependencies": { "mongo": { "readyState": 1, "host": "cluster0.xxx.mongodb.net", ... } }
}
```

Exposing `process.memoryUsage()`, `process.uptime()`, and MongoDB connection details (including the cluster hostname) to the public internet gives an attacker useful reconnaissance data for timing attacks and targeted DoS.

**How to patch:**
Add a simple IP allowlist or internal-only check. At minimum, strip sensitive fields in production:
```js
app.get('/health', (req, res) => {
  const mongo = getMongoHealth();
  const healthy = mongo.readyState === 1;
  const isProd = getEnv('NODE_ENV') === 'production';
  return res.status(healthy ? 200 : 503).json({
    success: healthy,
    service: 'cine-stream-backend',
    timestamp: new Date().toISOString(),
    // Only expose internals outside production
    ...(isProd ? {} : {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      dependencies: { mongo },
    }),
  });
});
```

---

## B. Frontend & Player Audit

---

### B-1. Auto-Embed Fallback Chain — Correctly Implemented `[PASS]`

**File:** `public/js/movieDetailsPage.js`, lines 1002–1060 (first `setupPlayback`) and lines 2257–2330 (second `setupPlayback`)

The file contains two `setupPlayback` implementations. The second one (lines 2257+) is the active one (it overrides the first due to JavaScript hoisting of `async function` declarations in the same IIFE scope). The active implementation has a correct three-tier fallback chain:

```
Tier 1: loadMaskedPlaybackSources()  — uploaded/DB sources
Tier 2: EmbedServers.buildHydraSources()  — Hydra multi-server (VidSrc, 2Embed, etc.)
Tier 3: VideoEngine.buildMovieSources()  — legacy VideoEngine fallback
```

`buildAutoEmbedSources()` (lines 907–1001) correctly reads both `movie.tmdbId` and `movie.tmdb_id` with a safe fallback:
```js
const tmdbId = Number(movie.tmdbId || movie.tmdb_id || 0);
if (!tmdbId || tmdbId <= 0) return [];
```

If `tmdbId` is missing, the function returns an empty array rather than throwing. The caller handles the empty array gracefully by rendering a "no playback" state. **No action required.**

---

### B-2. Duplicate `setupPlayback` Function Definition `[WARNING]`

**File:** `public/js/movieDetailsPage.js`

There are **two separate definitions** of `setupPlayback` in the same IIFE:
- Lines ~1002–1060: a synchronous version using `buildAutoEmbedSources`
- Lines ~2257–2330: an async version using `EmbedServers.buildHydraSources`

In JavaScript, when two `async function` declarations share the same name in the same scope, the second definition silently overwrites the first. The first `setupPlayback` (the simpler one) is dead code. This is not a runtime bug — the correct Hydra version wins — but it is a maintenance hazard. A future developer editing the wrong function will see no effect and be confused.

**How to patch:**
Delete lines 1002–1060 (the first, simpler `setupPlayback` definition). The async Hydra version at line 2257 is the correct one and should be the only definition.

---

### B-3. HD/SUB/DUB Badge Logic — Safe Against Missing Fields `[PASS]`

**File:** `public/js/app.js`, lines 395–470 (`_hasHdQuality`, `_getSubDubBadge`, `createMovieCard`)

Both badge helper functions are defensively written:

```js
// _hasHdQuality — safe null checks throughout
function _hasHdQuality(movie) {
  const q = movie.qualities;
  if (q && typeof q === 'object') { ... }  // null-safe
  if (String(movie.videoUrl || '').trim()) return true;  // null-safe
  if (Array.isArray(movie.sources) && movie.sources.length) { ... }  // null-safe
  return false;
}

// _getSubDubBadge — defaults gracefully
function _getSubDubBadge(movie) {
  const cat = String(movie.category || '').toLowerCase();
  if (cat !== 'anime' && cat !== 'cartoon') return '';
  const tag = String(movie.subDubTag || '').trim();
  if (cat === 'anime') return 'Subbed';  // safe default
  return '';
}
```

No `undefined` errors can be thrown by missing `qualities`, `sources`, `subDubTag`, or `category` fields. **No action required.**

---

### B-4. Fake "Live Viewers" Counter is Deceptive `[FAIL]`

**File:** `public/js/app.js`, lines 427, 923–929

Every movie card displays a fabricated live viewer count:
```js
// app.js line 427
const liveViewers = Math.floor(Math.random() * (2500 - 500 + 1)) + 500;
```
This number (500–2500) is entirely random and refreshes every 4.5 seconds:
```js
// app.js lines 923–929
function refreshLiveViewerCounters() {
  document.querySelectorAll('[data-live-viewers="true"] .live-viewer-count').forEach((node) => {
    node.textContent = String(Math.floor(Math.random() * (2500 - 500 + 1)) + 500);
  });
}
setInterval(refreshLiveViewerCounters, 4500);
```

This is **consumer deception**. Displaying fabricated engagement metrics to users is a dark pattern that violates consumer protection regulations in multiple jurisdictions (EU DSA Article 37, FTC guidelines on deceptive practices). It also creates a trust problem: if users discover the numbers are fake, it damages the platform's credibility permanently.

**How to patch (two options):**

**Option A — Remove the feature entirely** (recommended): Delete the `liveViewers` variable, the `<span class="live-viewers">` markup in `createMovieCard`, and the `refreshLiveViewerCounters` function + `setInterval`.

**Option B — Replace with real data**: Track actual concurrent viewers per movie in Redis or MongoDB (increment on page load, decrement on unload via `navigator.sendBeacon`). Display the real count. This is architecturally complex but honest.

---

## C. SEO & Routing Audit

---

### C-1. Clean URL Rewrites — All Categories Covered `[PASS]`

**File:** `vercel.json`, lines 7–31

All required clean URL patterns are present and correctly map to `movie-details.html`:

```json
{ "source": "/watch/movie/:id",       "destination": "/pages/movie-details.html?id=:id" },
{ "source": "/watch/series/:id",      "destination": "/pages/movie-details.html?id=:id" },
{ "source": "/watch/anime/:id",       "destination": "/pages/movie-details.html?id=:id" },
{ "source": "/watch/tv/:id",          "destination": "/pages/movie-details.html?id=:id" },
{ "source": "/watch/documentary/:id", "destination": "/pages/movie-details.html?id=:id" },
{ "source": "/watch/cartoon/:id",     "destination": "/pages/movie-details.html?id=:id" },
{ "source": "/watch/:id",             "destination": "/pages/movie-details.html?id=:id" }
```

The catch-all `/watch/:id` at the bottom correctly handles any future categories without requiring a `vercel.json` update. The `injectMovieJsonLd` function in `movieDetailsPage.js` generates canonical URLs using these same path patterns, so Google will index the clean URLs. **No action required.**

---

### C-2. JSON-LD Injection — Correctly Idempotent `[PASS]`

**File:** `public/js/movieDetailsPage.js`, lines 1239–1260

The `injectMovieJsonLd` function correctly removes any existing tag before injecting a new one:

```js
// Lines 1256–1259 — idempotent guard
const existing = document.getElementById('movie-jsonld');
if (existing) existing.remove();
if (!movie) return;
// ... then creates and appends a fresh <script> tag
```

The `id="movie-jsonld"` attribute on the injected `<script>` tag ensures the selector always finds the right element. The `_upsertMeta` helper for OG/Twitter tags also uses a create-or-update pattern. Re-renders cannot produce duplicate schema tags. **No action required.**

---

### C-3. Sitemap — Uses `_id` Only, No Title Injection Risk `[PASS]`

**File:** `backend/server.js`, lines 236–258

The sitemap generator only writes `movie._id` (a MongoDB ObjectId) and `movie.updatedAt` (an ISO date string) into the XML. Neither field can contain user-controlled characters that would break XML structure:

```js
// server.js lines 249–252
const loc = `${baseUrl}/pages/movie-details.html?id=${movie._id}`;
const lastmod = movie.updatedAt ? new Date(movie.updatedAt).toISOString() : ...;
res.write(`<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod>...</url>`);
```

ObjectIds are hex strings (`[0-9a-f]{24}`). ISO date strings contain only digits, dashes, colons, and `Z`. Neither can inject XML entities. **No action required.**

---

### C-4. Sitemap Uses `?id=` Query String Instead of Clean URL `[WARNING]`

**File:** `backend/server.js`, line 250

The sitemap generates URLs in the old query-string format:
```js
const loc = `${baseUrl}/pages/movie-details.html?id=${movie._id}`;
```

But the canonical URL injected by `injectMovieJsonLd` uses the clean path format:
```js
// movieDetailsPage.js line ~1280
const canonicalUrl = `${origin}/watch/${categorySlug}/${movieDbId}`;
```

This creates a **canonical URL mismatch**: Google's sitemap crawler will discover `?id=` URLs, but the page's `<link rel="canonical">` points to `/watch/movie/:id`. Google will eventually resolve this, but it slows down indexing and can cause duplicate content signals during the resolution period.

**How to patch:**
The sitemap query needs the `category` field to build the correct slug. Update the cursor's `.select()` and the URL builder:
```js
// In server.js sitemap route
const cursor = Movie.find({})
  .select('_id updatedAt category')  // add category
  .sort({ updatedAt: -1 })
  .lean()
  .cursor();

// Category → slug map (mirror of movieDetailsPage.js)
const slugMap = { movie:'movie', series:'series', anime:'anime',
                  cartoon:'cartoon', documentary:'documentary', short:'movie' };

for await (const movie of cursor) {
  const slug = slugMap[movie.category] || 'movie';
  const loc = `${baseUrl}/watch/${slug}/${movie._id}`;
  // ...
}
```

---

## D. Database Health Audit

---

### D-1. Sparse Unique Indexes on `tmdbId` and `tmdb_id` — Correctly Defined `[PASS]`

**File:** `backend/models/Movie.js`, lines 247–248

```js
MovieSchema.index({ tmdbId:  1 }, { unique: true, sparse: true });
MovieSchema.index({ tmdb_id: 1 }, { unique: true, sparse: true });
```

Both indexes are correctly declared with `sparse: true`. This means MongoDB only indexes documents where the field is present and non-null, preventing the duplicate-key collision that would occur if multiple documents had `tmdbId: null`. The `pruneNullIdFields` helper in `sync.js` and `mass_seed.js` correctly removes these fields from `$set` and moves them to `$unset` when the value is null/0, which is the correct companion pattern for sparse indexes. **No action required.**

---

### D-2. Schema Field Definition vs. Index Definition Mismatch `[WARNING]`

**File:** `backend/models/Movie.js`, lines 200–201 vs. lines 247–248

The field-level schema definitions for `tmdbId` and `tmdb_id` do not declare `unique` or `sparse`:
```js
// Lines 200–201 — field definitions (no unique/sparse here)
tmdbId:  { type: Number, index: true },
tmdb_id: { type: Number },
```

The `unique: true, sparse: true` constraints are only declared at the index level (lines 247–248). This is functionally correct — Mongoose applies the index-level constraints to MongoDB. However, it creates a subtle maintenance trap: a developer reading the field definition alone will not see that `tmdbId` is a unique sparse index. They may write code that sets `tmdbId: null` thinking it is safe, not realizing it will be caught by the index-level constraint (or silently ignored if `pruneNullIdFields` is not called).

Additionally, `tmdb_id` at line 201 has no `index: true` at the field level, even though it has a unique sparse index at line 248. This inconsistency is confusing.

**How to patch (documentation-level, no schema migration needed):**
Add comments to the field definitions to make the index constraints visible:
```js
// In Movie.js schema definition
tmdbId:  { type: Number, index: true },  // unique sparse index defined below — do NOT set to null
tmdb_id: { type: Number },               // unique sparse index defined below — do NOT set to null
```
Or, consolidate by moving `unique: true, sparse: true` into the field definition and removing the separate `MovieSchema.index()` calls for these two fields. Either approach is safe — Mongoose deduplicates index creation.

---

## Summary of Action Items

### Immediate (Before Next Deployment)

| # | Severity | File | Issue | Action |
|---|----------|------|-------|--------|
| 1 | **FAIL** | `vercel.json` + `authMiddleware.js` | Vercel Cron calls will always 401 — sync never runs | Add `x-vercel-cron` header check or create a wrapper route |
| 2 | **FAIL** | `public/js/app.js` | Fake live viewer counts are consumer deception | Remove the feature or replace with real data |

### Next Sprint (High Priority)

| # | Severity | File | Issue | Action |
|---|----------|------|-------|--------|
| 3 | WARNING | `backend/server.js` | `/api/sync` has no dedicated rate limiter | Add `syncLimiter` (5 req/hr) |
| 4 | WARNING | `backend/server.js` + `vercel.json` | Wildcard CORS in production | Restrict to known domains |
| 5 | WARNING | `backend/server.js` | `/health` leaks memory + MongoDB host publicly | Strip sensitive fields in production |

### Maintenance (Low Priority)

| # | Severity | File | Issue | Action |
|---|----------|------|-------|--------|
| 6 | WARNING | `backend/server.js` | Sitemap uses `?id=` URLs, canonical uses `/watch/:id` | Update sitemap to use clean URLs |
| 7 | WARNING | `public/js/movieDetailsPage.js` | Duplicate `setupPlayback` definition (dead code) | Delete the first definition (lines ~1002–1060) |
| 8 | WARNING | `backend/models/Movie.js` | Index constraints not visible at field-definition level | Add comments or consolidate index declarations |

---

*Audit performed by static code analysis. No files were modified. No database queries were executed.*
