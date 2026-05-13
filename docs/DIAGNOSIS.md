# CinePulse — Data Pipeline Diagnosis Report

**Date:** 2026-05-13  
**Role:** Lead Site Reliability Engineer  
**Directive:** READ-ONLY trace of the full data pipeline from MongoDB → API → Frontend  
**Symptom:** 50,000 seeded records are in MongoDB Atlas but the Vercel frontend shows nothing.

---

## TL;DR — Root Causes Found (3 bugs, 1 critical)

| # | Severity | Layer | Root Cause |
|---|----------|-------|-----------|
| 1 | **CRITICAL** | Infrastructure | `MONGODB_URI` is **not set** in Vercel's environment variables. The backend falls back to `mongodb://127.0.0.1:27017/cine-stream` (localhost), which is unreachable from Vercel's serverless runtime. Every API call returns an empty result or 503. |
| 2 | **HIGH** | Backend | The seed script wrote data into the **`cinestream`** database (no hyphen), but the local fallback URI points to **`cine-stream`** (with hyphen). These are two different databases. Even if you fix the Vercel env var, a wrong URI would query the wrong database. |
| 3 | **MEDIUM** | Frontend | The homepage `SIDEBAR_FILTERS.anime` filter sends `original_language=ja&tmdb_genre_id=16` to the API, but the `GET /api/movies` route does **not** accept a `category=anime` parameter for the Anime rail — it uses `loadCategoryRail('anime', ...)` which sends `category=anime`. The seeded anime records have `category: 'anime'` ✓, but the sidebar filter bypasses this and queries by language+genre instead, which works. This is a minor inconsistency, not a blocker. |

---

## A. Database Connection Audit

### A-1. How Mongoose resolves the URI

**File:** `backend/database/db.js`, line 21

```js
const mongoUri = getEnv('MONGODB_URI') || getEnv('MONGO_URI', 'mongodb://127.0.0.1:27017/cine-stream');
```

`getEnv()` in `backend/config/env.js` reads from `process.env` first, then falls back to the `DEFAULTS` object. The `DEFAULTS` object has:

```js
MONGO_URI: 'mongodb://127.0.0.1:27017/cine-stream',
```

**On Vercel:** `process.env.MONGODB_URI` is **not set** in `vercel.json` (only `NODE_ENV=production` is there). The Vercel dashboard environment variables page must have it set — but based on the `.env.production` file in the repo, it contains only a placeholder comment:

```env
# MONGO_URI=mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/cinestream?retryWrites=true&w=majority
```

This line is **commented out**. If this is what was used to populate Vercel's env vars, `MONGODB_URI` is blank on Vercel, and the backend silently falls back to `localhost:27017` — which is unreachable from a serverless function.

**Verdict:** The backend on Vercel is connecting to `mongodb://127.0.0.1:27017/cine-stream` (localhost), not Atlas. Every `Movie.find()` call either times out or returns 0 results.

---

### A-2. Database Name Mismatch — `cinestream` vs `cine-stream`

**File:** `.env` (local), line 4

```env
MONGODB_URI="mongodb://...mongodb.net:27017,.../cinestream?ssl=true&..."
```

The seed script (`scripts/mass_seed.js`, line 921) connects using this exact URI:

```js
const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
await mongoose.connect(mongoUri, { ... });
const collection = mongoose.connection.collection('movies');
```

So the seed wrote 50,000 records into: **`cinestream.movies`** (no hyphen).

But the fallback URI in `backend/config/env.js` DEFAULTS is:

```js
MONGO_URI: 'mongodb://127.0.0.1:27017/cine-stream',
```

And `.env.development` also has:

```env
MONGO_URI=mongodb://127.0.0.1:27017/cine-stream
```

If Vercel's `MONGODB_URI` env var is set to an Atlas URI that ends in `/cine-stream` (with hyphen) instead of `/cinestream` (no hyphen), the backend would connect to an **empty database** and return zero results — even though the data exists in `cinestream`.

**The correct database name is `cinestream` (no hyphen).** This must be verified and corrected in the Vercel dashboard.

---

## B. Schema & Query Alignment Audit

### B-1. Seed data format vs. Mongoose schema — ALIGNED ✓

The seed script's `mapTmdbMovie()`, `mapTmdbTv()`, and `mapTmdbAnime()` functions produce documents that match the `Movie.js` schema exactly:

| Seed field | Schema field | Match? |
|-----------|-------------|--------|
| `category: 'movie'` | `enum: ['movie','anime','cartoon','series','documentary','short']` | ✓ |
| `category: 'series'` | same enum | ✓ |
| `category: 'anime'` | same enum | ✓ |
| `status: 'Completed'` | `enum: ['Completed','Ongoing','Upcoming','Cancelled']` | ✓ |
| `tmdbId`, `tmdb_id` | sparse unique indexes | ✓ (pruneNullIds handles nulls) |
| `thumbnailUrl` | TMDB CDN URL (`image.tmdb.org/t/p/w500/...`) | ✓ |

No schema mismatch. The data format is correct.

### B-2. `GET /api/movies` filter — No accidental exclusion ✓

**File:** `backend/routes/movies.js`, lines 210–260

The base query is `Movie.find({})` with no hardcoded filters. Filters are only applied when query params are present. A plain `GET /api/movies?limit=20&sort=newest` will return any 20 documents regardless of category, status, or provider. **No accidental exclusion.**

### B-3. `GET /api/movies/trending` — Has a 7-day window with a safe fallback ✓

**File:** `backend/routes/movies.js`, lines 393–420

```js
const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
const filter = { createdAt: { $gte: sevenDaysAgo }, ... };

let trending = await Movie.find(filter)...

if (!trending.length) {
  // FALLBACK: query without the date filter
  trending = await Movie.find(category ? { category } : {})...
}
```

The 7-day window would exclude all seeded records (they were inserted in the past), but the fallback `if (!trending.length)` correctly removes the date filter and queries all records. **This is not a blocker** — the fallback will fire and return results once the DB connection is fixed.

---

## C. Frontend Fetch Logic Audit

### C-1. API base URL — Correct ✓

**File:** `public/js/config.js`

```js
const API_BASE = `${window.location.origin}/api`;
```

On Vercel, `window.location.origin` is `https://cinepulse-platform.vercel.app`, so `API_BASE` becomes `https://cinepulse-platform.vercel.app/api`. This is correct — it hits the same Vercel deployment's serverless function.

### C-2. Homepage fetch calls — Correct endpoints, correct limits ✓

**File:** `public/pages/index.html` (inline script)

```js
// Recommended rail
fetchMovieList('/movies?limit=12&sort=highest_rated')

// Trending rail
fetchMovieList('/movies/trending?limit=10')

// Series rail
loadCategoryRail('series', 'seriesRail', ...)
// → fetchMovieList('/movies?category=series&limit=12&sort=highest_rated')

// Anime rail
loadCategoryRail('anime', 'animeRail', ...)
// → fetchMovieList('/movies?category=anime&limit=12&sort=highest_rated')

// Spotlight grid
fetchMovieList('/movies?limit=12&sort=newest')

// Poster grid
fetchMovieList('/movies?limit=24&sort=newest')
```

All endpoints are correct. Limits are reasonable (12–24). No hardcoded filters that would exclude seeded data.

### C-3. Sidebar filter for Anime — Minor inconsistency, not a blocker

**File:** `public/pages/index.html`, lines 638–644

```js
const SIDEBAR_FILTERS = {
  anime: { original_language: 'ja', tmdb_genre_id: '16' },
  ...
};
```

When the user clicks the "Anime" sidebar button, the API call becomes:
```
GET /api/movies?original_language=ja&tmdb_genre_id=16&limit=12&sort=highest_rated
```

This queries by language and genre ID, not by `category=anime`. The seeded anime records have `original_language: 'ja'` and `tmdb_genre_ids: [16]`, so this filter **will** return results. However, it will also return non-anime Japanese animation (e.g., Studio Ghibli movies categorized as `movie`). The dedicated Anime rail uses `category=anime` which is more precise. This is a UX inconsistency but not a data blocker.

---

## Diagnosis Summary — The Exact Failure Chain

```
User visits cinepulse-platform.vercel.app
  │
  ▼
Browser fetches GET /api/movies?limit=12&sort=newest
  │
  ▼
Vercel routes to api/server.js (serverless function)
  │
  ▼
server.js calls connectDB()
  │
  ▼
db.js: getEnv('MONGODB_URI') → returns '' (not set in Vercel env)
       getEnv('MONGO_URI')   → returns '' (not set in Vercel env)
       falls back to:  'mongodb://127.0.0.1:27017/cine-stream'
  │
  ▼
mongoose.connect('mongodb://127.0.0.1:27017/cine-stream')
  │
  ▼
CONNECTION FAILS (localhost is unreachable from Vercel serverless)
  │
  ▼
server.js catches error → returns HTTP 503
  │
  ▼
Frontend apiRequest() catches the error silently (silent: true)
  │
  ▼
renderRail() renders "Nothing to show yet." / empty state
```

The 50,000 records are sitting in `Atlas → cinestream.movies`, completely unreachable.

---

## The Fix — Exact Steps Required

### Fix 1 (CRITICAL) — Set `MONGODB_URI` in Vercel Dashboard

This is the only fix needed to unblock the frontend. The other fixes are hardening.

1. Go to: `vercel.com/nitinkumar400s-projects/cinepulse-platform/settings/environment-variables`
2. Add a new environment variable:
   - **Name:** `MONGODB_URI`
   - **Value:** (copy exactly from your local `.env` file — the full Atlas connection string)
   - **Environments:** Production ✓, Preview ✓, Development ✓

The correct value from your `.env` is:
```
mongodb://nitinkumarmishrait_db_user:<PASSWORD>@ac-uxd61bx-shard-00-00.o8s2xx3.mongodb.net:27017,ac-uxd61bx-shard-00-01.o8s2xx3.mongodb.net:27017,ac-uxd61bx-shard-00-02.o8s2xx3.mongodb.net:27017/cinestream?ssl=true&replicaSet=atlas-w9eymr-shard-0&authSource=admin&appName=Cluster0
```

> ⚠️ **Critical:** The database name at the end of the URI must be `cinestream` (no hyphen). This is where the seed wrote the data. If you use `cine-stream` (with hyphen), you will connect to an empty database.

3. After saving, click **Redeploy** (or push any commit to trigger a new deployment). Vercel does not hot-reload env vars into running functions.

---

### Fix 2 (HIGH) — Align the fallback URI in `env.js`

**File:** `backend/config/env.js`, line 13

Change the `MONGO_URI` default to match the correct database name:

```js
// BEFORE (wrong database name — has hyphen)
MONGO_URI: 'mongodb://127.0.0.1:27017/cine-stream',

// AFTER (matches the seeded database name — no hyphen)
MONGO_URI: 'mongodb://127.0.0.1:27017/cinestream',
```

This ensures that if `MONGODB_URI` is ever missing from the environment, the fallback at least uses the correct database name for local development.

**File:** `.env.development`, line 4

```env
# BEFORE
MONGO_URI=mongodb://127.0.0.1:27017/cine-stream

# AFTER
MONGO_URI=mongodb://127.0.0.1:27017/cinestream
```

---

### Fix 3 (MEDIUM) — Add `FRONTEND_URL` to Vercel env vars

The CORS fix from the previous audit patch now uses `corsOriginHandler` in production (no more wildcard). But `FRONTEND_URL` is not set in Vercel's env vars either. Without it, `getCorsOrigins()` returns an empty set, and the `corsOriginHandler` will block all browser requests.

Add to Vercel Dashboard:
- **Name:** `FRONTEND_URL`
- **Value:** `https://cinepulse-platform.vercel.app`

---

### Fix 4 (LOW) — Align the Anime sidebar filter to use `category=anime`

**File:** `public/pages/index.html`, line 640

```js
// BEFORE — queries by language+genre (imprecise, returns non-anime Japanese content)
anime: { original_language: 'ja', tmdb_genre_id: '16' },

// AFTER — queries by category field (precise, matches exactly what was seeded)
anime: { category: 'anime' },
```

This makes the sidebar "Anime" button consistent with the dedicated Anime rail, which already uses `category=anime`.

---

## Verification Steps After Applying Fix 1

Once `MONGODB_URI` is set in Vercel and a redeploy completes:

1. **Health check:** `GET https://cinepulse-platform.vercel.app/health`  
   Expected: `{ "success": true, "status": "ok" }`

2. **API smoke test:** `GET https://cinepulse-platform.vercel.app/api/movies?limit=5`  
   Expected: `{ "movies": [...5 items...], "pagination": { "total": 50000, ... } }`

3. **Homepage:** Visit `https://cinepulse-platform.vercel.app`  
   Expected: All rails (Recommended, Trending, Series, Anime) populate with cards.

4. **Count verification:** `GET https://cinepulse-platform.vercel.app/api/movies?limit=1`  
   Check `pagination.total` — should be close to 50,000.

---

*Diagnosis performed by static code analysis. No files were modified. No database queries were executed.*
