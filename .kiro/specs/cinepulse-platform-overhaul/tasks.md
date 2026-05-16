# Implementation Plan: CinePulse Platform Overhaul

## Overview

This plan implements three interconnected features on top of the existing Node.js + Express + MongoDB + Vanilla JS stack:

1. **Server Health Monitor & No-Code Server Management** — MongoDB-backed server config, admin health dashboard, automated health checks via Vercel Cron, and in-app notifications.
2. **Netflix-Style Home Page Redesign** — Billboard carousel, horizontal scroll rails, 2:3 poster cards, category filter bar.
3. **Netflix-Style Category/Browse Pages** — Six browse pages with infinite scroll, filter sidebar, and in-category search.

All tasks are ordered so each step builds on the previous, ending with full integration.

---

## Tasks

- [x] 1. Data Models — EmbedServerConfig and EmbedServerHealth
  - [x] 1.1 Create `backend/models/EmbedServerConfig.js` Mongoose model
    - Define schema with all fields: `key` (unique), `name`, `type` (standard|anime), `priority`, `enabled`, `sandboxPolicy`, `movieUrlPattern`, `tvUrlPattern`, `animeUrlPattern`, `timeout`, `lastCheckedAt`, `lastStatus`, `successRate`, `avgLoadTime`, `createdAt`, `updatedAt`
    - Add indexes: `{ key: 1 }` unique, `{ priority: 1 }`, `{ enabled: 1, priority: 1 }`
    - _Requirements: 1.1, 1.5_

  - [ ]* 1.2 Write property test for EmbedServerConfig serialisation round-trip
    - **Property 9: Server Config Serialisation Round-Trip**
    - Generate random valid `EmbedServerConfig` objects using fast-check arbitraries; insert into test MongoDB; read back; assert field equality for all user-supplied fields
    - **Validates: Requirements 1.1**

  - [x] 1.3 Create `backend/models/EmbedServerHealth.js` Mongoose model
    - Define schema: `serverKey`, `status` (Working|Degraded|Down), `responseTime`, `httpStatusCode`, `checkedAt`
    - Add indexes: `{ serverKey: 1, checkedAt: -1 }` and TTL index `{ checkedAt: 1 }` with `expireAfterSeconds: 2592000` (30 days)
    - _Requirements: 6.6, 6.10_

  - [x] 1.4 Extend `backend/models/Notification.js` with server alert types
    - Add `server_down`, `server_degraded`, `server_recovered` to the `type` enum
    - Add optional `severity` field (`critical` | `warning` | `info`)
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 2. ServerConfigService — CRUD, seeding, caching, priority management
  - [x] 2.1 Create `backend/services/serverConfigService.js` with seeding logic
    - Implement `seedIfEmpty()`: on startup, if `embed_server_configs` is empty, insert all 12 servers from the hardcoded `embedServers.js` data (7 standard + 5 anime), preserving priority order and sandbox policies
    - Implement `getAll()` and `getEnabled()` (returns only `enabled: true` docs sorted by `priority` ascending)
    - Add module-level cache with 5-minute TTL for `getEnabled()`; invalidate cache on any write
    - _Requirements: 1.2, 1.3, 1.4, 21.4, 21.5_

  - [x] 2.2 Add CRUD and priority management to `ServerConfigService`
    - Implement `create(data)`: insert new doc; if `priority` conflicts, shift all docs with `priority >= newPriority` up by 1; throw `{ status: 409 }` on duplicate key
    - Implement `update(key, data)`: update mutable fields; throw `{ status: 404 }` if not found; re-run priority shift if priority changes
    - Implement `delete(key)`: remove doc; throw `{ status: 404 }` if not found
    - Implement `reorder(orderedKeys)`: reassign priorities `[1, 2, ..., N]` to match submitted order; throw `{ status: 400 }` if key set mismatches
    - _Requirements: 1.6, 4.2, 4.3, 5.2, 19.2, 19.3, 19.4, 19.5_

  - [ ]* 2.3 Write property test for Server Priority Sequence Invariant
    - **Property 1: Server Priority Sequence Invariant**
    - Generate random sequences of add/remove/reorder operations on an in-memory representation; after each operation assert priority values form `[1, 2, ..., N]` with no gaps or duplicates
    - **Validates: Requirements 1.6, 4.2, 4.3, 19.5**

  - [ ]* 2.4 Write unit tests for ServerConfigService
    - Test `create()` with valid data, duplicate key (409), conflicting priority (shift behaviour)
    - Test `update()` with unknown key (404)
    - Test `reorder()` with valid key array → priorities reassigned as `[1, 2, ..., N]`
    - Test `getEnabled()` returns only enabled docs sorted by priority
    - Test cache invalidation: after any write, next `getEnabled()` fetches from DB
    - _Requirements: 1.2, 1.3, 1.4, 1.6_

- [x] 3. ServerHealthService — probing, recording, notifying, cleanup
  - [x] 3.1 Create `backend/services/serverHealthService.js` with probe and classify logic
    - Implement `substitutePattern(pattern, vars)` for `{tmdbId}`, `{season}`, `{episode}`, `{anilistId}` placeholders
    - Implement `classifyProbeResult(responseTime, httpStatusCode, timeout)`: returns `Working` / `Degraded` / `Down` per the three-way rule
    - Implement `computeSuccessRate(results)`: percentage of `Working` results, always in `[0, 100]`
    - Implement `computeAvgLoadTime(results)`: arithmetic mean of `responseTime` values
    - _Requirements: 6.3, 6.4, 6.5, 6.7, 21.2_

  - [ ]* 3.2 Write property test for Health Check Status Classification
    - **Property 3: Health Check Status Classification**
    - Generate random `(responseTime: 0–20000, httpStatusCode: 100–599, timeout: 5000–15000)` triples; assert `classifyProbeResult()` returns the correct status for all three cases
    - **Validates: Requirements 6.3, 6.4, 6.5**

  - [ ]* 3.3 Write property test for Health Check Success Rate Bounds
    - **Property 4: Health Check Success Rate Bounds**
    - Generate random arrays of `Health_Status` values (length 1–1000); assert `computeSuccessRate()` always returns a value in `[0, 100]`
    - **Validates: Requirements 6.7**

  - [x] 3.4 Implement full health check cycle in `ServerHealthService`
    - Implement `runHealthCheckCycle()`: fetch all enabled servers, probe each using `substitutePattern` + configured `HEALTH_CHECK_PROBE_TMDB_ID` / `HEALTH_CHECK_PROBE_ANILIST_ID` env vars, use `Promise.allSettled()` for parallel execution
    - Write `EmbedServerHealth` document per probe result
    - Update `EmbedServerConfig` with `lastCheckedAt`, `lastStatus`, `successRate`, `avgLoadTime`
    - Delete `EmbedServerHealth` documents older than 30 days during each cycle
    - _Requirements: 6.1, 6.2, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x] 3.5 Implement notification logic in `ServerHealthService`
    - Implement `shouldNotify(previousStatus, newStatus)`: returns `true` only on status transitions
    - On `Down` transition: create `Notification` with `type: 'server_down'`, `severity: 'critical'`
    - On `Degraded` transition: create `Notification` with `type: 'server_degraded'`, `severity: 'warning'`
    - On recovery to `Working`: create `Notification` with `type: 'server_recovered'`, `severity: 'info'`
    - Send email to `ADMIN_EMAIL` env var on `Down` transition (if configured)
    - _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_

  - [ ]* 3.6 Write property test for Notification Transition-Only Invariant
    - **Property 6: Notification Transition-Only Invariant**
    - Generate random arrays of `Health_Status` values (length 1–100); simulate the notification logic; assert notification count equals the number of adjacent pairs where `S[i] !== S[i-1]`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.6**

- [x] 4. Checkpoint — Core services complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Admin Server Management Routes
  - [x] 5.1 Create `backend/routes/adminServers.js` with all CRUD endpoints
    - `GET /api/admin/servers` — list all server configs ordered by priority (Admin auth)
    - `POST /api/admin/servers` — create new server config; HTTP 201 on success, 409 on duplicate key, 400 on validation failure (Admin auth)
    - `PUT /api/admin/servers/reorder` — reorder by submitted key array; **register before `/:key`** to avoid Express param collision (Admin auth)
    - `PUT /api/admin/servers/:key` — update mutable fields; HTTP 200 / 404 (Admin auth)
    - `DELETE /api/admin/servers/:key` — delete; HTTP 200 / 404 (Admin auth)
    - `GET /api/admin/servers/health` — latest health result per server (Admin auth)
    - `POST /api/admin/servers/health/run` — trigger immediate health check cycle; return HTTP 202 immediately, run cycle async (Admin auth + Vercel Cron header)
    - All endpoints return HTTP 401 without valid admin JWT
    - _Requirements: 19.1–19.8_

  - [ ]* 5.2 Write unit tests for adminServers route
    - Test each endpoint for correct HTTP status codes (200, 201, 400, 401, 404, 409)
    - Test that `reorder` route is matched before `/:key`
    - _Requirements: 19.1–19.8_

- [x] 6. Browse API Route
  - [x] 6.1 Create `backend/routes/browse.js` with paginated, filtered endpoint
    - `GET /api/browse/:category` — public, no auth required
    - Accept query params: `page`, `limit` (max 48), `genre`, `yearMin`, `yearMax`, `ratingMin`, `ratingMax`, `language`, `status`, `sortBy`, `q`, `subDub`
    - Implement category-to-filter mapping: `movies→{category:'movie'}`, `anime→{category:'anime'}`, `series→{category:'series'}`, `kdrama→{original_language:'ko'}`, `chinese→{original_language:'zh'}`, `hindi→{original_language:'hi'}`
    - Return `{ items, total, page, totalPages, hasMore }`
    - Return HTTP 400 for unknown category values
    - Apply `subDubTag` filter when `subDub` param is provided and category is `anime`
    - _Requirements: 20.1–20.10_

  - [ ]* 6.2 Write property test for Browse API Filter Idempotence
    - **Property 4 (req): Filter Idempotence**
    - Generate random valid filter parameter objects; call the browse route handler twice with the same parameters against a seeded test database; assert `items` and `total` are identical
    - **Validates: Requirements 20.1, 20.2**

  - [ ]* 6.3 Write property test for Browse API Filter Monotonicity
    - **Property 8: Category Filter Monotonicity**
    - Generate a base filter set `F1` and a more restrictive superset `F2`; assert `total(F2) <= total(F1)`
    - **Validates: Requirements 14.2**

  - [ ]* 6.4 Write property test for Pagination Completeness
    - **Property 5: Pagination Completeness**
    - Generate random filter sets; paginate through all pages; assert `sum(items per page) === total` and all `_id` values are unique
    - **Validates: Requirements 13.6, 20.2**

  - [ ]* 6.5 Write unit tests for browse route
    - Test category mapping → correct MongoDB filter for each of the 6 categories
    - Test unknown category → HTTP 400
    - Test `subDub` filter → correct `subDubTag` filter applied for anime category
    - Test pagination → correct `skip` and `limit` applied
    - _Requirements: 20.3–20.10_

- [x] 7. Update Watch Route and Register New Routes in server.js
  - [x] 7.1 Update `backend/routes/watch.js` to use `ServerConfigService`
    - Replace hardcoded `EmbedServers` usage with `ServerConfigService.getEnabled()`
    - Construct embed URLs using `substitutePattern()` from `ServerHealthService`
    - Respect the 5-minute in-memory cache from `ServerConfigService`
    - _Requirements: 21.1, 21.2, 21.3, 21.4, 21.5_

  - [ ]* 7.2 Write property test for Embed URL Round-Trip Substitution
    - **Property 2: Embed URL Round-Trip Substitution**
    - Generate random `(tmdbId: integer 1–999999, season: 1–20, episode: 1–200)` tuples; for each of the 7 standard server URL patterns, substitute and extract back; assert extracted values equal originals
    - **Validates: Requirements 21.2**

  - [ ]* 7.3 Write property test for Enabled Server Subset Invariant
    - **Property 5: Enabled Server Subset Invariant**
    - Generate random arrays of server configs with random `enabled` values; call `getEnabled()`; assert all returned items have `enabled === true` and are sorted by `priority` ascending
    - **Validates: Requirements 3.5, 21.1, 21.3**

  - [x] 7.4 Register new routes and run seeding in `backend/server.js`
    - Import and mount `adminServers` router at `/api/admin/servers`
    - Import and mount `browse` router at `/api/browse`
    - Call `ServerConfigService.seedIfEmpty()` during server startup (after DB connection)
    - Add `*/30 * * * *` cron entry in `vercel.json` pointing to `POST /api/admin/servers/health/run`
    - _Requirements: 1.2, 1.3, 6.1_

- [x] 8. Checkpoint — Backend complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Frontend — Server Health Dashboard
  - [x] 9.1 Create `public/js/serverHealthDashboard.js`
    - On load, fetch `GET /api/admin/servers` and render one Server_Card per server with: name, Health_Status badge (green/amber/red), last checked timestamp ("X minutes ago"), success rate %, avg load time ms
    - Render summary row: total count, working count, degraded count, down count
    - Render toggle switch per card reflecting `enabled` state; on click, `PUT /api/admin/servers/:key` with `{ enabled: <new_boolean> }`; on success show toast; on failure revert toggle and show error toast
    - Render up/down arrow buttons per card; on click, `PUT /api/admin/servers/reorder` with swapped order; re-render list on success
    - Poll `GET /api/admin/servers/health` every 60 seconds; update cards and "Last Updated" timestamp without full page reload
    - _Requirements: 2.1–2.8, 3.1–3.6, 4.1–4.6_

  - [x] 9.2 Add "Add Server" modal and drag-and-drop reordering to `serverHealthDashboard.js`
    - Render "Add Server" button that opens a modal form with all required fields (Name, Key, Type, Movie/TV/Anime URL Pattern, Sandbox Policy, Timeout, Priority)
    - Validate fields client-side before submit; show inline errors; `POST /api/admin/servers` on submit; close modal and append card on success; show "Server key already exists" inline on 409
    - Implement HTML Drag and Drop API on server cards (`dragstart`, `dragover`, `drop`, `dragend`); commit new order via `PUT /api/admin/servers/reorder` on drop
    - _Requirements: 4.5, 5.1–5.6_

  - [x] 9.3 Add Server Health section to `public/pages/admin.html`
    - Add a "Server Health" section/tab to the existing admin panel HTML
    - Include a container element that `serverHealthDashboard.js` targets for rendering
    - Add `<script src="../js/serverHealthDashboard.js"></script>` reference
    - _Requirements: 2.1, 2.4_

- [x] 10. Frontend — Update embedServers.js with MongoDB-fetch mode
  - [x] 10.1 Add `loadFromMongoDB()` to `public/js/embedServers.js`
    - Implement async `loadFromMongoDB()` that fetches `GET /api/admin/servers` and rebuilds `STANDARD_SERVERS` and `ANIME_SERVERS` objects from the MongoDB data using `movieUrlPattern`, `tvUrlPattern`, `animeUrlPattern` fields
    - Update `buildHydraSources()` to use the dynamically loaded server list when available, falling back to the hardcoded list if the fetch fails or returns empty
    - On fetch failure, log a warning and continue with hardcoded list silently
    - All existing public API methods remain unchanged (backward compatible)
    - _Requirements: 21.1, 21.2, 21.3_

- [x] 11. Frontend — Netflix-Style Home Page Redesign
  - [x] 11.1 Implement Billboard carousel in `public/pages/index.html`
    - Fetch up to 5 featured/trending items for the billboard
    - Auto-advance every 6 seconds with cross-fade transition (≤ 600ms)
    - Render Progress_Dots (one per item, active dot highlighted); clicking a dot jumps to that item and resets timer
    - Pause auto-advance on hover (non-touch); resume on mouse-leave
    - Per item: backdrop image (full viewport width, ≥ 70% viewport height), title logo or title text fallback, match score (92–99, derived from `_id`), up to 3 genre pills, "Play Now" and "More Info" buttons linking to `movie-details.html?id={_id}`
    - On backdrop image load failure: show dark gradient, keep all text/buttons
    - _Requirements: 8.1–8.10_

  - [ ]* 11.2 Write property test for Billboard Item Count Invariant
    - **Property 11: Billboard Item Count Invariant**
    - Generate random item counts `N` from 1 to 10; call `renderBillboard(mockItems(N))`; assert progress dot count equals `Math.min(N, 5)`
    - **Validates: Requirements 8.1, 8.5**

  - [x] 11.3 Implement mobile responsiveness for Billboard
    - Below 768px: min-height 70vh, align copy to bottom, vertical gradient overlay, center-align title/meta/buttons
    - Below 768px: "Play Now" and "More Info" buttons at minimum 44×44px touch target
    - Below 768px: support swipe-left / swipe-right gestures to navigate Billboard_Items
    - _Requirements: 9.1–9.5_

  - [x] 11.4 Implement horizontal scroll Rails in `public/pages/index.html`
    - Render rails in order: Continue Watching (only if `cs_continue_watching` localStorage has items), Trending This Week, New Releases, Top Rated, Premium Series, Elite Anime, Hollywood, K-Drama, Chinese (Donghua), Hindi Dubbed, Recommended For You
    - Each rail: category label header, subtitle, "See All" link to `/browse/:category`
    - Continue Watching rail: items in reverse chronological order of last-watched timestamp
    - Hide rail section entirely when content array is empty (do not show empty container)
    - Below 768px: `scrollbar-width: none`, native touch scroll, card min-width 160px / max-width 74vw
    - _Requirements: 10.1–10.8_

  - [ ]* 11.5 Write property test for Rail Visibility Invariant
    - **Property 12: Rail Visibility Invariant**
    - Generate random content arrays (empty and non-empty); call `renderRailSection(items)`; assert visibility matches `items.length > 0`
    - **Validates: Requirements 10.6**

  - [x] 11.6 Implement 2:3 Rail Cards with hover-expand in `public/css/main.css`
    - Cards maintain 2:3 aspect ratio at all viewport sizes
    - Poster image as primary visual; dark placeholder with centred title on image load failure
    - On hover (non-touch): scale to 1.08× with CSS transition ≤ 250ms; show overlay with title, rating (star + number), up to 2 genre tags, "Play" button
    - "Play" button navigates to `movie-details.html?id={_id}`; clicking anywhere else on card also navigates
    - Only render cards where `canPlay(item)` returns `true`
    - _Requirements: 11.1–11.8_

  - [ ]* 11.7 Write property test for Playable Items Filter Invariant
    - **Property 13: Playable Items Filter Invariant**
    - Generate random movie objects with varying combinations of `tmdbId`, `anilistId`, `videoUrl`; call the rail renderer; assert only items where `canPlay()` returns `true` appear in the output
    - **Validates: Requirements 11.8**

  - [x] 11.8 Implement Category Filter Bar in `public/pages/index.html`
    - Pill buttons: All, Hollywood, Anime, Chinese (Donghua), K-Drama, Hindi Dubbed
    - Default active: "All" on page load
    - On pill click: update URL query param `sidebarCategory` without page reload; re-fetch and re-render all rails and billboard for selected category; render active pill with accent colour
    - On browser back: restore filter from URL query param
    - Below 768px: horizontal scrolling for filter bar (no wrapping)
    - _Requirements: 12.1–12.8_

- [x] 12. Checkpoint — Home page redesign complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. Frontend — Browse Pages
  - [x] 13.1 Create `public/pages/browse.html` shared template
    - Navbar (reuse existing from `app.js`)
    - Breadcrumb: "Home › {Category Name}" with `aria-label="breadcrumb"` and `aria-current="page"` on final segment
    - Category hero banner: background image, category name heading, short subtitle
    - Filter sidebar container (desktop: left panel; mobile: slide-in drawer via "Filters" button)
    - Active filter pills row + "Clear All Filters" button (visible when ≥ 1 filter active)
    - Subbed/Dubbed toggle container (rendered only for anime category)
    - In-category search input labelled "Search within {Category Name}…"
    - Card grid container + infinite scroll sentinel `<div>` at bottom
    - Loading spinner element
    - `<script src="../js/browse.js"></script>` reference
    - _Requirements: 13.1–13.3, 18.1–18.4_

  - [x] 13.2 Create `public/js/browse.js` — category detection, hero, breadcrumb, initial load
    - Read category from URL path (`/browse/:category`)
    - Render category hero banner and breadcrumb
    - Fetch initial 24 items from `GET /api/browse/:category`
    - Render card grid using existing `createMovieCard()` from `app.js`; responsive CSS grid, min card width 160px
    - _Requirements: 13.1–13.5_

  - [x] 13.3 Implement Infinite Scroll in `browse.js`
    - Use `IntersectionObserver` on the sentinel `<div>` at the bottom of the grid
    - When sentinel enters viewport (within 200px), fetch next page of 24 items and append to grid
    - Show loading spinner during fetch; hide after
    - When all items loaded (`hasMore === false`), display "You've reached the end" message and disconnect observer
    - On fetch failure: show "Failed to load more. Tap to retry." at bottom; retry on tap
    - _Requirements: 13.6–13.8_

  - [x] 13.4 Implement Filter Sidebar in `browse.js`
    - Render Genre (multi-select checkboxes), Year (min/max inputs), Rating (range: 0–10, step 0.5), Language (multi-select checkboxes), Status (checkboxes: Ongoing/Completed/Upcoming/Cancelled), Sort By (select: Newest/Oldest/Highest Rated/Most Popular/A–Z/Z–A)
    - On any filter change: re-fetch grid from page 1 with updated params; replace existing grid content
    - Render Active_Filter_Pills above grid (one per active filter value); clicking × removes that filter and re-fetches
    - "Clear All Filters" button resets all filters and re-fetches
    - Below 1024px: sidebar hidden by default, accessible via "Filters" button as slide-in drawer
    - ≥ 1024px: sidebar permanently visible as left panel
    - Persist sidebar open/closed state in `sessionStorage`
    - _Requirements: 14.1–14.8_

  - [x] 13.5 Implement Subbed/Dubbed toggle and in-category search in `browse.js`
    - Subbed/Dubbed toggle (anime page only): two-state toggle above grid; on change, re-fetch from page 1 with `subDub` param; reflect as Active_Filter_Pill
    - In-category search: debounce 300ms; re-fetch grid filtered to matching titles within category; show "Searching for: {query}" pill; on clear, re-fetch with previous filters; on zero results show "No results found for '{query}'"
    - _Requirements: 16.1–16.5, 17.1–17.5_

  - [ ]* 13.6 Write property test for SubDub Filter Correctness
    - **Property 14: SubDub Filter Correctness**
    - Generate random anime arrays with mix of `subDubTag` values; apply the `subDub` filter; assert all returned items match the filter
    - **Validates: Requirements 16.2, 16.3, 20.9**

  - [x] 13.7 Implement Browse Page card hover details in `public/css/main.css`
    - Cards maintain 2:3 aspect ratio; poster image as primary visual
    - On hover (non-touch): overlay with title, release year, rating, episode count (series/anime), "Play" button
    - "Play" button navigates to `movie-details.html?id={_id}`; clicking card body also navigates
    - Dark placeholder with centred title on image load failure
    - _Requirements: 15.1–15.5_

  - [x] 13.8 Add browse route rewrites to `vercel.json`
    - Add rewrite rules so `/browse/movies`, `/browse/anime`, `/browse/series`, `/browse/kdrama`, `/browse/chinese`, `/browse/hindi` all serve `public/pages/browse.html`
    - _Requirements: 13.1_

- [x] 14. Final Checkpoint — Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) with a minimum of 100 iterations per property
- The `reorder` route **must** be registered before `/:key` in Express to avoid param collision
- `ServerConfigService` cache invalidation is critical: any write must set `_cache = null`
- The `loadFromMongoDB()` in `embedServers.js` is opt-in and backward compatible — the player continues to work if the fetch fails
- Browse pages share a single `browse.html` template; category is determined at runtime from the URL path
- Vercel Cron for health checks uses the existing `cronOrAdmin` middleware (no new auth infrastructure needed)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "3.1"] },
    { "id": 3, "tasks": ["3.2", "3.3", "3.4"] },
    { "id": 4, "tasks": ["3.5", "3.6", "5.1", "6.1"] },
    { "id": 5, "tasks": ["5.2", "6.2", "6.3", "6.4", "6.5", "7.1"] },
    { "id": 6, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 7, "tasks": ["9.1", "10.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "11.1"] },
    { "id": 9, "tasks": ["11.2", "11.3", "11.4"] },
    { "id": 10, "tasks": ["11.5", "11.6", "11.8"] },
    { "id": 11, "tasks": ["11.7", "13.1"] },
    { "id": 12, "tasks": ["13.2"] },
    { "id": 13, "tasks": ["13.3", "13.4"] },
    { "id": 14, "tasks": ["13.5", "13.7", "13.8"] },
    { "id": 15, "tasks": ["13.6"] }
  ]
}
```
