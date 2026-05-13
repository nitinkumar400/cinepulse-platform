/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CinePulse — Mass Seed Script
 * scripts/mass_seed.js
 *
 * PURPOSE:
 *   Bootstrap the MongoDB database with ~50,000 media records by pulling
 *   from TMDB Discover API (fast) and enriching anime with AniList (slow).
 *
 * ARCHITECTURE:
 *   - Runs LOCALLY as a standalone Node.js process — NOT a Vercel function.
 *   - Connects directly to MongoDB via MONGODB_URI / MONGO_URI from .env
 *   - Uses bulkWrite with upsert:true in batches of 500 for memory safety.
 *   - Clears the in-memory batch array after every write to prevent OOM.
 *
 * RATE LIMITS ENFORCED:
 *   - TMDB:   200ms between every page request  (~5 req/s, well under 40/s)
 *   - AniList: 2500ms between every request     (~24 req/min, under 30/min)
 *
 * TARGETS:
 *   Phase 1 — TMDB Movies:    20,000 records  (1,000 pages × 20 per page)
 *   Phase 2 — TMDB TV Shows:  20,000 records  (1,000 pages × 20 per page)
 *   Phase 3 — TMDB Anime TV:  10,000 records  (500 pages  × 20 per page)
 *   Phase 4 — AniList Enrich: maps anime tmdbIds → anilistId + nextAiring
 *
 * USAGE:
 *   node scripts/mass_seed.js
 *   node scripts/mass_seed.js --phase=1          # only movies
 *   node scripts/mass_seed.js --phase=2          # only TV
 *   node scripts/mass_seed.js --phase=3          # only anime TMDB pull
 *   node scripts/mass_seed.js --phase=4          # only AniList enrichment
 *   node scripts/mass_seed.js --phase=1,2,3,4   # all (default)
 *   node scripts/mass_seed.js --dry-run          # print counts, no DB writes
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

// ── Load .env from project root (one level up from /scripts) ──────────────
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const axios    = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
// CLI FLAGS
// ─────────────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Parse --phase=1,2,3,4  (default: all four phases)
const phaseArg   = args.find(a => a.startsWith('--phase='));
const PHASES_RUN = phaseArg
  ? phaseArg.replace('--phase=', '').split(',').map(Number)
  : [1, 2, 3, 4];

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const TMDB_BASE    = 'https://api.themoviedb.org/3';
const TMDB_IMG_W   = 'https://image.tmdb.org/t/p/w500';   // poster (500px)
const TMDB_IMG_O   = 'https://image.tmdb.org/t/p/original'; // backdrop (full)
const ANILIST_API  = 'https://graphql.anilist.co';

// Delay helpers — enforced between every outbound request
const TMDB_DELAY_MS    = 200;   // 200ms → ~5 req/s (TMDB allows 40/s)
const ANILIST_DELAY_MS = 2500;  // 2.5s  → ~24 req/min (AniList allows 30/min)

// MongoDB bulkWrite batch size — cleared from memory after each flush
const BATCH_SIZE = 500;

// TMDB page limits per phase
const MOVIE_PAGES  = 1000;  // 1000 pages × 20 = 20,000 movies
const TV_PAGES     = 1000;  // 1000 pages × 20 = 20,000 TV shows
const ANIME_PAGES  = 500;   //  500 pages × 20 = 10,000 anime

// AniList pages for enrichment (50 per page × 200 pages = 10,000 anime)
const ANILIST_PAGES    = 200;
const ANILIST_PER_PAGE = 50;

// TMDB genre ID for Animation (used to filter anime)
const TMDB_ANIMATION_GENRE = 16;

// ─────────────────────────────────────────────────────────────────────────────
// TMDB GENRE MAP  (id → human-readable name)
// Matches the map already used in backend/services/tmdbService.js
// ─────────────────────────────────────────────────────────────────────────────
const GENRE_MAP = {
  28: 'Action',    12: 'Adventure',  16: 'Animation', 35: 'Comedy',
  80: 'Crime',     99: 'Documentary',18: 'Drama',      10751: 'Family',
  14: 'Fantasy',   36: 'History',    27: 'Horror',     10402: 'Music',
  9648: 'Mystery', 10749: 'Romance', 878: 'Sci-Fi',    10770: 'TV Movie',
  53: 'Thriller',  10752: 'War',     37: 'Western',    10759: 'Action',
  10762: 'Kids',   10763: 'News',    10764: 'Reality',  10765: 'Sci-Fi',
  10766: 'Soap',   10767: 'Talk',    10768: 'War',
};

// ─────────────────────────────────────────────────────────────────────────────
// TMDB STATUS MAP  (TMDB string → our schema enum)
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_MAP = {
  'Released':          'Completed',
  'Ended':             'Completed',
  'Returning Series':  'Ongoing',
  'In Production':     'Ongoing',
  'In Development':    'Upcoming',
  'Planned':           'Upcoming',
  'Canceled':          'Cancelled',
  'Cancelled':         'Cancelled',
  'Pilot':             'Upcoming',
};

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL COUNTERS  (printed in the final summary)
// ─────────────────────────────────────────────────────────────────────────────
const stats = {
  tmdbMoviesFetched:  0,
  tmdbTvFetched:      0,
  tmdbAnimeFetched:   0,
  anilistEnriched:    0,
  anilistSkipped:     0,
  anilistErrors:      0,
  dbUpserted:         0,
  dbModified:         0,
  dbErrors:           0,
  batchesFlushed:     0,
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: sleep
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: progress logger  (overwrites the same terminal line)
// ─────────────────────────────────────────────────────────────────────────────
function progress(label, current, total, extra = '') {
  const pct  = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar  = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  ${label} [${bar}] ${pct}% (${current}/${total}) ${extra}   `);
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILITY: resolve TMDB API credentials from env
// Supports both TMDB_API_KEY (v3 query param) and TMDB_READ_ACCESS_TOKEN (Bearer)
// ─────────────────────────────────────────────────────────────────────────────
function getTmdbAuth() {
  const apiKey = String(process.env.TMDB_API_KEY || '').trim();
  const bearer = String(process.env.TMDB_READ_ACCESS_TOKEN || '').trim().replace(/^Bearer\s+/i, '');

  if (!apiKey && !bearer) {
    throw new Error(
      'Missing TMDB credentials.\n' +
      'Set TMDB_API_KEY or TMDB_READ_ACCESS_TOKEN in your .env file.\n' +
      'Get a free key at: https://www.themoviedb.org/settings/api'
    );
  }
  return { apiKey, bearer };
}

// ─────────────────────────────────────────────────────────────────────────────
// TMDB REQUEST  — single page fetch with retry on 429 / 5xx
// ─────────────────────────────────────────────────────────────────────────────
async function tmdbGet(endpoint, params = {}, retries = 3) {
  const { apiKey, bearer } = getTmdbAuth();
  const url = new URL(`${TMDB_BASE}${endpoint}`);

  // Attach API key as query param if available; otherwise use Bearer header
  if (apiKey) url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  const headers = { Accept: 'application/json' };
  if (!apiKey && bearer) headers.Authorization = `Bearer ${bearer}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url.toString(), { headers, timeout: 10000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      // 429 Rate-limit: back off and retry
      if (status === 429) {
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '5', 10);
        console.warn(`\n  [TMDB] 429 rate-limit hit. Waiting ${retryAfter}s before retry ${attempt}/${retries}...`);
        await sleep(retryAfter * 1000 + 500);
        continue;
      }

      // 5xx server error: short back-off
      if (status >= 500 && attempt < retries) {
        await sleep(1000 * attempt);
        continue;
      }

      // Non-retryable or exhausted retries
      throw new Error(`TMDB ${endpoint} failed (HTTP ${status || 'network'}): ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANILIST REQUEST  — single GraphQL query with retry on 429
// ─────────────────────────────────────────────────────────────────────────────
async function anilistPost(query, variables = {}, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.post(
        ANILIST_API,
        { query, variables },
        {
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          timeout: 15000,
        }
      );

      // AniList returns errors inside the JSON body even on HTTP 200
      if (res.data?.errors?.length) {
        const msg = res.data.errors[0]?.message || 'AniList query error';
        if (/not found/i.test(msg)) return null; // graceful miss
        throw new Error(msg);
      }

      return res.data?.data || null;
    } catch (err) {
      const status = err.response?.status;

      if (status === 429 && attempt < retries) {
        // AniList 429: mandatory 60s cooldown
        console.warn(`\n  [AniList] 429 rate-limit. Cooling down 65s (attempt ${attempt}/${retries})...`);
        await sleep(65000);
        continue;
      }

      if (attempt < retries) {
        await sleep(3000 * attempt);
        continue;
      }

      // Return null on final failure so the loop can continue
      console.warn(`\n  [AniList] Request failed after ${retries} attempts: ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA MAPPERS
// These functions convert raw TMDB / AniList API responses into the exact
// shape expected by our Movie.js Mongoose schema.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * mapGenreIds — converts an array of TMDB genre IDs to string names.
 * Falls back to an empty array if the input is not an array.
 */
function mapGenreIds(ids = []) {
  if (!Array.isArray(ids)) return [];
  return ids.map(id => GENRE_MAP[id]).filter(Boolean);
}

/**
 * mapTmdbStatus — converts TMDB status string to our schema enum value.
 */
function mapTmdbStatus(tmdbStatus = '') {
  return STATUS_MAP[tmdbStatus] || 'Completed';
}

/**
 * mapTmdbMovie — maps a raw TMDB /discover/movie result to our Movie schema.
 *
 * Only extracts the LIGHTWEIGHT fields we need:
 *   title, tmdbId, category, genre, releaseYear, thumbnailUrl, bannerUrl,
 *   vote_average, averageRating, original_language, status, provider
 *
 * Heavy fields (cast, crew, spoken_languages, trailerUrl) are intentionally
 * omitted to keep the seed fast and memory-efficient.
 *
 * @param {object} item  — raw TMDB movie result object
 * @returns {object}     — MongoDB $set payload
 */
function mapTmdbMovie(item) {
  const tmdbId = Number(item.id);
  const title  = String(item.title || item.name || '').trim();
  if (!title || !tmdbId) return null;

  const year = parseInt(
    String(item.release_date || item.first_air_date || '2024').split('-')[0], 10
  ) || 2024;

  return {
    title,
    description:       String(item.overview || 'No description available.').slice(0, 600),
    category:          'movie',
    provider:          'tmdb',
    tmdbId,
    tmdb_id:           tmdbId,
    genre:             mapGenreIds(item.genre_ids),
    tmdb_genre_ids:    Array.isArray(item.genre_ids) ? item.genre_ids : [],
    releaseYear:       year,
    thumbnailUrl:      item.poster_path   ? `${TMDB_IMG_W}${item.poster_path}`   : '',
    bannerUrl:         item.backdrop_path ? `${TMDB_IMG_O}${item.backdrop_path}` : '',
    vote_average:      Number(item.vote_average || 0),
    averageRating:     Number(item.vote_average || 0),
    original_language: String(item.original_language || '').toLowerCase(),
    status:            'Completed',  // movies are always released at this point
    isFeatured:        false,
    isNewRelease:      year >= new Date().getFullYear() - 1,
    sources:           [],
    subtitles:         [],
  };
}

/**
 * mapTmdbTv — maps a raw TMDB /discover/tv result to our Movie schema.
 * Category is 'series' for all non-anime TV shows.
 *
 * @param {object} item  — raw TMDB TV result object
 * @returns {object}     — MongoDB $set payload
 */
function mapTmdbTv(item) {
  const tmdbId = Number(item.id);
  const title  = String(item.name || item.title || '').trim();
  if (!title || !tmdbId) return null;

  const year = parseInt(
    String(item.first_air_date || item.release_date || '2024').split('-')[0], 10
  ) || 2024;

  return {
    title,
    description:       String(item.overview || 'No description available.').slice(0, 600),
    category:          'series',
    provider:          'tmdb',
    tmdbId,
    tmdb_id:           tmdbId,
    genre:             mapGenreIds(item.genre_ids),
    tmdb_genre_ids:    Array.isArray(item.genre_ids) ? item.genre_ids : [],
    releaseYear:       year,
    thumbnailUrl:      item.poster_path   ? `${TMDB_IMG_W}${item.poster_path}`   : '',
    bannerUrl:         item.backdrop_path ? `${TMDB_IMG_O}${item.backdrop_path}` : '',
    vote_average:      Number(item.vote_average || 0),
    averageRating:     Number(item.vote_average || 0),
    original_language: String(item.original_language || '').toLowerCase(),
    status:            'Ongoing',   // TV shows default to Ongoing
    isFeatured:        false,
    isNewRelease:      year >= new Date().getFullYear() - 1,
    sources:           [],
    subtitles:         [],
  };
}

/**
 * mapTmdbAnime — maps a raw TMDB /discover/tv (ja + genre=16) result.
 * Category is 'anime'. AniList enrichment happens later in Phase 4.
 *
 * @param {object} item  — raw TMDB TV result object
 * @returns {object}     — MongoDB $set payload
 */
function mapTmdbAnime(item) {
  const base = mapTmdbTv(item);
  if (!base) return null;

  return {
    ...base,
    category:    'anime',
    provider:    'tmdb',
    subDubTag:   'Subbed',
    // AniList fields will be filled in Phase 4
    anilistId:   null,
    anilist_id:  null,
    idMal:       null,
  };
}

/**
 * buildFranchiseKey — strips season/year suffixes to group related anime.
 * e.g. "Attack on Titan Season 2" → "attack on titan"
 */
function buildFranchiseKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\bs\d+\b/gi, '')
    .replace(/[:\-–—].*$/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * parseSeasonNumber — extracts season number from title string.
 * e.g. "Naruto Shippuden Season 2" → 2
 */
function parseSeasonNumber(title = '') {
  const match = String(title || '').match(/\bseason\s*(\d+)\b/i)
             || String(title || '').match(/\bs(\d+)\b/i);
  const n = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * mapAnilistEnrichment — converts an AniList Media object into the
 * additional fields we $set on top of an existing anime document.
 *
 * @param {object} media  — AniList Media node
 * @returns {object}      — partial $set payload (only AniList-specific fields)
 */
function mapAnilistEnrichment(media) {
  if (!media) return null;

  const anilistId = Number(media.id);
  if (!anilistId) return null;

  const score = Number(media.averageScore || 0);
  const nextAiringAtSec = Number(media.nextAiringEpisode?.airingAt || 0);
  const titleRomaji = String(media.title?.romaji || media.title?.english || '').trim();

  return {
    anilistId,
    anilist_id:        anilistId,
    idMal:             Number(media.idMal) || null,
    provider:          'anilist',
    category:          'anime',
    subDubTag:         'Subbed',
    anilistScore:      score > 0 ? Number((score / 10).toFixed(1)) : 0,
    averageRating:     score > 0 ? Number((score / 10).toFixed(1)) : 0,
    vote_average:      score > 0 ? Number((score / 10).toFixed(1)) : 0,
    totalEpisodes:     Number(media.episodes || 0),
    duration:          Number(media.duration || 24),
    studio:            media.studios?.nodes?.[0]?.name || '',
    franchiseKey:      buildFranchiseKey(titleRomaji),
    animeSeasonNumber: parseSeasonNumber(titleRomaji),
    status:            media.status === 'RELEASING'         ? 'Ongoing'
                     : media.status === 'NOT_YET_RELEASED'  ? 'Upcoming'
                     : media.status === 'CANCELLED'         ? 'Cancelled'
                     : 'Completed',
    nextAiringEpisode: {
      episode:  Number(media.nextAiringEpisode?.episode || 0),
      airingAt: nextAiringAtSec > 0 ? new Date(nextAiringAtSec * 1000) : null,
    },
    // Override thumbnail/banner with higher-res AniList images if available
    ...(media.coverImage?.extraLarge && { thumbnailUrl: media.coverImage.extraLarge }),
    ...(media.bannerImage            && { bannerUrl:    media.bannerImage }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pruneNullIds — removes tmdbId / anilistId fields from the $set payload
 * when their value is null/0/undefined.
 *
 * WHY: Our Movie schema has { unique: true, sparse: true } indexes on
 * tmdbId, tmdb_id, anilistId, anilist_id.  Writing null to a sparse-unique
 * field causes duplicate-key errors because MongoDB treats null as a real
 * value in a non-sparse context.  By deleting the key from $set entirely
 * and adding it to $unset, we avoid the collision.
 */
function pruneNullIds(payload) {
  const p = { ...payload };
  const idFields = ['tmdbId', 'tmdb_id', 'anilistId', 'anilist_id', 'idMal'];
  const unsetFields = {};

  for (const field of idFields) {
    const val = p[field];
    if (val === null || val === undefined || val === 0 || Number.isNaN(val)) {
      delete p[field];
      unsetFields[field] = '';
    }
  }

  return { setPayload: p, unsetFields };
}

/**
 * buildBulkOp — constructs a single MongoDB bulkWrite updateOne operation
 * with upsert:true for a given mapped record.
 *
 * Filter priority:
 *   1. tmdbId (most reliable unique key for TMDB content)
 *   2. anilistId (for AniList-only records)
 *   3. title (last resort — may cause false matches on common titles)
 */
function buildBulkOp(record) {
  const { setPayload, unsetFields } = pruneNullIds(record);

  // Build the filter — prefer numeric IDs over title
  let filter;
  if (setPayload.tmdbId) {
    filter = { $or: [{ tmdbId: setPayload.tmdbId }, { tmdb_id: setPayload.tmdbId }] };
  } else if (setPayload.anilistId) {
    filter = { $or: [{ anilistId: setPayload.anilistId }, { anilist_id: setPayload.anilistId }] };
  } else {
    filter = { title: setPayload.title };
  }

  const update = { $set: setPayload };
  if (Object.keys(unsetFields).length > 0) {
    update.$unset = unsetFields;
  }

  return {
    updateOne: {
      filter,
      update,
      upsert: true,
    },
  };
}

/**
 * flushBatch — executes a bulkWrite for the current batch, updates global
 * stats, then CLEARS the array in-place to free memory.
 *
 * @param {mongoose.Collection} collection  — raw Mongoose collection handle
 * @param {Array}               batch       — array of bulkWrite operations
 * @param {string}              label       — phase label for logging
 */
async function flushBatch(collection, batch, label = '') {
  if (batch.length === 0) return;

  if (DRY_RUN) {
    console.log(`\n  [DRY-RUN] Would flush ${batch.length} ops (${label})`);
    batch.length = 0; // clear in-place
    return;
  }

  try {
    const result = await collection.bulkWrite(batch, {
      ordered: false,  // continue on individual doc errors
    });

    stats.dbUpserted  += result.upsertedCount  || 0;
    stats.dbModified  += result.modifiedCount  || 0;
    stats.batchesFlushed++;

    // ── CRITICAL: clear the array to release memory ──
    // Do NOT reassign (batch = []) — that only changes the local reference.
    // Splice empties the original array that the caller holds.
    batch.splice(0, batch.length);

  } catch (err) {
    // bulkWrite with ordered:false reports per-op errors in err.writeErrors
    // We log them but do NOT crash — partial success is acceptable for a seed.
    const writeErrors = err.writeErrors?.length || 0;
    stats.dbErrors += writeErrors || 1;

    if (writeErrors > 0) {
      console.warn(`\n  [DB] ${writeErrors} write error(s) in batch (${label}). First: ${err.writeErrors[0]?.errmsg}`);
    } else {
      console.warn(`\n  [DB] bulkWrite error (${label}): ${err.message}`);
    }

    // Still clear the batch so we don't retry the same broken ops
    batch.splice(0, batch.length);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — TMDB MOVIES  (20,000 records)
// Uses /discover/movie sorted by popularity descending.
// Loops through MOVIE_PAGES pages, 20 results per page.
// ─────────────────────────────────────────────────────────────────────────────
async function phase1_tmdbMovies(collection) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(  '║  PHASE 1 — TMDB Movies  (target: 20,000 records)   ║');
  console.log(  '╚══════════════════════════════════════════════════════╝');

  const batch = [];
  let fetched = 0;

  for (let page = 1; page <= MOVIE_PAGES; page++) {
    try {
      const data = await tmdbGet('/discover/movie', {
        sort_by:              'popularity.desc',
        include_adult:        false,
        include_video:        false,
        language:             'en-US',
        page,
      });

      const results = Array.isArray(data?.results) ? data.results : [];

      // TMDB caps at 500 pages (10,000 results) for most endpoints.
      // If we get an empty page, stop early.
      if (results.length === 0) {
        console.log(`\n  [Phase 1] Empty page ${page} — stopping early.`);
        break;
      }

      for (const item of results) {
        const mapped = mapTmdbMovie(item);
        if (!mapped) continue;
        batch.push(buildBulkOp(mapped));
        fetched++;
        stats.tmdbMoviesFetched++;
      }

      // Flush every BATCH_SIZE ops to keep memory low
      if (batch.length >= BATCH_SIZE) {
        await flushBatch(collection, batch, 'Phase1-Movies');
      }

      progress('Movies', page, MOVIE_PAGES, `fetched=${fetched}`);

      // Enforce TMDB rate limit
      await sleep(TMDB_DELAY_MS);

    } catch (err) {
      console.warn(`\n  [Phase 1] Page ${page} error: ${err.message} — skipping.`);
      await sleep(TMDB_DELAY_MS * 3); // extra back-off on error
    }
  }

  // Flush any remaining records in the batch
  if (batch.length > 0) {
    await flushBatch(collection, batch, 'Phase1-Movies-Final');
  }

  console.log(`\n  ✓ Phase 1 complete. Fetched: ${fetched} movies.\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — TMDB TV SHOWS  (20,000 records)
// Uses /discover/tv sorted by popularity descending.
// Excludes Japanese animation (that's Phase 3).
// ─────────────────────────────────────────────────────────────────────────────
async function phase2_tmdbTv(collection) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(  '║  PHASE 2 — TMDB TV Shows  (target: 20,000 records) ║');
  console.log(  '╚══════════════════════════════════════════════════════╝');

  const batch = [];
  let fetched = 0;

  for (let page = 1; page <= TV_PAGES; page++) {
    try {
      const data = await tmdbGet('/discover/tv', {
        sort_by:              'popularity.desc',
        include_adult:        false,
        language:             'en-US',
        // Exclude Japanese animation to avoid overlap with Phase 3
        without_genres:       String(TMDB_ANIMATION_GENRE),
        page,
      });

      const results = Array.isArray(data?.results) ? data.results : [];

      if (results.length === 0) {
        console.log(`\n  [Phase 2] Empty page ${page} — stopping early.`);
        break;
      }

      for (const item of results) {
        const mapped = mapTmdbTv(item);
        if (!mapped) continue;
        batch.push(buildBulkOp(mapped));
        fetched++;
        stats.tmdbTvFetched++;
      }

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(collection, batch, 'Phase2-TV');
      }

      progress('TV Shows', page, TV_PAGES, `fetched=${fetched}`);
      await sleep(TMDB_DELAY_MS);

    } catch (err) {
      console.warn(`\n  [Phase 2] Page ${page} error: ${err.message} — skipping.`);
      await sleep(TMDB_DELAY_MS * 3);
    }
  }

  if (batch.length > 0) {
    await flushBatch(collection, batch, 'Phase2-TV-Final');
  }

  console.log(`\n  ✓ Phase 2 complete. Fetched: ${fetched} TV shows.\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — TMDB ANIME  (10,000 records)
// Uses /discover/tv filtered by:
//   with_original_language=ja  (Japanese originals)
//   with_genres=16             (Animation genre)
// These records are inserted as category:'anime' and will be enriched
// with AniList data in Phase 4.
// ─────────────────────────────────────────────────────────────────────────────
async function phase3_tmdbAnime(collection) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(  '║  PHASE 3 — TMDB Anime  (target: 10,000 records)    ║');
  console.log(  '╚══════════════════════════════════════════════════════╝');

  const batch = [];
  let fetched = 0;

  for (let page = 1; page <= ANIME_PAGES; page++) {
    try {
      const data = await tmdbGet('/discover/tv', {
        sort_by:                'popularity.desc',
        include_adult:          false,
        language:               'en-US',
        with_original_language: 'ja',
        with_genres:            String(TMDB_ANIMATION_GENRE),
        page,
      });

      const results = Array.isArray(data?.results) ? data.results : [];

      if (results.length === 0) {
        console.log(`\n  [Phase 3] Empty page ${page} — stopping early.`);
        break;
      }

      for (const item of results) {
        const mapped = mapTmdbAnime(item);
        if (!mapped) continue;
        batch.push(buildBulkOp(mapped));
        fetched++;
        stats.tmdbAnimeFetched++;
      }

      if (batch.length >= BATCH_SIZE) {
        await flushBatch(collection, batch, 'Phase3-Anime');
      }

      progress('Anime (TMDB)', page, ANIME_PAGES, `fetched=${fetched}`);
      await sleep(TMDB_DELAY_MS);

    } catch (err) {
      console.warn(`\n  [Phase 3] Page ${page} error: ${err.message} — skipping.`);
      await sleep(TMDB_DELAY_MS * 3);
    }
  }

  if (batch.length > 0) {
    await flushBatch(collection, batch, 'Phase3-Anime-Final');
  }

  console.log(`\n  ✓ Phase 3 complete. Fetched: ${fetched} anime (TMDB).\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — ANILIST ENRICHMENT  (sequential, 2.5s between requests)
//
// Strategy:
//   1. Query AniList's Page API sorted by POPULARITY_DESC to get up to
//      ANILIST_PAGES × ANILIST_PER_PAGE = 10,000 anime entries.
//   2. For each AniList Media node, find the matching document in MongoDB
//      by title (fuzzy) or by tmdbId if we can cross-reference.
//   3. $set the AniList-specific fields onto the existing document.
//
// CRITICAL: This phase uses a for...of loop (NOT Promise.all) and enforces
// a 2500ms sleep between every single AniList request to stay under the
// 30 req/min hard limit. Violating this causes IP bans.
// ─────────────────────────────────────────────────────────────────────────────

// AniList GraphQL query — fetches a page of popular anime with all fields
// we need for enrichment. Kept minimal to reduce response payload size.
const ANILIST_POPULAR_QUERY = `
  query ($page: Int!, $perPage: Int!) {
    Page(page: $page, perPage: $perPage) {
      pageInfo { hasNextPage currentPage lastPage }
      media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
        id
        idMal
        title { romaji english native }
        coverImage { extraLarge large }
        bannerImage
        averageScore
        episodes
        duration
        status
        genres
        seasonYear
        studios(isMain: true) { nodes { name } }
        nextAiringEpisode { episode airingAt }
      }
    }
  }
`;

async function phase4_anilistEnrich(collection) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(  '║  PHASE 4 — AniList Enrichment  (2.5s per request)  ║');
  console.log(  '╚══════════════════════════════════════════════════════╝');
  console.log(  '  ⚠  This phase takes ~8 hours for 200 pages. You can');
  console.log(  '     safely Ctrl+C and resume with --phase=4 later.\n');

  const batch = [];
  let enriched = 0;
  let totalPages = ANILIST_PAGES; // will be updated from pageInfo

  // Sequential loop — one request at a time, 2.5s apart
  for (let page = 1; page <= totalPages; page++) {

    // ── Enforce AniList rate limit BEFORE the request ──
    // We sleep first so even the very first request is paced correctly
    // when this phase is run standalone after a previous run.
    if (page > 1) {
      await sleep(ANILIST_DELAY_MS);
    }

    try {
      const data = await anilistPost(ANILIST_POPULAR_QUERY, {
        page,
        perPage: ANILIST_PER_PAGE,
      });

      if (!data?.Page?.media?.length) {
        console.log(`\n  [Phase 4] Empty page ${page} — stopping.`);
        break;
      }

      // Update totalPages from the actual API response
      const pageInfo = data.Page.pageInfo;
      if (pageInfo?.lastPage && pageInfo.lastPage < totalPages) {
        totalPages = pageInfo.lastPage;
      }

      const mediaList = data.Page.media;

      for (const media of mediaList) {
        const enrichFields = mapAnilistEnrichment(media);
        if (!enrichFields) {
          stats.anilistSkipped++;
          continue;
        }

        // Build the title variants to search for in MongoDB
        const titleRomaji  = String(media.title?.romaji  || '').trim();
        const titleEnglish = String(media.title?.english || '').trim();
        const titleNative  = String(media.title?.native  || '').trim();

        // Try to find an existing document by title (case-insensitive)
        // We search for any of the three title variants.
        const titleFilter = {
          $or: [
            ...(titleRomaji  ? [{ title: { $regex: `^${titleRomaji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,  $options: 'i' } }] : []),
            ...(titleEnglish ? [{ title: { $regex: `^${titleEnglish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }] : []),
          ],
        };

        // Build the $set payload — merge enrichment fields
        const { setPayload, unsetFields } = pruneNullIds(enrichFields);

        const update = { $set: setPayload };
        if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

        // Use anilistId as the primary filter for upsert
        const filter = { $or: [
          { anilistId:  enrichFields.anilistId },
          { anilist_id: enrichFields.anilistId },
          // Also match by title so we enrich records seeded in Phase 3
          ...(titleFilter.$or || []),
        ]};

        batch.push({
          updateOne: {
            filter,
            update,
            upsert: true,  // create a new doc if no title match found
          },
        });

        enriched++;
        stats.anilistEnriched++;
      }

      // Flush batch every BATCH_SIZE ops
      if (batch.length >= BATCH_SIZE) {
        await flushBatch(collection, batch, 'Phase4-AniList');
      }

      progress('AniList Enrich', page, totalPages,
        `enriched=${enriched} | next in ${ANILIST_DELAY_MS}ms`);

    } catch (err) {
      stats.anilistErrors++;
      console.warn(`\n  [Phase 4] Page ${page} error: ${err.message} — skipping page.`);
      // Extra back-off on unexpected errors
      await sleep(ANILIST_DELAY_MS * 2);
    }
  }

  // Final flush
  if (batch.length > 0) {
    await flushBatch(collection, batch, 'Phase4-AniList-Final');
  }

  console.log(`\n  ✓ Phase 4 complete.`);
  console.log(`    Enriched: ${enriched} | Skipped: ${stats.anilistSkipped} | Errors: ${stats.anilistErrors}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ENTRY POINT
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startTime = Date.now();

  // ── Banner ──
  console.log('\n');
  console.log('  ██████╗██╗███╗   ██╗███████╗██████╗ ██╗   ██╗██╗     ███████╗███████╗');
  console.log('  ██╔════╝██║████╗  ██║██╔════╝██╔══██╗██║   ██║██║     ██╔════╝██╔════╝');
  console.log('  ██║     ██║██╔██╗ ██║█████╗  ██████╔╝██║   ██║██║     ███████╗█████╗  ');
  console.log('  ██║     ██║██║╚██╗██║██╔══╝  ██╔═══╝ ██║   ██║██║     ╚════██║██╔══╝  ');
  console.log('  ╚██████╗██║██║ ╚████║███████╗██║     ╚██████╔╝███████╗███████║███████╗');
  console.log('   ╚═════╝╚═╝╚═╝  ╚═══╝╚══════╝╚═╝      ╚═════╝ ╚══════╝╚══════╝╚══════╝');
  console.log('\n  CinePulse — Mass Seed Script  v1.0');
  console.log(`  Target: ~50,000 records | Phases: ${PHASES_RUN.join(', ')}${DRY_RUN ? ' | DRY-RUN MODE' : ''}`);
  console.log('─'.repeat(70));

  // ── Validate environment ──
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('\n  ✗ ERROR: MONGODB_URI (or MONGO_URI) is not set in your .env file.');
    console.error('  Add it and re-run: node scripts/mass_seed.js\n');
    process.exit(1);
  }

  // Validate TMDB credentials early so we fail fast before any DB connection
  try {
    getTmdbAuth();
  } catch (err) {
    console.error(`\n  ✗ ERROR: ${err.message}\n`);
    process.exit(1);
  }

  // ── Connect to MongoDB ──
  console.log('\n  Connecting to MongoDB...');
  try {
    await mongoose.connect(mongoUri, {
      // Connection pool tuned for a long-running local script
      maxPoolSize:            5,
      minPoolSize:            1,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS:          60000,
      connectTimeoutMS:         15000,
    });
    console.log(`  ✓ Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error(`\n  ✗ MongoDB connection failed: ${err.message}`);
    console.error('  Check your MONGODB_URI and ensure the cluster is reachable.\n');
    process.exit(1);
  }

  // ── Get raw collection handle (bypasses Mongoose middleware for speed) ──
  // We use the native driver's bulkWrite directly for maximum throughput.
  // The schema's pre-save hooks (isNewRelease, tmdb_id sync) are NOT run,
  // but we replicate their logic manually in our mappers above.
  const collection = mongoose.connection.collection('movies');

  // ── Ensure indexes exist before bulk-inserting ──
  // This is idempotent — safe to run even if indexes already exist.
  if (!DRY_RUN) {
    console.log('  Ensuring indexes...');
    try {
      await collection.createIndex({ tmdbId:    1 }, { unique: true, sparse: true, background: true });
      await collection.createIndex({ tmdb_id:   1 }, { unique: true, sparse: true, background: true });
      await collection.createIndex({ anilistId:  1 }, { sparse: true, background: true });
      await collection.createIndex({ anilist_id: 1 }, { sparse: true, background: true });
      await collection.createIndex({ category:   1 }, { background: true });
      await collection.createIndex({ title:      1 }, { background: true });
      await collection.createIndex({ views:     -1 }, { background: true });
      await collection.createIndex({ title: 'text', description: 'text' }, { background: true });
      console.log('  ✓ Indexes ready.');
    } catch (err) {
      // Non-fatal — indexes may already exist
      console.warn(`  ⚠ Index creation warning: ${err.message}`);
    }
  }

  // ── Run phases ──
  if (PHASES_RUN.includes(1)) await phase1_tmdbMovies(collection);
  if (PHASES_RUN.includes(2)) await phase2_tmdbTv(collection);
  if (PHASES_RUN.includes(3)) await phase3_tmdbAnime(collection);
  if (PHASES_RUN.includes(4)) await phase4_anilistEnrich(collection);

  // ── Final summary ──
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log('\n' + '═'.repeat(70));
  console.log('  SEED COMPLETE');
  console.log('═'.repeat(70));
  console.log(`  Time elapsed:          ${hh}:${mm}:${ss}`);
  console.log(`  TMDB Movies fetched:   ${stats.tmdbMoviesFetched.toLocaleString()}`);
  console.log(`  TMDB TV fetched:       ${stats.tmdbTvFetched.toLocaleString()}`);
  console.log(`  TMDB Anime fetched:    ${stats.tmdbAnimeFetched.toLocaleString()}`);
  console.log(`  AniList enriched:      ${stats.anilistEnriched.toLocaleString()}`);
  console.log(`  AniList skipped:       ${stats.anilistSkipped.toLocaleString()}`);
  console.log(`  AniList errors:        ${stats.anilistErrors.toLocaleString()}`);
  console.log('─'.repeat(70));
  console.log(`  DB upserted (new):     ${stats.dbUpserted.toLocaleString()}`);
  console.log(`  DB modified (updated): ${stats.dbModified.toLocaleString()}`);
  console.log(`  DB write errors:       ${stats.dbErrors.toLocaleString()}`);
  console.log(`  Batches flushed:       ${stats.batchesFlushed.toLocaleString()}`);
  console.log('═'.repeat(70) + '\n');

  await mongoose.disconnect();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN  — Ctrl+C saves progress and closes the DB connection
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n\n  ⚠  Interrupted by user (Ctrl+C). Closing MongoDB connection...');
  console.log(`  Progress so far — Movies: ${stats.tmdbMoviesFetched} | TV: ${stats.tmdbTvFetched} | Anime: ${stats.tmdbAnimeFetched} | AniList: ${stats.anilistEnriched}`);
  console.log(`  DB writes — Upserted: ${stats.dbUpserted} | Modified: ${stats.dbModified} | Errors: ${stats.dbErrors}`);
  try {
    await mongoose.disconnect();
  } catch (_) {}
  console.log('  Connection closed. Re-run with --phase=N to resume from a specific phase.\n');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n  ✗ Unhandled rejection:', reason);
  // Don't exit — let the main loop handle it
});

// ── Kick off ──
main().catch(err => {
  console.error('\n  ✗ Fatal error:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
