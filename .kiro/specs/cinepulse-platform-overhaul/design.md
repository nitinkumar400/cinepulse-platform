# Design Document — CinePulse Platform Overhaul

## Overview

This document describes the technical design for three interconnected features that transform CinePulse into a Netflix-calibre streaming experience:

1. **Server Health Monitor & No-Code Server Management** — Migrate embed server configuration from the static `public/js/embedServers.js` file into MongoDB, add a live admin health dashboard, automated health checks via Vercel Cron, and in-app notifications on status transitions.

2. **Netflix-Style Home Page Redesign** — Full overhaul of `/pages/index.html` with a large auto-rotating billboard, horizontal scroll rails per category, 2:3 poster cards with hover-expand, and a category filter bar.

3. **Netflix-Style Category/Browse Pages** — Dedicated browse pages at `/browse/movies`, `/browse/anime`, `/browse/series`, `/browse/kdrama`, `/browse/chinese`, `/browse/hindi` with infinite-scroll grids, advanced filter sidebars, and in-category search.

### Research Summary

**Vercel Cron on Hobby/Pro plans**: Vercel Cron jobs are configured in `vercel.json` under the `"crons"` key. Each entry specifies a `path` (the API route to invoke) and a `schedule` (standard cron expression). The platform already uses this pattern for TMDB/AniList sync at `0 3 * * *` and `30 3 * * *`. A new cron entry at `*/30 * * * *` will trigger the health check cycle. Vercel injects the `x-vercel-cron: 1` header on every invocation, which the existing `cronOrAdmin` middleware already handles.

**MongoDB in-memory caching on serverless**: Because Vercel serverless functions are stateless and may spin up multiple instances, a simple module-level `let cache` variable is not globally shared. For the 5-minute server config cache (Requirement 21.4), we use a module-level object with a `cachedAt` timestamp. Within a single function invocation the cache is valid; across cold starts it is re-populated. This is acceptable because the requirement says "maximum of 5 minutes" — a cold start always fetches fresh data, which is within spec.

**Drag-and-drop in Vanilla JS**: The HTML Drag and Drop API is natively supported in all modern browsers. No library is needed. We use `dragstart`, `dragover`, `drop`, and `dragend` events on the server card elements, with `dataTransfer.setData` to pass the dragged server key.

**Infinite scroll implementation**: The `IntersectionObserver` API provides a performant, scroll-event-free way to detect when a sentinel element at the bottom of the grid enters the viewport. This is the standard approach for infinite scroll in Vanilla JS without a framework.

---

## Architecture

The overhaul adds three new backend layers and three new frontend modules on top of the existing Express/MongoDB/Vanilla JS stack.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          Frontend (Public)                               │
│                                                                          │
│  public/pages/index.html (redesigned)                                   │
│  public/pages/browse.html (new shared template)                         │
│  public/js/browse.js (new)                                              │
│  public/js/serverHealthDashboard.js (new)                               │
│  public/js/embedServers.js (updated — MongoDB-fetch mode)               │
│  public/css/main.css (updated — new component styles)                   │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ HTTP / REST
┌──────────────────────────────▼──────────────────────────────────────────┐
│                       Express Backend (api/server.js)                    │
│                                                                          │
│  NEW ROUTES                                                              │
│  backend/routes/adminServers.js   — CRUD + reorder + health trigger     │
│  backend/routes/browse.js         — /api/browse/:category               │
│                                                                          │
│  UPDATED ROUTES                                                          │
│  backend/routes/watch.js          — uses ServerConfigService            │
│                                                                          │
│  NEW SERVICES                                                            │
│  backend/services/serverConfigService.js  — CRUD + cache + seeding      │
│  backend/services/serverHealthService.js  — probe + record + notify     │
│                                                                          │
│  NEW MODELS                                                              │
│  backend/models/EmbedServerConfig.js                                    │
│  backend/models/EmbedServerHealth.js                                    │
└──────────────────────────────┬──────────────────────────────────────────┘
                               │ Mongoose ODM
┌──────────────────────────────▼──────────────────────────────────────────┐
│                           MongoDB Atlas                                  │
│                                                                          │
│  embed_server_configs   (new collection)                                │
│  embed_server_health    (new collection)                                │
│  movies                 (existing — unchanged schema)                   │
│  notifications          (existing — extended with server alert types)   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Vercel Cron Integration

```
vercel.json crons:
  "*/30 * * * *"  →  POST /api/admin/servers/health/run
  "0 3 * * *"     →  POST /api/sync          (existing)
  "30 3 * * *"    →  POST /api/sync/anime    (existing)
```

The health check cron hits the same `cronOrAdmin` middleware as the existing sync routes, so no new auth infrastructure is needed.

---

## Components and Interfaces

### Backend Components

#### `EmbedServerConfig` Model (`backend/models/EmbedServerConfig.js`)

Mongoose model for the `embed_server_configs` collection. Stores all configuration for a single embed server.

**Key fields**: `key` (unique), `name`, `type` (standard|anime), `priority`, `enabled`, `sandboxPolicy`, `movieUrlPattern`, `tvUrlPattern`, `animeUrlPattern`, `timeout`, `lastCheckedAt`, `lastStatus`, `successRate`, `avgLoadTime`.

#### `EmbedServerHealth` Model (`backend/models/EmbedServerHealth.js`)

Mongoose model for the `embed_server_health` collection. Stores individual probe results with a 30-day TTL index.

**Key fields**: `serverKey`, `status` (Working|Degraded|Down), `responseTime`, `httpStatusCode`, `checkedAt`.

#### `ServerConfigService` (`backend/services/serverConfigService.js`)

Singleton service responsible for:
- **Seeding**: On startup, if `embed_server_configs` is empty, insert all 12 servers from `embedServers.js` data.
- **CRUD**: `getAll()`, `getEnabled()`, `create(data)`, `update(key, data)`, `delete(key)`, `reorder(orderedKeys)`.
- **Priority management**: When inserting or updating with a conflicting priority, shift all documents with `priority >= newPriority` up by 1.
- **Caching**: Module-level cache with a 5-minute TTL for `getEnabled()`. Cache is invalidated on any write operation.

**Cache invalidation**: Any call to `create`, `update`, `delete`, or `reorder` sets `_cache = null` so the next `getEnabled()` call fetches fresh data from MongoDB.

#### `ServerHealthService` (`backend/services/serverHealthService.js`)

Service responsible for:
- **Probing**: For each enabled server, construct the probe URL using the server's URL pattern and the configured `HEALTH_CHECK_PROBE_TMDB_ID` / `HEALTH_CHECK_PROBE_ANILIST_ID` env vars. Issue an HTTP HEAD request (or GET if HEAD is not supported) with the server's configured timeout.
- **Recording**: Write a `EmbedServerHealth` document for each probe result.
- **Updating**: After recording, update the `EmbedServerConfig` document with `lastCheckedAt`, `lastStatus`, `successRate` (computed from last 30 days), `avgLoadTime` (computed from last 30 days).
- **Notifying**: Compare new status to previous `lastStatus`; if different, create a `Notification` document and call `notifyAllUsers` for admin-targeted notifications.
- **Cleanup**: Delete `EmbedServerHealth` documents older than 30 days during each cycle.
- **Parallelism**: Use `Promise.allSettled()` to probe all servers concurrently.

#### `adminServers` Route (`backend/routes/adminServers.js`)

All routes require `protect` + `adminOnly` middleware.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/servers` | List all server configs ordered by priority |
| POST | `/api/admin/servers` | Create new server config |
| PUT | `/api/admin/servers/reorder` | Reorder servers by submitted key array |
| GET | `/api/admin/servers/health` | Get latest health result per server |
| POST | `/api/admin/servers/health/run` | Trigger immediate health check cycle (async, returns 202) |
| PUT | `/api/admin/servers/:key` | Update server config fields |
| DELETE | `/api/admin/servers/:key` | Delete server config |

**Note**: `reorder` must be registered before `/:key` to avoid Express matching "reorder" as a key parameter.

#### `browse` Route (`backend/routes/browse.js`)

Public route (no auth required).

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/browse/:category` | Paginated, filtered content for a category |

Accepted query parameters: `page`, `limit` (max 48), `genre`, `yearMin`, `yearMax`, `ratingMin`, `ratingMax`, `language`, `status`, `sortBy`, `q`, `subDub`.

Category-to-filter mapping:
- `movies` → `{ category: 'movie' }`
- `anime` → `{ category: 'anime' }`
- `series` → `{ category: 'series' }`
- `kdrama` → `{ original_language: 'ko' }`
- `chinese` → `{ original_language: 'zh' }`
- `hindi` → `{ original_language: 'hi' }`

Returns: `{ items, total, page, totalPages, hasMore }`.

### Frontend Components

#### `serverHealthDashboard.js` (`public/js/serverHealthDashboard.js`)

Vanilla JS module that powers the Server Health section of the admin panel. Responsibilities:
- Fetch server list from `GET /api/admin/servers` on load.
- Render server cards with status badges, toggle switches, and reorder arrows.
- Poll `GET /api/admin/servers/health` every 60 seconds to refresh status data.
- Handle toggle clicks (PATCH to `PUT /api/admin/servers/:key`).
- Handle arrow clicks and drag-drop reordering (PUT to `/api/admin/servers/reorder`).
- Open "Add Server" modal and handle form submission.
- Display toast notifications on success/error.

#### `browse.js` (`public/js/browse.js`)

Vanilla JS module for all browse pages. Responsibilities:
- Read the current category from the URL path (`/browse/:category`).
- Render the category hero banner and breadcrumb.
- Fetch initial 24 items from `GET /api/browse/:category`.
- Render the card grid using the existing `createMovieCard()` function from `app.js`.
- Implement infinite scroll using `IntersectionObserver` on a sentinel `<div>` at the bottom of the grid.
- Render the filter sidebar with Genre, Year, Rating, Language, Status, Sort By controls.
- Manage active filter pills and "Clear All Filters" button.
- Implement in-category search with 300ms debounce.
- Handle Subbed/Dubbed toggle (anime page only).
- Persist sidebar open/closed state in `sessionStorage`.

#### Updated `embedServers.js` (`public/js/embedServers.js`)

Add a `loadFromMongoDB()` async function that fetches the server list from `GET /api/admin/servers` (public endpoint — no auth required for reading enabled servers) and rebuilds the `STANDARD_SERVERS` and `ANIME_SERVERS` objects from the MongoDB data. The existing `buildHydraSources()` function is updated to use the dynamically loaded server list when available, falling back to the hardcoded list if the fetch fails.

**Backward compatibility**: All existing public API methods (`buildHydraSources`, `canPlay`, `getIframeAttributes`, etc.) remain unchanged. The MongoDB-fetch mode is opt-in via `EmbedServers.loadFromMongoDB()`.

#### Updated `index.html` (`public/pages/index.html`)

Full redesign with:
- **Billboard section**: 5-item auto-rotating carousel with cross-fade, progress dots, pause-on-hover, swipe support.
- **Category filter bar**: Pill buttons for All, Hollywood, Anime, Chinese, K-Drama, Hindi Dubbed.
- **Rail sections**: Continue Watching, Trending, New Releases, Top Rated, Premium Series, Elite Anime, Hollywood, K-Drama, Chinese, Hindi Dubbed, Recommended.
- Each rail has a "See All" link pointing to the corresponding `/browse/:category` page.

#### `browse.html` (`public/pages/browse.html`)

Shared HTML template for all six browse pages. The category is determined at runtime from the URL path. Structure:
- Navbar (reuses existing navbar from `app.js`)
- Breadcrumb
- Category hero banner
- Filter sidebar (desktop: left panel; mobile: slide-in drawer)
- Active filter pills + "Clear All Filters"
- Subbed/Dubbed toggle (rendered only for anime category)
- In-category search input
- Card grid
- Infinite scroll sentinel
- Loading spinner

---

## Data Models

### `EmbedServerConfig` Schema

```javascript
// Collection: embed_server_configs
{
  key:              String,   // unique, e.g. "vidlink", "vidnest"
  name:             String,   // display name, e.g. "VidLink"
  type:             String,   // enum: "standard" | "anime"
  priority:         Number,   // integer >= 1, lower = higher priority
  enabled:          Boolean,  // default: true
  sandboxPolicy:    String,   // default: "none"
  movieUrlPattern:  String,   // e.g. "https://vidlink.pro/movie/{tmdbId}"
  tvUrlPattern:     String,   // e.g. "https://vidlink.pro/tv/{tmdbId}/{season}/{episode}"
  animeUrlPattern:  String,   // e.g. "https://vidnest.fun/anime/{anilistId}/{episode}/sub"
  timeout:          Number,   // milliseconds, default: 9000
  // Health data (updated by ServerHealthService)
  lastCheckedAt:    Date,
  lastStatus:       String,   // enum: "Working" | "Degraded" | "Down" | null
  successRate:      Number,   // 0-100, computed over last 30 days
  avgLoadTime:      Number,   // milliseconds, computed over last 30 days
  createdAt:        Date,
  updatedAt:        Date,
}

// Indexes:
// { key: 1 }  — unique
// { priority: 1 }
// { enabled: 1, priority: 1 }
```

### `EmbedServerHealth` Schema

```javascript
// Collection: embed_server_health
{
  serverKey:      String,   // references EmbedServerConfig.key
  status:         String,   // enum: "Working" | "Degraded" | "Down"
  responseTime:   Number,   // milliseconds
  httpStatusCode: Number,   // HTTP status code, or null on timeout
  checkedAt:      Date,     // default: Date.now
}

// Indexes:
// { serverKey: 1, checkedAt: -1 }
// { checkedAt: 1 }  — TTL index: expireAfterSeconds: 2592000 (30 days)
```

### Notification Schema Extension

The existing `Notification` model's `type` enum is extended to include server alert types:

```javascript
type: {
  enum: [
    'new_content',
    'review_liked',
    'new_episode',
    'system',
    'server_down',      // NEW
    'server_degraded',  // NEW
    'server_recovered', // NEW
  ]
}
```

Server alert notifications use `user: null` (broadcast to all admins) and a new `severity` field (`critical` | `warning` | `info`).

### URL Pattern Substitution

URL patterns stored in `EmbedServerConfig` use `{placeholder}` syntax:

| Placeholder | Replaced with |
|-------------|---------------|
| `{tmdbId}` | Movie's `tmdbId` or `tmdb_id` |
| `{season}` | Season number (integer) |
| `{episode}` | Episode number (integer) |
| `{anilistId}` | Movie's `anilistId` or `anilist_id` |

Substitution function:
```javascript
function substitutePattern(pattern, vars) {
  return pattern
    .replace('{tmdbId}', vars.tmdbId ?? '')
    .replace('{season}', vars.season ?? 1)
    .replace('{episode}', vars.episode ?? 1)
    .replace('{anilistId}', vars.anilistId ?? '');
}
```

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Server Priority Sequence Invariant

*For any* sequence of create, update, reorder, or delete operations on the `embed_server_configs` collection, the set of `priority` values across all remaining documents SHALL always form a contiguous integer sequence starting at 1 with no gaps and no duplicates.

**Validates: Requirements 1.6, 4.2, 4.3, 19.5**

---

### Property 2: Embed URL Round-Trip Substitution

*For any* valid `tmdbId` (positive integer), `season` (1–20), and `episode` (1–200), substituting these values into a standard server's `movieUrlPattern` or `tvUrlPattern` and then extracting the values back from the resulting URL SHALL recover the original values.

**Validates: Requirements 21.2**

---

### Property 3: Health Check Status Classification

*For any* probe result `(responseTime, httpStatusCode, timeout)`, the `ServerHealthService` SHALL classify the result as:
- `Working` if and only if `responseTime <= timeout` AND `httpStatusCode === 200`
- `Degraded` if and only if `responseTime <= timeout` AND `httpStatusCode !== 200`
- `Down` if and only if `responseTime > timeout` (i.e., the probe timed out)

**Validates: Requirements 6.3, 6.4, 6.5**

---

### Property 4: Health Check Success Rate Bounds

*For any* sequence of Health_Check results (length 1 to 1000) for a single server, the `successRate` computed by `ServerHealthService` SHALL always be a number in the closed interval [0, 100].

**Validates: Requirements 6.7**

---

### Property 5: Enabled Server Subset Invariant

*For any* configuration of enabled/disabled servers in `embed_server_configs`, the set of server keys returned by `GET /api/watch/:id/sources` SHALL always be a subset of the server keys where `enabled` is `true`.

**Validates: Requirements 3.5, 21.1, 21.3**

---

### Property 6: Notification Transition-Only Invariant

*For any* sequence of consecutive `Health_Status` values for a single server (length 1 to 100), the number of `In_App_Notifications` created by `ServerHealthService` SHALL equal the number of status transitions (positions where `S[i] !== S[i-1]`), not the total number of checks.

**Validates: Requirements 7.1, 7.2, 7.3, 7.6**

---

### Property 7: Server Config Serialisation Round-Trip

*For any* valid `EmbedServerConfig` object, saving it to MongoDB and reading it back SHALL produce a document with identical values for all user-supplied fields (`key`, `name`, `type`, `priority`, `enabled`, `sandboxPolicy`, `movieUrlPattern`, `tvUrlPattern`, `animeUrlPattern`, `timeout`).

**Validates: Requirements 1.1**

---

### Property 8: Browse API Filter Idempotence

*For any* valid set of filter parameters `P`, calling `GET /api/browse/:category?P` twice in succession SHALL return identical `items` arrays and identical `total` counts.

**Validates: Requirements 20.1, 20.2**

---

### Property 9: Browse API Filter Monotonicity

*For any* two filter sets `F1` and `F2` where `F2` is strictly more restrictive than `F1` (i.e., `F2` adds at least one additional constraint), the `total` returned by `GET /api/browse/:category?F2` SHALL be less than or equal to the `total` returned by `GET /api/browse/:category?F1`.

**Validates: Requirements 14.2**

---

### Property 10: Pagination Completeness

*For any* valid filter parameter set `P` where `total > 0`, fetching all pages of results and concatenating the `items` arrays SHALL yield exactly `total` items with no duplicate `_id` values.

**Validates: Requirements 13.6, 20.2**

---

### Property 11: Billboard Item Count Invariant

*For any* number of featured items `N` returned by the API (where `N >= 1`), the Billboard SHALL render exactly `min(N, 5)` Progress_Dots and display exactly `min(N, 5)` Billboard_Items.

**Validates: Requirements 8.1, 8.5**

---

### Property 12: Rail Visibility Invariant

*For any* rail where the content array is empty, the rail section SHALL be hidden (not rendered in the DOM or set to `display: none`). *For any* rail where the content array is non-empty, the rail section SHALL be visible.

**Validates: Requirements 10.6**

---

### Property 13: Playable Items Filter Invariant

*For any* list of movie objects passed to a rail or browse grid renderer, only items where `canPlay(item)` returns `true` SHALL be rendered as cards.

**Validates: Requirements 11.8**

---

### Property 14: SubDub Filter Correctness

*For any* call to `GET /api/browse/anime?subDub=dubbed`, all items in the response SHALL have `subDubTag === "Dubbed"`. *For any* call with `subDub=subbed`, all items SHALL have `subDubTag === "Subbed"` or `subDubTag` is null/undefined.

**Validates: Requirements 16.2, 16.3, 20.9**

---

## Error Handling

### Backend Error Handling

**ServerConfigService**
- `create()` with duplicate key → throw `{ status: 409, message: 'Server key already exists' }`
- `update()` / `delete()` with unknown key → throw `{ status: 404, message: 'Server not found' }`
- `reorder()` with mismatched key set → throw `{ status: 400, message: 'orderedKeys must match all existing server keys' }`
- MongoDB connection failure during seeding → log error, do not crash server startup; the player falls back to the hardcoded `embedServers.js` list

**ServerHealthService**
- Individual probe failure (network error, DNS failure) → record as `Down` with `responseTime = timeout`; log at `warn` level
- Unhandled exception in the full cycle → log at `error` level; do not crash; next cron invocation will retry
- `notifyAllUsers` failure → log at `warn` level; do not fail the health check cycle

**Browse Route**
- Unknown `:category` value → HTTP 400 with `{ message: 'Unknown category. Valid values: movies, anime, series, kdrama, chinese, hindi' }`
- MongoDB timeout on large filter queries → return `{ items: [], total: 0, degraded: true, message: 'Query timed out. Please try again.' }` (mirrors existing pattern in `movies.js`)

### Frontend Error Handling

**serverHealthDashboard.js**
- API fetch failure → display error banner "Failed to load server data. Retrying in 60s." and retry on next poll interval
- Toggle PATCH failure → revert toggle to previous state; show error toast
- Reorder failure → re-fetch and re-render the full server list; show error toast

**browse.js**
- Initial fetch failure → display "Failed to load content. Please refresh." in place of the card grid
- Infinite scroll fetch failure → display "Failed to load more. Tap to retry." at the bottom of the grid; retry on tap
- Filter application failure → show error toast; do not clear existing grid content

**embedServers.js MongoDB-fetch mode**
- `loadFromMongoDB()` fetch failure → log warning; fall back to hardcoded server list silently; player continues to work

---

## Testing Strategy

### Unit Tests

Unit tests cover pure functions and service logic in isolation, using mocked MongoDB and HTTP clients.

**ServerConfigService**
- `create()` with valid data → document inserted with correct fields
- `create()` with duplicate key → throws 409
- `create()` with conflicting priority → existing documents shifted correctly
- `update()` with unknown key → throws 404
- `reorder()` with valid key array → priorities reassigned as [1, 2, ..., N]
- `getEnabled()` → returns only enabled documents sorted by priority
- Cache invalidation → after any write, next `getEnabled()` fetches from DB

**ServerHealthService**
- `classifyProbeResult(responseTime, statusCode, timeout)` → correct status for all three cases
- `computeSuccessRate(results)` → correct percentage, always in [0, 100]
- `computeAvgLoadTime(results)` → correct mean, non-negative
- `shouldNotify(previousStatus, newStatus)` → true only on transitions
- Cleanup → documents older than 30 days are deleted

**Browse Route**
- Category mapping → correct MongoDB filter for each of the 6 categories
- Unknown category → HTTP 400
- `subDub` filter → correct `subDubTag` filter applied for anime category
- Pagination → correct `skip` and `limit` applied

**URL Pattern Substitution**
- `substitutePattern(pattern, vars)` → correct substitution for all placeholder types
- Missing placeholder in pattern → returns pattern with empty string substitution (no crash)

### Property-Based Tests

Property-based tests use [fast-check](https://github.com/dubzzz/fast-check) (JavaScript) with a minimum of 100 iterations per property.

Each test is tagged with: `// Feature: cinepulse-platform-overhaul, Property {N}: {property_text}`

**Property 1 — Priority Sequence Invariant**
Generate random sequences of add/remove/reorder operations on an in-memory representation of `embed_server_configs`. After each operation, assert the priority values form `[1, 2, ..., N]`.

**Property 2 — Embed URL Round-Trip Substitution**
Generate random `(tmdbId: integer 1–999999, season: 1–20, episode: 1–200)` tuples. For each of the 7 standard server URL patterns, substitute and extract back. Assert extracted values equal originals.

**Property 3 — Health Check Status Classification**
Generate random `(responseTime: 0–20000, httpStatusCode: 100–599, timeout: 5000–15000)` triples. Assert `classifyProbeResult()` returns the correct status per the three-way rule.

**Property 4 — Health Check Success Rate Bounds**
Generate random arrays of `Health_Status` values (length 1–1000). Assert `computeSuccessRate()` always returns a value in `[0, 100]`.

**Property 5 — Enabled Server Subset Invariant**
Generate random arrays of server configs with random `enabled` values. Call `getEnabled()`. Assert all returned items have `enabled === true` and are sorted by `priority` ascending.

**Property 6 — Notification Transition-Only Invariant**
Generate random arrays of `Health_Status` values (length 1–100). Simulate the notification logic. Assert notification count equals the number of adjacent pairs where `S[i] !== S[i-1]`.

**Property 7 — Server Config Serialisation Round-Trip**
Generate random valid `EmbedServerConfig` objects (using fast-check arbitraries for strings, booleans, integers). Insert into a test MongoDB instance. Read back. Assert field equality for all user-supplied fields.

**Property 8 — Browse API Filter Idempotence**
Generate random valid filter parameter objects. Call the browse route handler twice with the same parameters against a seeded test database. Assert `items` and `total` are identical.

**Property 9 — Browse API Filter Monotonicity**
Generate a base filter set `F1` and a more restrictive superset `F2` (add one additional constraint). Assert `total(F2) <= total(F1)`.

**Property 10 — Pagination Completeness**
Generate random filter sets. Paginate through all pages. Assert `sum(items per page) === total` and all `_id` values are unique.

**Property 11 — Billboard Item Count Invariant**
Generate random item counts `N` from 1 to 10. Call `renderBillboard(mockItems(N))`. Assert progress dot count equals `Math.min(N, 5)`.

**Property 12 — Rail Visibility Invariant**
Generate random content arrays (empty and non-empty). Call `renderRailSection(items)`. Assert visibility matches `items.length > 0`.

**Property 13 — Playable Items Filter Invariant**
Generate random movie objects with varying combinations of `tmdbId`, `anilistId`, `videoUrl`. Call the rail renderer. Assert only items where `canPlay()` returns `true` appear in the output.

**Property 14 — SubDub Filter Correctness**
Generate random anime arrays with mix of `subDubTag` values. Apply the `subDub` filter. Assert all returned items match the filter.

### Integration Tests

Integration tests run against a real MongoDB Atlas test cluster (or local MongoDB) and verify end-to-end behavior.

- Full health check cycle: seed 3 servers, run cycle with mocked HTTP, assert `EmbedServerHealth` documents created and `EmbedServerConfig` documents updated
- Admin CRUD flow: create → read → update → delete → assert collection state
- Browse pagination: seed 50 movies in a category, paginate through all pages, assert completeness
- Player sources: seed 3 enabled + 2 disabled servers, call `GET /api/watch/:id/sources`, assert only 3 servers returned

### Smoke Tests

- Vercel Cron configuration: assert `vercel.json` contains the `*/30 * * * *` health check cron entry
- MongoDB TTL index: assert `embed_server_health` collection has a TTL index on `checkedAt` with `expireAfterSeconds: 2592000`
- Seeding: assert that after a fresh deployment with empty `embed_server_configs`, the collection contains exactly 12 documents (7 standard + 5 anime)
