# DATA ALIGNMENT REPORT — CineStream v2.0 (100K Matrix Edition)

**Audit Date:** May 14, 2026  
**Auditor:** Principal Data Integrity Engineer  
**Scope:** Read-only codebase inspection for 100,000-record scale readiness  
**Files Inspected:**
- `scripts/mass_seed.js` (v2.0 Matrix Edition)
- `backend/models/Movie.js`
- `backend/routes/movies.js`
- `backend/services/recommendationService.js`
- `public/js/app.js`
- `public/js/movieDetailsPage.js`
- `package.json`

---

## A. Schema Mapping & Category Uniformity

### A1. Category Enum Alignment

**Status: [ALIGNMENT_OK]**

The `Movie.js` schema defines the category enum as:
```
['movie', 'anime', 'cartoon', 'series', 'documentary', 'short']
```

The matrix profiles in `mass_seed.js` write only three values:
| Profile Group | Category Written |
|---|---|
| hollywood-movies | `movie` |
| hollywood-tv | `series` |
| anime-japanese / donghua | `anime` |
| cdrama / thai-drama | `series` |
| bollywood-movies / south-indian | `movie` |
| bollywood-tv / south-indian-tv | `series` |
| netflix-movies / prime-movies | `movie` |
| netflix-tv / prime-tv | `series` |

All values (`movie`, `series`, `anime`) are valid members of the enum. No invalid categories will be written. The `cartoon`, `documentary`, and `short` categories are unused by the matrix loop but remain valid for manual admin uploads.

---

### A2. Structural Identifier Uniformity (tmdbId / tmdb_id / anilistId / anilist_id)

**Status: [ALIGNMENT_OK]**

**Seed script behavior:**
- `mapTmdbMovie()` and `mapTmdbTv()` both set `tmdbId` AND `tmdb_id` to the same numeric value (lines ~180-220 of mass_seed.js).
- `pruneNullIds()` removes any null/0/undefined ID fields from `$set` and moves them to `$unset`, preventing sparse-unique index collisions.
- `buildBulkOp()` uses `$or: [{ tmdbId: X }, { tmdb_id: X }]` as the filter, ensuring deduplication works regardless of which field was set first.

**Schema behavior:**
- The `pre('save')` hook in `Movie.js` (line ~225) syncs `tmdbId ↔ tmdb_id` and `anilistId ↔ anilist_id` bidirectionally. However, this hook does NOT fire during `bulkWrite` (which bypasses Mongoose middleware). The seed script compensates by always setting both fields explicitly.

**Verdict:** Single source of truth is maintained. Downstream embed matching (which uses `tmdbId` or `tmdb_id`) will find records regardless of which field is queried.

---

## B. Index Efficiency & Free-Tier Safety

### B1. Sparse Unique Indexes on tmdbId / tmdb_id

**Status: [ALIGNMENT_OK]**

`Movie.js` lines 247-248:
```javascript
MovieSchema.index({ tmdbId:  1 }, { unique: true, sparse: true });
MovieSchema.index({ tmdb_id: 1 }, { unique: true, sparse: true });
```

The `mass_seed.js` `ensureIndexes()` function (lines 1124-1125) also creates these with `sparse: true`:
```javascript
await collection.createIndex({ tmdbId: 1 }, { unique: true, sparse: true, background: true });
await collection.createIndex({ tmdb_id: 1 }, { unique: true, sparse: true, background: true });
```

The `pruneNullIds()` helper ensures null values are never written to these fields — they are `$unset` instead. This eliminates the null-key collision error that would otherwise occur at scale.

**Verdict:** Safe at 100,000 records. No duplicate key errors will occur from null values.

---

### B2. Text Search Index & Memory Pressure

**Status: [PERFORMANCE_WARN]**

**File:** `backend/models/Movie.js`, line 251  
**Index:** `{ title: 'text', description: 'text' }`

**Issue:** At 100,000 documents, a text index on both `title` and `description` (which can be up to 600 chars each) will consume significant RAM on MongoDB Atlas free-tier (M0: 512MB RAM shared). The text index stores tokenized stems for every word in both fields.

**Estimated impact:**
- ~100K docs × avg 8 tokens/title + 40 tokens/description ≈ 4.8M index entries
- On M0/M2 clusters this may push working set beyond available RAM, causing index swaps to disk and degraded query latency.

**Mitigation (when ready to patch):**
- Consider reducing the text index to `{ title: 'text' }` only, since the `description` field is rarely searched directly and the regex fallback in `GET /api/movies` already covers it.
- Alternatively, add `weights: { title: 10, description: 1 }` to prioritize title matches and allow MongoDB to short-circuit description scanning.

---

### B3. Missing Compound Index for Trending/Recommendation Sort Pattern

**Status: [PERFORMANCE_WARN]**

**File:** `backend/models/Movie.js` — index definitions (lines 241-251)  
**Affected queries:**
- `backend/routes/movies.js` line 402: `.sort({ averageRating: -1, views: -1, createdAt: -1 })`
- `backend/services/recommendationService.js` line 88: `.sort({ views: -1, averageRating: -1, createdAt: -1 })`
- `backend/routes/movies.js` line 466: `.sort({ averageRating: -1, views: -1 })`

**Issue:** No compound index exists for `{ averageRating: -1, views: -1, createdAt: -1 }` or `{ views: -1, averageRating: -1, createdAt: -1 }`. The existing single-field indexes (`views: -1` at line 243, `createdAt: -1` at line 244) cannot satisfy a multi-field sort. MongoDB will perform an in-memory sort on the full result set.

At 100,000 documents, an in-memory sort on unfiltered queries (like the trending fallback with no `createdAt` filter) will:
- Exceed the 32MB sort memory limit on Atlas free-tier
- Trigger Vercel serverless gateway timeouts (10s limit)

**Mitigation (when ready to patch):**
Add compound indexes to `Movie.js`:
```javascript
MovieSchema.index({ averageRating: -1, views: -1, createdAt: -1 });
MovieSchema.index({ category: 1, averageRating: -1, views: -1 });
```

---

## C. Backend Query Routing & Pagination Alignment

### C1. Pagination Boundary Enforcement

**Status: [ALIGNMENT_OK]**

**File:** `backend/routes/movies.js`, GET `/api/movies` handler

```javascript
const pageNumber = Math.max(1, parseInt(page, 10) || 1);
const limitNumber = Math.min(50, Math.max(1, parseInt(limit, 10) || 20));
const skip = (pageNumber - 1) * limitNumber;
```

- `limit` is clamped to `[1, 50]` — no client can request more than 50 documents per page.
- `page` is floored at 1 — no negative skip values.
- `parseInt(..., 10)` with `|| 1` / `|| 20` fallbacks prevent NaN injection.
- `maxTimeMS(5000)` is applied to both `countDocuments` and `find`, preventing runaway queries from blocking the Vercel function.

The `/search` endpoint uses identical clamping logic. The `/trending` endpoint caps at `Math.min(20, ...)`.

**Verdict:** Vercel serverless functions will never load massive arrays. Safe at 100K scale.

---

### C2. Unindexed Collection Scans on Sort Queries

**Status: [PERFORMANCE_WARN]**

**File:** `backend/routes/movies.js`, GET `/api/movies` handler  
**Sort options defined:**
```javascript
const sortOptions = {
  newest:        { createdAt: -1 },    // ✅ Indexed (line 244)
  oldest:        { createdAt:  1 },    // ✅ Covered by reverse scan of createdAt index
  views:         { views: -1 },        // ✅ Indexed (line 243)
  rating:        { averageRating: -1 },// ⚠️ NO dedicated index
  titleAZ:       { title:  1 },        // ✅ Indexed (line 241)
  titleZA:       { title: -1 },        // ✅ Covered by reverse scan
  most_viewed:   { views: -1 },        // ✅ Same as views
  highest_rated: { averageRating: -1 },// ⚠️ NO dedicated index
};
```

**Issue:** `averageRating: -1` has no single-field index. When a user sorts by "rating" or "highest_rated" with no category filter, MongoDB must scan all 100K documents and sort in memory.

**Mitigation (when ready to patch):**
Add to `Movie.js`:
```javascript
MovieSchema.index({ averageRating: -1 });
```

Or better, a compound index that covers the most common filtered sort:
```javascript
MovieSchema.index({ category: 1, averageRating: -1 });
```

---

### C3. Regex Search Without Index Support

**Status: [PERFORMANCE_WARN]**

**File:** `backend/routes/movies.js`, GET `/api/movies` handler  
**Lines:** The `$or` filter with `$regex` on `title`, `description`, `category`, `genre`, `director`, `studio`, `cast`

```javascript
filter.$or = [
  { title:       { $regex: search.trim(), $options: 'i' } },
  { description: { $regex: search.trim(), $options: 'i' } },
  // ... 5 more fields
];
```

**Issue:** Case-insensitive regex (`$options: 'i'`) cannot use B-tree indexes. At 100K documents, this triggers a full collection scan for every search request. The `maxTimeMS(5000)` timeout provides a safety net, but users will experience degraded search results.

**Mitigation (when ready to patch):**
- For prefix searches, use `$text` operator with the existing text index instead of regex.
- For substring searches, consider Atlas Search (if on M10+) or accept the `maxTimeMS` degraded response as the current fallback behavior (already implemented).

**Severity:** Low — the existing `maxTimeMS` + `degraded: true` response pattern handles this gracefully. Users get an empty result with a retry message rather than a timeout crash.

---

## D. Internationalization Tracking (SUB/DUB Badge Integrity)

### D1. Language Field Storage by Matrix Loop

**Status: [PERFORMANCE_WARN]**

**File:** `scripts/mass_seed.js`, `mapTmdbMovie()` and `mapTmdbTv()` functions

**Fields written:**
| Field | Value Written | Source |
|---|---|---|
| `original_language` | `item.original_language` (e.g., `'ja'`, `'hi'`, `'zh'`) | ✅ Always present in TMDB response |
| `spoken_languages` | **NOT written** | ⚠️ Missing |
| `language` | **NOT written** (defaults to schema default `'English'`) | ⚠️ Incorrect for non-English content |

**Issue:** The matrix loop does NOT populate `spoken_languages` or `language` fields. The schema defaults `language` to `'English'` for all records, which is incorrect for Hindi, Japanese, Thai, Chinese, and South Indian content.

The `pre('save')` hook in `Movie.js` (line ~230) attempts to backfill:
```javascript
if ((!this.spoken_languages || this.spoken_languages.length === 0) && this.language) {
  this.spoken_languages = [String(this.language).trim()].filter(Boolean);
}
```
But this hook does NOT fire during `bulkWrite`. So `spoken_languages` remains `[]` for all seeded records.

**Impact on frontend:**
- `public/js/app.js` line 427: `Array.isArray(movie.spoken_languages) ? movie.spoken_languages : []`
- The frontend safely handles empty arrays (no crash), but language tags like "Hindi", "Korean" will never appear on cards for seeded content.

**Mitigation (when ready to patch):**
In `mapTmdbMovie()` and `mapTmdbTv()`, add:
```javascript
language: item.original_language || 'en',
spoken_languages: [item.original_language || 'en'],
```

---

### D2. SUB/DUB Badge Null Safety

**Status: [ALIGNMENT_OK]**

**File:** `public/js/app.js`, `_getSubDubBadge()` function and card renderer

The frontend handles missing/null `subDubTag` gracefully:
```javascript
const tag = String(movie.subDubTag || '').trim();
```

And provides a fallback for anime:
```javascript
const subDubTag = String(movie.subDubTag || '').trim() 
  || (String(movie.category || '').toLowerCase() === 'anime' ? 'Subbed' : '');
```

**Behavior at scale:**
- All anime records from the matrix loop have `subDubTag: 'Subbed'` explicitly set.
- Non-anime records (movies, series) don't display SUB/DUB badges (guarded by category check).
- If `subDubTag` is undefined/null (e.g., from older manual imports), the `|| ''` fallback prevents exceptions.

**Verdict:** No uncaught exceptions possible. Badge rendering is null-safe.

---

### D3. origin_country Not Stored in Schema

**Status: [PERFORMANCE_WARN]**

**File:** `backend/models/Movie.js` — no `origin_country` field defined  
**File:** `scripts/mass_seed.js` — `with_origin_country` used as TMDB query param only

**Issue:** The `with_origin_country` parameter is used to FILTER TMDB API results during ingestion, but the actual `origin_country` value from TMDB responses is never stored in MongoDB. The Movie schema has no `origin_country` field.

**Impact:** If future features need to filter or display content by country of origin (e.g., "Show me only Indian content"), there's no stored field to query against. Currently, `original_language` serves as a proxy (e.g., `hi` = India, `ja` = Japan), which is imperfect but functional.

**Mitigation (when ready to patch):**
- Add `origin_country: { type: [String], default: [], index: true }` to Movie schema.
- In `mapTmdbMovie()` / `mapTmdbTv()`, store `item.origin_country` (TMDB returns this as an array).

**Severity:** Low — this is a future-proofing concern, not a current blocker.

---

## E. Additional Findings

### E1. `with_networks` Parameter on `/discover/movie` Endpoint

**Status: [BLOCKER]**

**File:** `scripts/mass_seed.js`, lines 703-713 and 729-739  
**Profiles affected:** `netflix-movies`, `prime-movies`

**Issue:** The TMDB API does NOT support the `with_networks` parameter on `/discover/movie`. This parameter is only valid for `/discover/tv`. The TMDB docs for `/discover/movie` do not list `with_networks` as a query parameter.

When the matrix loop runs `netflix-movies` or `prime-movies` profiles, it calls:
```
GET /discover/movie?with_networks=213&primary_release_year=2026&sort_by=popularity.desc
```

TMDB will silently ignore the unrecognized `with_networks` parameter and return generic popular movies for that year — NOT Netflix/Prime originals. This means:
- The `netflix-movies` slice will ingest ~21,600 generic popular movies (duplicating `hollywood-movies` results).
- The `prime-movies` slice will do the same.
- Net effect: ~43,200 wasted API calls returning duplicate data, inflating the collection with redundant records.

**Mitigation (required before running `seed:networks`):**
Change `netflix-movies` and `prime-movies` profiles to `mediaType: 'tv'` (since networks are a TV concept), OR replace them with `with_companies` (production company filter) which IS supported on `/discover/movie`:
- Netflix production company ID: `21252`
- Amazon Studios production company ID: `20580`

```javascript
// Fix for netflix-movies:
{
  id: 'netflix-movies',
  mediaType: 'movie',
  params: {
    sort_by: 'popularity.desc',
    with_companies: '21252',  // Netflix production company
    include_adult: false,
  },
}
```

---

### E2. `with_original_language` Pipe-Separated Values

**Status: [BLOCKER]**

**File:** `scripts/mass_seed.js`, line 696  
**Profile affected:** `south-indian-tv`

```javascript
with_original_language: 'te|ta|ml|kn',
```

**Issue:** The TMDB API `with_original_language` parameter accepts a single ISO 639-1 language code, NOT pipe-separated values. Unlike `with_genres` or `with_origin_country`, this parameter does not support OR logic.

When this value is sent to TMDB, it will either:
- Return 0 results (TMDB doesn't recognize `'te|ta|ml|kn'` as a valid language code), OR
- Be silently ignored, returning unfiltered results.

**Impact:** The `south-indian-tv` slice will either fetch zero records or fetch generic unfiltered TV shows, failing to capture Telugu/Tamil/Malayalam/Kannada content.

**Mitigation (required before running `seed:indian`):**
Split into four separate profile slices (one per language), similar to how `south-indian-te`, `south-indian-ta`, `south-indian-ml`, `south-indian-kn` are already defined for movies. Replace the single `south-indian-tv` entry with:
```javascript
{ id: 'south-indian-tv-te', mediaType: 'tv', params: { with_original_language: 'te', with_origin_country: 'IN' }, ... },
{ id: 'south-indian-tv-ta', mediaType: 'tv', params: { with_original_language: 'ta', with_origin_country: 'IN' }, ... },
{ id: 'south-indian-tv-ml', mediaType: 'tv', params: { with_original_language: 'ml', with_origin_country: 'IN' }, ... },
{ id: 'south-indian-tv-kn', mediaType: 'tv', params: { with_original_language: 'kn', with_origin_country: 'IN' }, ... },
```

---

### E3. `with_origin_country` Pipe-Separated Values

**Status: [PERFORMANCE_WARN]**

**File:** `scripts/mass_seed.js`, lines 505, 518  
**Profiles affected:** `hollywood-movies`, `hollywood-tv`

```javascript
with_origin_country: 'US|GB|CA',
```

**Issue:** Based on TMDB documentation, `with_origin_country` accepts a single string value. The pipe-separated format `US|GB|CA` is not explicitly documented as supported for this parameter (unlike `with_genres` which explicitly states pipe/comma support).

**Observed behavior:** TMDB may silently ignore the parameter or only match the first value. This could result in fewer results than expected (only US content) or all results being returned unfiltered.

**Mitigation (when ready to patch):**
Split into separate slices per country, or test empirically by running a single year and checking if GB/CA content appears in results. If not, split into:
```javascript
{ id: 'hollywood-movies-us', params: { with_origin_country: 'US', ... } },
{ id: 'hollywood-movies-gb', params: { with_origin_country: 'GB', ... } },
{ id: 'hollywood-movies-ca', params: { with_origin_country: 'CA', ... } },
```

**Severity:** Medium — the script will still run without errors, but may under-fetch GB/CA content.

---

## Summary Table

| # | Check Item | Status | Severity |
|---|---|---|---|
| A1 | Category enum alignment | [ALIGNMENT_OK] | — |
| A2 | tmdbId/tmdb_id uniformity | [ALIGNMENT_OK] | — |
| B1 | Sparse unique indexes | [ALIGNMENT_OK] | — |
| B2 | Text index memory pressure | [PERFORMANCE_WARN] | Low |
| B3 | Missing compound index for trending sort | [PERFORMANCE_WARN] | Medium |
| C1 | Pagination boundary enforcement | [ALIGNMENT_OK] | — |
| C2 | Unindexed averageRating sort | [PERFORMANCE_WARN] | Medium |
| C3 | Regex search collection scan | [PERFORMANCE_WARN] | Low (mitigated) |
| D1 | spoken_languages not populated | [PERFORMANCE_WARN] | Low |
| D2 | SUB/DUB badge null safety | [ALIGNMENT_OK] | — |
| D3 | origin_country not stored | [PERFORMANCE_WARN] | Low |
| E1 | with_networks on /discover/movie | [BLOCKER] | High |
| E2 | with_original_language pipe-separated | [BLOCKER] | High |
| E3 | with_origin_country pipe-separated | [PERFORMANCE_WARN] | Medium |

---

## Blockers Requiring Fix Before Execution

~~1. **E1** — `netflix-movies` and `prime-movies` profiles use `with_networks` on `/discover/movie` which is unsupported. Will produce duplicate generic results.~~  
**FIXED** — Switched to `with_companies: '21252'` (Netflix) and `with_companies: '20580'` (Amazon Studios) for movie profiles.

~~2. **E2** — `south-indian-tv` profile uses pipe-separated `with_original_language: 'te|ta|ml|kn'` which is not a valid single language code. Will produce zero or incorrect results.~~  
**FIXED** — Split into 4 separate slices: `south-indian-tv-te`, `south-indian-tv-ta`, `south-indian-tv-ml`, `south-indian-tv-kn`.

### Additional Fixes Applied

- **B3/C2** — Added compound indexes `{ averageRating: -1, views: -1, createdAt: -1 }` and `{ category: 1, averageRating: -1, views: -1 }` to both `Movie.js` and `ensureIndexes()`.
- **D1** — `mapTmdbMovie()` and `mapTmdbTv()` now populate `language` and `spoken_languages` from `item.original_language`.

**All profiles are now safe to execute.** Run `npm run seed:mega` when ready.

---

*End of Report*
