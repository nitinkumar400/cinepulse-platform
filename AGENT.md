# CinePulse / Cine Stream Platform - Agent Handoff Notes

This file is a practical handoff for continuing development, production hardening, and QA. It summarizes what was built, what is verified working, what was changed for scale/stability, and what is still blocked or pending.

Repository root: `C:\Users\NITIN MISHRA\Workspace\01_Development\Active\cine-stream-platform-main.zip`

## 1) What This Project Is

Backend: Node.js + Express + Mongoose (MongoDB)
Frontend: static HTML pages in `public/pages` + vanilla JS in `public/js`
Primary goal: streaming UI with an embedded universal player, automated media ingestion (TMDB + AniList), SEO/sitemaps, and retention loops.

Note: Some earlier requirements referenced Next.js (`generateMetadata`, `layout.tsx`, `<Image />`). The current repo implementation is not Next.js; it is Express + static frontend. Equivalent SEO + sitemap features were implemented within Express/static pages instead.

## 2) High-Level Architecture

- `backend/server.js`
  - Express app, middleware, rate limits, routes wiring
  - Serves `public/` as static assets
  - Serves `public/pages/*.html` via simple mappings
  - Exposes `/sitemap.xml` (cursor/streamed)
- `backend/database/db.js`
  - Mongoose connection caching + pooling (env configurable)
- `backend/models/Movie.js`
  - Main media collection schema (movies, series, anime)
  - Indexes for search + ingestion stability
- `backend/routes/*`
  - `movies`, `watch`, `episodes`, `anilist`, `tmdb`, `sync`, etc.
- `public/pages/*`
  - `index.html`, `movie-details.html`, `search.html`, `episode.html`, etc.
- `public/js/*`
  - `app.js` (home UI), `movieDetailsPage.js` (watch/details + player UI),
    `videoEngine.js` + `embedServers.js` (external embed sources),
    `videoPlayer.js` (local video player v2), etc.

## 3) Environment / Secrets

All sensitive keys must come from `.env` (and related env files). Typical env vars used:

- `MONGODB_URI` or `MONGO_URI`
- `TMDB_API_KEY` (used by `backend/services/tmdbService.js`)
- `ADMIN_USERNAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` (admin bootstrap)
- DB pooling (production hardening):
  - `MONGO_MAX_POOL_SIZE` (default `40`)
  - `MONGO_MIN_POOL_SIZE` (default `5`)
  - `MONGO_MAX_IDLE_MS` (default `30000`)
  - `MONGO_WAIT_QUEUE_TIMEOUT_MS` (default `10000`)

## 4) Data Model (MongoDB)

Primary collection: `movies` (Mongoose model `Movie`).
Key fields used by features:

- Identity
  - `tmdbId`, `tmdb_id` (Number)
  - `anilistId`, `anilist_id` (Number)
  - `idMal` (Number, AniList MAL id)
- Classification
  - `category`: `movie | series | anime | ...`
  - `provider`: `tmdb | anilist | manual`
  - `genre`: string array
  - `tmdb_genre_ids`: number array
  - `original_language`: string
  - `spoken_languages`: string array (used for language tags)
- Anime-specific UX
  - `subDubTag`: `Subbed | Dubbed`
  - `nextAiringEpisode: { episode, airingAt }`
  - `animeSeasonNumber`
  - `franchiseKey`
  - `trailerUrl`
- Ratings
  - `averageRating`, `vote_average`, `anilistScore`

### Index Hardening (critical for sync stability)

The unique-index blocker was caused by writing `tmdb_id: null` into many docs. Fix strategy:

- Keep `tmdbId` and `tmdb_id` as `unique: true, sparse: true`
  - This allows:
    - uniqueness when a real ID exists
    - many docs to omit the field entirely (no collisions)
- Ensure sync logic deletes missing IDs instead of writing `null`

Implemented in:
- `backend/models/Movie.js` (unique + sparse on `tmdbId` and `tmdb_id`)
- `backend/routes/sync.js` (prunes ID fields + `$unset` when missing)

Important: Mongo indexes do not auto-update if they already exist with old options. If Mongo already has a non-sparse unique index, it must be dropped and recreated in the database (one-time ops task).

## 5) API / Feature Work Completed

### A) TMDB Sync (`/api/sync`)

Status: implemented and working.

- Route: `POST /api/sync`
- Uses TMDB lists:
  - Popular (movie + tv) + Trending (all)
- Dedupes and `findOneAndUpdate` with upsert:
  - `upsert: true, new: true, setDefaultsOnInsert: true`
- Saves:
  - `vote_average` (rating)
  - `spoken_languages` (from details endpoint)

Implementation: `backend/routes/sync.js`

### B) AniList Anime Sync (`/api/sync/anime`)

Status: implemented, but final QA for Blue Lock countdown was blocked by admin login (see Pending section).

- Route: `POST /api/sync/anime?limit=50`
- Fetches:
  - `Naruto`
  - `Classroom of the Elite`
  - `Blue Lock`
  - Popular (top X by popularity)
- Captures:
  - `idMal`, `title.romaji`
  - `nextAiringEpisode { airingAt, episode }`
  - `trailer { id, site }` (YouTube -> `trailerUrl`)
- Maps to TMDB:
  - Uses TMDB TV search by title + year
  - Stores `tmdbId/tmdb_id` if found
- Upsert collision strategy:
  - Primary filter for anime is now AniList ID (`anilistId/anilist_id`)
  - Missing/invalid IDs are pruned (not set to null)

Implementation: `backend/routes/sync.js`

### C) Anime Episode Buttons + Multi-Season Support

Status: implemented (UI-side).

- Anime renders episode grid based on `nextAiringEpisode` or `totalEpisodes`
- Episode embed URL:
  - `https://vidsrc.to/embed/tv/{tmdb_id}/{season}/{episode}`
- Season mapping:
  - If title includes `Season 2`, `Season 3`, etc., use that season in the URL
  - Episode numbers restart at 1 per season

Implementation:
- `public/js/movieDetailsPage.js` (episode grid + embed URL builder)

### D) Next Episode Countdown ("Next Ep in ...")

Status: implemented (backend stores `nextAiringEpisode.airingAt`, UI should render countdown if data exists).

Implementation:
- `backend/routes/sync.js` saves `nextAiringEpisode.airingAt` as Date
- `public/js/app.js` / cards + `public/js/movieDetailsPage.js` used to show countdown (depending on where card rendering occurs)

### E) “More Like This” Recommendations

Status: implemented and previously smoke-tested as returning results.

- Watch/detail page queries MongoDB for same genre and/or language.
- Implementation is in backend movie/watch routes and/or recommendation service.

Files touched previously (verify exact wiring if modifying):
- `backend/routes/movies.js`
- `backend/routes/watch.js`
- `backend/services/recommendationService.js`

### F) Social Share Locker (WhatsApp/Telegram)

Status: implemented in frontend UX (simulated unlock).

- “Share” click simulates unlocking “High-Speed Server 1”.
- Source selection is driven by `public/js/embedServers.js` + `public/js/videoEngine.js`.

### G) Sitemap (`/sitemap.xml`) - Cursor/Streaming

Status: implemented and verified returning valid XML earlier; now additionally hardened to stream response (no memory blowups).

- Route: `GET /sitemap.xml`
- Uses Mongo cursor on Movies, writes `<url>` entries progressively.

Implementation: `backend/server.js`

### H) Production Hardening Applied

Status: applied in repo, with one remaining verification step (Blue Lock sync via protected endpoint).

- `X-Powered-By` disabled: `app.disable('x-powered-by')` in `backend/server.js`
- Global async crash safety:
  - wraps Express route handlers to catch promise rejections
- Static performance:
  - adds immutable cache headers for JS/CSS/images
- Mongo pooling:
  - env-configured pool sizes in `backend/database/db.js`
- Removed production-unsafe debug route:
  - deleted `/api/auth/debug-admin` from `backend/routes/auth.js`
- Removed runtime `console.log` noise from core frontend + some backend routes:
  - `public/js/videoPlayer.js`, `public/js/embedServers.js`, `public/js/movieDetailsPage.js`, `public/pages/embed-demo.html`

## 6) What Is Completed vs Pending

### Completed (implemented + at least basic validation)

- `/health` works and Mongo reports `connected`
- `/sitemap.xml` returns XML (and is now streaming)
- TMDB sync route exists and upserts correctly
- AniList sync route exists and stores next airing + trailer fields
- Universal player embeds work via external servers
- “More Like This” endpoint previously returned results in smoke checks
- Removed `/api/auth/debug-admin`
- DB pooling settings improved for concurrency
- Unique `tmdb_id` null-collision fix added (prune IDs + sparse unique indexes)

### Pending / Blocked (must complete before “Ready for Launch” sign-off)

1) Blue Lock protected QA verification
   - Requirement: run `POST /api/sync/anime`, confirm Blue Lock doc has:
     - `tmdbId/tmdb_id` populated
     - `status` and `nextAiringEpisode.airingAt` populated
     - UI shows “Next Ep in …” countdown
   - Blocker encountered: admin login credentials mismatch during automated local call to `/api/auth/admin/login`.
   - Action needed:
     - Confirm correct admin email/password currently in DB, or reset admin credentials to known values.

2) Mongo index migration (one-time ops)
   - If old indexes exist (non-sparse unique), Mongo may still throw duplicate key errors.
   - Action needed:
     - Drop and recreate indexes for `tmdbId` and `tmdb_id` as `unique + sparse`.

3) Remove remaining `console.log` in duplicated/legacy subproject
   - There is a second folder `cine-stream-platform/` with its own backend/frontend copies and many `console.log` references.
   - Decide:
     - If `cine-stream-platform/` is not used, remove it from deploy path (or delete it).
     - If it is used, repeat the same cleanup inside it.

4) Frontend minification pipeline
   - No minifier tooling is configured in `package.json`.
   - Current optimization: cache headers + removal of logs.
   - Optional next step:
     - Add build step (terser/clean-css) and output `.min.js/.min.css` or enable a bundler.

## 7) How To Run Locally

From repo root:

- Install: `npm install`
- Run dev: `npm run dev`
- Run prod: `npm start`

Backend default port: `5001`
- Health: `GET http://localhost:5001/health`

## 8) Key URLs / Routes (Quick Reference)

- Pages (static):
  - `/` -> `public/pages/index.html`
  - `/pages/movie-details.html?id=<mongo_id>`
  - `/pages/search.html?q=<term>`
- API:
  - `POST /api/sync` (TMDB popular/trending)
  - `POST /api/sync/anime` (AniList popular + Blue Lock + Naruto + COTE)
  - `GET /sitemap.xml`
  - `POST /api/auth/admin/login`
  - `GET /api/movies/...` (listing endpoints)
  - `GET /api/watch/...` (watch-related endpoints)

## 9) QA Checklist (Last Mile)

1) Confirm admin login works
   - `POST /api/auth/admin/login`
2) Trigger anime sync
   - `POST /api/sync/anime?limit=50`
3) Confirm Blue Lock in DB
   - Has `tmdbId/tmdb_id`, `status`, `nextAiringEpisode.airingAt`
4) Confirm UI card shows countdown
   - “Next Ep in …” appears when `airingAt` in future
5) Confirm multi-season URL correctness
   - Example: `vidsrc.to/embed/tv/{tmdb_id}/2/1`
6) Confirm sitemap does not spike memory
   - `/sitemap.xml` responds for large DB without crashing

## 10) Files Changed In Current Hardening Pass (Most Relevant)

- `backend/routes/sync.js` (ID pruning + anime filter)
- `backend/models/Movie.js` (unique sparse indexes)
- `backend/database/db.js` (pool sizes)
- `backend/routes/auth.js` (removed debug endpoint)
- `backend/server.js` (stream sitemap + handler wrapping + cache headers)
- `public/js/videoPlayer.js` (removed init log)
- `public/js/embedServers.js` (removed server status log)
- `public/js/movieDetailsPage.js` (removed player debug log)
- `public/pages/embed-demo.html` (removed debug logs)

## 11) Notes / Known Risks

- Do not write `tmdb_id: null` or `tmdbId: null` in updates when using `unique + sparse`. Omit or `$unset` instead.
- If multiple server processes run, stale routes can appear. Always kill old Node processes before re-testing routes.
- The directory name ends in `.zip` but is a folder; do not delete it during cleanup scans.

