/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CinePulse — Mass Seed Script  v2.0  (100,000-record Multi-Dimensional Matrix)
 * scripts/mass_seed.js
 *
 * ARCHITECTURE:
 *   Two operational modes controlled by --mode flag:
 *
 *   --mode=phase  (legacy)
 *     Original 4-phase pipeline (movies, TV, anime, AniList enrich).
 *     Target: ~50,000 records.
 *
 *   --mode=matrix  (new)
 *     Multi-Dimensional Matrix Loop.
 *     Sweeps a Target Profile through release years 2026→2000,
 *     fetching pages 1-40 per year (800 titles/year × 27 years = ~21,600
 *     per profile slice). Multiple profiles combine to 100,000+ records.
 *     Bypasses TMDB's hard 500-page / 10,000-result cap per query.
 *
 * MATRIX PROFILES  (--profile=<name>):
 *   hollywood     English-language movies & TV (US/GB/CA)
 *   anime         Japanese Anime + Chinese Donghua
 *   asian-drama   C-Dramas + Thai Lakorns
 *   indian        Bollywood (hi) + South Indian (te/ta/ml/kn)
 *   networks      Netflix Originals (213) + Amazon Prime (1024)
 *
 * CLI SHORTCUTS (package.json):
 *   npm run seed:hollywood
 *   npm run seed:anime-global
 *   npm run seed:asian-drama
 *   npm run seed:indian
 *   npm run seed:networks
 *   npm run seed:mega          ← runs all profiles sequentially
 *
 * SAFETY GUARANTEES:
 *   - 200ms delay between every TMDB request
 *   - bulkWrite in batches of 500 (memory-safe)
 *   - pruneNullIds() prevents null collision on sparse unique indexes
 *   - ordered:false bulkWrite — partial success is acceptable
 *   - Ctrl+C safe — all committed batches are preserved
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const axios    = require('axios');

// ─────────────────────────────────────────────────────────────────────────────
// CLI FLAGS
// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

const DRY_RUN = args.includes('--dry-run');

// --mode=phase | --mode=matrix  (default: phase for backward compat)
const modeArg = args.find(a => a.startsWith('--mode='));
const MODE    = modeArg ? modeArg.replace('--mode=', '').toLowerCase() : 'phase';

// --phase=1,2,3,4  (legacy mode)
const phaseArg   = args.find(a => a.startsWith('--phase='));
const PHASES_RUN = phaseArg
  ? phaseArg.replace('--phase=', '').split(',').map(Number)
  : [1, 2, 3, 4];

// --profile=hollywood|anime|asian-drama|indian|networks  (matrix mode)
const profileArg     = args.find(a => a.startsWith('--profile='));
const PROFILE_TARGET = profileArg ? profileArg.replace('--profile=', '').toLowerCase() : null;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const TMDB_IMG_W  = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_O  = 'https://image.tmdb.org/t/p/original';
const ANILIST_API = 'https://graphql.anilist.co';

const TMDB_DELAY_MS    = 200;   // 200ms → ~5 req/s (TMDB allows 40/s)
const ANILIST_DELAY_MS = 2500;  // 2.5s  → ~24 req/min

const BATCH_SIZE = 500;         // bulkWrite batch size

// Legacy phase page limits
const MOVIE_PAGES  = 1000;
const TV_PAGES     = 1000;
const ANIME_PAGES  = 500;

// AniList enrichment
const ANILIST_PAGES    = 200;
const ANILIST_PER_PAGE = 50;

const TMDB_ANIMATION_GENRE = 16;

// Matrix loop settings
const MATRIX_START_YEAR  = 2026;
const MATRIX_END_YEAR    = 2000;
const MATRIX_PAGES_PER_YEAR = 40;  // 40 pages × 20 results = 800 titles/year

// ─────────────────────────────────────────────────────────────────────────────
// GENRE MAP
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

const STATUS_MAP = {
  'Released':         'Completed',
  'Ended':            'Completed',
  'Returning Series': 'Ongoing',
  'In Production':    'Ongoing',
  'In Development':   'Upcoming',
  'Planned':          'Upcoming',
  'Canceled':         'Cancelled',
  'Cancelled':        'Cancelled',
  'Pilot':            'Upcoming',
};

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL COUNTERS
// ─────────────────────────────────────────────────────────────────────────────
const stats = {
  tmdbMoviesFetched:  0,
  tmdbTvFetched:      0,
  tmdbAnimeFetched:   0,
  matrixFetched:      0,
  anilistEnriched:    0,
  anilistSkipped:     0,
  anilistErrors:      0,
  dbUpserted:         0,
  dbModified:         0,
  dbErrors:           0,
  batchesFlushed:     0,
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function progress(label, current, total, extra = '') {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
  process.stdout.write(`\r  ${label} [${bar}] ${pct}% (${current}/${total}) ${extra}   `);
}

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

  if (apiKey) url.searchParams.set('api_key', apiKey);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  const headers = { Accept: 'application/json' };
  if (!apiKey && bearer) headers.Authorization = `Bearer ${bearer}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(url.toString(), { headers, timeout: 12000 });
      return res.data;
    } catch (err) {
      const status = err.response?.status;

      if (status === 429) {
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '5', 10);
        console.warn(`\n  [TMDB] 429 rate-limit. Waiting ${retryAfter}s (attempt ${attempt}/${retries})...`);
        await sleep(retryAfter * 1000 + 500);
        continue;
      }

      if (status >= 500 && attempt < retries) {
        await sleep(1000 * attempt);
        continue;
      }

      throw new Error(`TMDB ${endpoint} failed (HTTP ${status || 'network'}): ${err.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANILIST REQUEST
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

      if (res.data?.errors?.length) {
        const msg = res.data.errors[0]?.message || 'AniList query error';
        if (/not found/i.test(msg)) return null;
        throw new Error(msg);
      }

      return res.data?.data || null;
    } catch (err) {
      const status = err.response?.status;

      if (status === 429 && attempt < retries) {
        console.warn(`\n  [AniList] 429 rate-limit. Cooling down 65s (attempt ${attempt}/${retries})...`);
        await sleep(65000);
        continue;
      }

      if (attempt < retries) {
        await sleep(3000 * attempt);
        continue;
      }

      console.warn(`\n  [AniList] Request failed after ${retries} attempts: ${err.message}`);
      return null;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA MAPPERS
// ─────────────────────────────────────────────────────────────────────────────
function mapGenreIds(ids = []) {
  if (!Array.isArray(ids)) return [];
  return ids.map(id => GENRE_MAP[id]).filter(Boolean);
}

function mapTmdbStatus(tmdbStatus = '') {
  return STATUS_MAP[tmdbStatus] || 'Completed';
}

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
    language:          String(item.original_language || 'en').toLowerCase(),
    spoken_languages:  [String(item.original_language || 'en').toLowerCase()],
    status:            'Completed',
    isFeatured:        false,
    isNewRelease:      year >= new Date().getFullYear() - 1,
    sources:           [],
    subtitles:         [],
  };
}

function mapTmdbTv(item, overrideCategory = 'series') {
  const tmdbId = Number(item.id);
  const title  = String(item.name || item.title || '').trim();
  if (!title || !tmdbId) return null;

  const year = parseInt(
    String(item.first_air_date || item.release_date || '2024').split('-')[0], 10
  ) || 2024;

  return {
    title,
    description:       String(item.overview || 'No description available.').slice(0, 600),
    category:          overrideCategory,
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
    language:          String(item.original_language || 'en').toLowerCase(),
    spoken_languages:  [String(item.original_language || 'en').toLowerCase()],
    status:            'Ongoing',
    isFeatured:        false,
    isNewRelease:      year >= new Date().getFullYear() - 1,
    sources:           [],
    subtitles:         [],
  };
}

function mapTmdbAnime(item) {
  const base = mapTmdbTv(item, 'anime');
  if (!base) return null;
  return {
    ...base,
    category:   'anime',
    provider:   'tmdb',
    subDubTag:  'Subbed',
    anilistId:  null,
    anilist_id: null,
    idMal:      null,
  };
}

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

function parseSeasonNumber(title = '') {
  const match = String(title || '').match(/\bseason\s*(\d+)\b/i)
             || String(title || '').match(/\bs(\d+)\b/i);
  const n = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(n) && n > 0 ? n : 1;
}

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
    status:            media.status === 'RELEASING'        ? 'Ongoing'
                     : media.status === 'NOT_YET_RELEASED' ? 'Upcoming'
                     : media.status === 'CANCELLED'        ? 'Cancelled'
                     : 'Completed',
    nextAiringEpisode: {
      episode:  Number(media.nextAiringEpisode?.episode || 0),
      airingAt: nextAiringAtSec > 0 ? new Date(nextAiringAtSec * 1000) : null,
    },
    ...(media.coverImage?.extraLarge && { thumbnailUrl: media.coverImage.extraLarge }),
    ...(media.bannerImage            && { bannerUrl:    media.bannerImage }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MONGODB HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pruneNullIds — removes null/0/undefined ID fields from $set payload
 * and moves them to $unset to avoid sparse-unique index collisions.
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
 * buildBulkOp — constructs a single MongoDB bulkWrite updateOne/upsert op.
 */
function buildBulkOp(record) {
  const { setPayload, unsetFields } = pruneNullIds(record);

  let filter;
  if (setPayload.tmdbId) {
    filter = { $or: [{ tmdbId: setPayload.tmdbId }, { tmdb_id: setPayload.tmdbId }] };
  } else if (setPayload.anilistId) {
    filter = { $or: [{ anilistId: setPayload.anilistId }, { anilist_id: setPayload.anilistId }] };
  } else {
    filter = { title: setPayload.title };
  }

  const update = { $set: setPayload };
  if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

  return { updateOne: { filter, update, upsert: true } };
}

/**
 * flushBatch — executes bulkWrite, updates stats, clears batch in-place.
 */
async function flushBatch(collection, batch, label = '') {
  if (batch.length === 0) return;

  if (DRY_RUN) {
    console.log(`\n  [DRY-RUN] Would flush ${batch.length} ops (${label})`);
    batch.splice(0, batch.length);
    return;
  }

  try {
    const result = await collection.bulkWrite(batch, { ordered: false });
    stats.dbUpserted  += result.upsertedCount  || 0;
    stats.dbModified  += result.modifiedCount  || 0;
    stats.batchesFlushed++;
    batch.splice(0, batch.length);
  } catch (err) {
    const writeErrors = err.writeErrors?.length || 0;
    stats.dbErrors += writeErrors || 1;

    if (writeErrors > 0) {
      console.warn(`\n  [DB] ${writeErrors} write error(s) in batch (${label}). First: ${err.writeErrors[0]?.errmsg}`);
    } else {
      console.warn(`\n  [DB] bulkWrite error (${label}): ${err.message}`);
    }

    batch.splice(0, batch.length);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ████████████████████████████████████████████████████████████████████████████
//  MATRIX MODE — MULTI-DIMENSIONAL LOOP ENGINE
// ████████████████████████████████████████████████████████████████████████████
//
// Strategy to bypass TMDB's 500-page / 10,000-result hard cap:
//   For each profile slice, loop years 2026 → 2000.
//   Per year, fetch pages 1-40 (800 results max).
//   27 years × 800 = 21,600 unique results per profile slice.
//   Multiple slices per profile → 100,000+ total records.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MATRIX_PROFILES — configuration matrix for all niche target profiles.
 *
 * Each entry describes:
 *   id          — unique identifier
 *   label       — human-readable name for logging
 *   mediaType   — 'movie' | 'tv'
 *   category    — our schema category value
 *   params      — TMDB /discover query params (merged with year + page)
 *   yearParam   — TMDB year filter key for this media type
 */
const MATRIX_PROFILES = [

  // ── HOLLYWOOD / WESTERN MAINSTREAM ──────────────────────────────────────
  {
    id: 'hollywood-movies',
    label: 'Hollywood Movies (EN/US/GB/CA)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'en',
      with_origin_country:    'US|GB|CA',
      include_adult:          false,
      include_video:          false,
    },
  },
  {
    id: 'hollywood-tv',
    label: 'Hollywood TV (EN/US/GB/CA)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'en',
      with_origin_country:    'US|GB|CA',
      include_adult:          false,
    },
  },

  // ── JAPANESE ANIME ───────────────────────────────────────────────────────
  {
    id: 'anime-japanese',
    label: 'Japanese Anime (JA + Animation)',
    mediaType: 'tv',
    category: 'anime',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'ja',
      with_genres:            '16',
      include_adult:          false,
    },
  },
  {
    id: 'anime-japanese-movies',
    label: 'Japanese Anime Movies',
    mediaType: 'movie',
    category: 'anime',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'ja',
      with_genres:            '16',
      include_adult:          false,
    },
  },

  // ── CHINESE DONGHUA (Chinese Anime) ─────────────────────────────────────
  {
    id: 'donghua-zh',
    label: 'Chinese Donghua (ZH + Animation)',
    mediaType: 'tv',
    category: 'anime',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'zh',
      with_genres:            '16',
      include_adult:          false,
    },
  },
  {
    id: 'donghua-cn',
    label: 'Chinese Donghua (CN + Animation)',
    mediaType: 'tv',
    category: 'anime',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'cn',
      with_genres:            '16',
      include_adult:          false,
    },
  },

  // ── CHINESE DRAMAS (C-Dramas) ────────────────────────────────────────────
  {
    id: 'cdrama-zh',
    label: 'C-Dramas (ZH, no Animation)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'zh',
      without_genres:         '16',
      include_adult:          false,
    },
  },
  {
    id: 'cdrama-cn',
    label: 'C-Dramas (CN, no Animation)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'cn',
      without_genres:         '16',
      include_adult:          false,
    },
  },

  // ── THAI DRAMAS (Lakorns) ────────────────────────────────────────────────
  {
    id: 'thai-drama',
    label: 'Thai Dramas (TH)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'th',
      include_adult:          false,
    },
  },

  // ── BOLLYWOOD (Hindi Cinema) ─────────────────────────────────────────────
  {
    id: 'bollywood-movies',
    label: 'Bollywood Movies (HI/IN)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'hi',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'bollywood-tv',
    label: 'Bollywood TV (HI/IN)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'hi',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },

  // ── SOUTH INDIAN CINEMA ──────────────────────────────────────────────────
  {
    id: 'south-indian-te',
    label: 'Telugu Cinema (TE/IN)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'te',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-ta',
    label: 'Tamil Cinema (TA/IN)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'ta',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-ml',
    label: 'Malayalam Cinema (ML/IN)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'ml',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-kn',
    label: 'Kannada Cinema (KN/IN)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'kn',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-tv-te',
    label: 'Telugu TV (TE/IN)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'te',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-tv-ta',
    label: 'Tamil TV (TA/IN)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'ta',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-tv-ml',
    label: 'Malayalam TV (ML/IN)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'ml',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },
  {
    id: 'south-indian-tv-kn',
    label: 'Kannada TV (KN/IN)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:                'popularity.desc',
      with_original_language: 'kn',
      with_origin_country:    'IN',
      include_adult:          false,
    },
  },

  // ── NETFLIX ORIGINALS ────────────────────────────────────────────────────
  // NOTE: with_networks is TV-only on TMDB. For movies, use with_companies.
  // Netflix production company ID = 21252
  {
    id: 'netflix-movies',
    label: 'Netflix Original Movies (Company 21252)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:        'popularity.desc',
      with_companies: '21252',
      include_adult:  false,
      include_video:  false,
    },
  },
  {
    id: 'netflix-tv',
    label: 'Netflix Original TV (Network 213)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:       'popularity.desc',
      with_networks: '213',
      include_adult: false,
    },
  },

  // ── AMAZON PRIME ORIGINALS ───────────────────────────────────────────────
  // Amazon Studios production company ID = 20580
  {
    id: 'prime-movies',
    label: 'Amazon Prime Movies (Company 20580)',
    mediaType: 'movie',
    category: 'movie',
    params: {
      sort_by:        'popularity.desc',
      with_companies: '20580',
      include_adult:  false,
      include_video:  false,
    },
  },
  {
    id: 'prime-tv',
    label: 'Amazon Prime TV (Network 1024)',
    mediaType: 'tv',
    category: 'series',
    params: {
      sort_by:       'popularity.desc',
      with_networks: '1024',
      include_adult: false,
    },
  },
];

/**
 * PROFILE_GROUPS — maps CLI --profile= names to arrays of MATRIX_PROFILES ids.
 */
const PROFILE_GROUPS = {
  'hollywood':    ['hollywood-movies', 'hollywood-tv'],
  'anime':        ['anime-japanese', 'anime-japanese-movies', 'donghua-zh', 'donghua-cn'],
  'asian-drama':  ['cdrama-zh', 'cdrama-cn', 'thai-drama'],
  'indian':       ['bollywood-movies', 'bollywood-tv', 'south-indian-te', 'south-indian-ta', 'south-indian-ml', 'south-indian-kn', 'south-indian-tv-te', 'south-indian-tv-ta', 'south-indian-tv-ml', 'south-indian-tv-kn'],
  'networks':     ['netflix-movies', 'netflix-tv', 'prime-movies', 'prime-tv'],
  'all':          MATRIX_PROFILES.map(p => p.id),
};

// ─────────────────────────────────────────────────────────────────────────────
// MATRIX LOOP ENGINE
// Sweeps a single profile slice through years 2026 → 2000,
// fetching up to MATRIX_PAGES_PER_YEAR pages per year.
// ─────────────────────────────────────────────────────────────────────────────
async function runMatrixSlice(collection, profileDef) {
  const { id, label, mediaType, category, params } = profileDef;
  const endpoint = mediaType === 'movie' ? '/discover/movie' : '/discover/tv';

  // Year param key differs between movie and TV
  const yearKey = mediaType === 'movie' ? 'primary_release_year' : 'first_air_date_year';

  console.log(`\n  ┌─ Slice: ${label}`);
  console.log(`  │  Endpoint: ${endpoint} | Category: ${category}`);
  console.log(`  │  Years: ${MATRIX_START_YEAR} → ${MATRIX_END_YEAR} | Pages/year: ${MATRIX_PAGES_PER_YEAR}`);

  const batch = [];
  let sliceFetched = 0;
  let totalYears = MATRIX_START_YEAR - MATRIX_END_YEAR + 1;
  let yearsProcessed = 0;

  for (let year = MATRIX_START_YEAR; year >= MATRIX_END_YEAR; year--) {
    yearsProcessed++;

    for (let page = 1; page <= MATRIX_PAGES_PER_YEAR; page++) {
      try {
        const queryParams = {
          ...params,
          [yearKey]: year,
          page,
          language: 'en-US',
        };

        const data = await tmdbGet(endpoint, queryParams);
        const results = Array.isArray(data?.results) ? data.results : [];

        // Break inner loop early if no results or page exceeds total_pages
        if (results.length === 0 || page > (data?.total_pages || 1)) {
          break;
        }

        for (const item of results) {
          let mapped = null;

          if (mediaType === 'movie') {
            mapped = mapTmdbMovie(item);
            if (mapped) mapped.category = category; // override for anime movies
          } else {
            if (category === 'anime') {
              mapped = mapTmdbAnime(item);
            } else {
              mapped = mapTmdbTv(item, category);
            }
          }

          if (!mapped) continue;

          batch.push(buildBulkOp(mapped));
          sliceFetched++;
          stats.matrixFetched++;
        }

        // Flush every BATCH_SIZE ops
        if (batch.length >= BATCH_SIZE) {
          await flushBatch(collection, batch, `Matrix-${id}`);
        }

        progress(
          `${label.slice(0, 28).padEnd(28)}`,
          yearsProcessed,
          totalYears,
          `yr=${year} pg=${page} fetched=${sliceFetched}`
        );

        // Enforce TMDB rate limit
        await sleep(TMDB_DELAY_MS);

      } catch (err) {
        console.warn(`\n  [Matrix:${id}] yr=${year} pg=${page} error: ${err.message} — skipping.`);
        await sleep(TMDB_DELAY_MS * 3);
        break; // skip remaining pages for this year on error
      }
    }
  }

  // Final flush for this slice
  if (batch.length > 0) {
    await flushBatch(collection, batch, `Matrix-${id}-Final`);
  }

  console.log(`\n  └─ ✓ Slice complete: ${label} | Fetched: ${sliceFetched.toLocaleString()}\n`);
  return sliceFetched;
}

/**
 * runMatrixProfile — resolves a profile group name to its slices and runs them.
 */
async function runMatrixProfile(collection, profileName) {
  const profileIds = PROFILE_GROUPS[profileName];
  if (!profileIds) {
    console.error(`\n  ✗ Unknown profile: "${profileName}"`);
    console.error(`  Available profiles: ${Object.keys(PROFILE_GROUPS).join(', ')}\n`);
    process.exit(1);
  }

  const slices = MATRIX_PROFILES.filter(p => profileIds.includes(p.id));

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log(`║  MATRIX MODE — Profile: ${profileName.toUpperCase().padEnd(40)}║`);
  console.log(`║  Slices: ${String(slices.length).padEnd(56)}║`);
  console.log(`║  Years: ${MATRIX_START_YEAR}→${MATRIX_END_YEAR} | Pages/year: ${MATRIX_PAGES_PER_YEAR} | Max/slice: ~${((MATRIX_START_YEAR - MATRIX_END_YEAR + 1) * MATRIX_PAGES_PER_YEAR * 20).toLocaleString()}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  let totalFetched = 0;
  for (let i = 0; i < slices.length; i++) {
    console.log(`\n  [${i + 1}/${slices.length}] Starting slice: ${slices[i].label}`);
    const count = await runMatrixSlice(collection, slices[i]);
    totalFetched += count;
  }

  console.log(`\n  ✓ Profile "${profileName}" complete. Total fetched: ${totalFetched.toLocaleString()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY PHASE FUNCTIONS (unchanged from v1.0)
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
        sort_by:       'popularity.desc',
        include_adult: false,
        include_video: false,
        language:      'en-US',
        page,
      });

      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length === 0) { console.log(`\n  [Phase 1] Empty page ${page} — stopping early.`); break; }

      for (const item of results) {
        const mapped = mapTmdbMovie(item);
        if (!mapped) continue;
        batch.push(buildBulkOp(mapped));
        fetched++;
        stats.tmdbMoviesFetched++;
      }

      if (batch.length >= BATCH_SIZE) await flushBatch(collection, batch, 'Phase1-Movies');
      progress('Movies', page, MOVIE_PAGES, `fetched=${fetched}`);
      await sleep(TMDB_DELAY_MS);
    } catch (err) {
      console.warn(`\n  [Phase 1] Page ${page} error: ${err.message} — skipping.`);
      await sleep(TMDB_DELAY_MS * 3);
    }
  }

  if (batch.length > 0) await flushBatch(collection, batch, 'Phase1-Movies-Final');
  console.log(`\n  ✓ Phase 1 complete. Fetched: ${fetched} movies.\n`);
}

async function phase2_tmdbTv(collection) {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log(  '║  PHASE 2 — TMDB TV Shows  (target: 20,000 records) ║');
  console.log(  '╚══════════════════════════════════════════════════════╝');

  const batch = [];
  let fetched = 0;

  for (let page = 1; page <= TV_PAGES; page++) {
    try {
      const data = await tmdbGet('/discover/tv', {
        sort_by:        'popularity.desc',
        include_adult:  false,
        language:       'en-US',
        without_genres: String(TMDB_ANIMATION_GENRE),
        page,
      });

      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length === 0) { console.log(`\n  [Phase 2] Empty page ${page} — stopping early.`); break; }

      for (const item of results) {
        const mapped = mapTmdbTv(item, 'series');
        if (!mapped) continue;
        batch.push(buildBulkOp(mapped));
        fetched++;
        stats.tmdbTvFetched++;
      }

      if (batch.length >= BATCH_SIZE) await flushBatch(collection, batch, 'Phase2-TV');
      progress('TV Shows', page, TV_PAGES, `fetched=${fetched}`);
      await sleep(TMDB_DELAY_MS);
    } catch (err) {
      console.warn(`\n  [Phase 2] Page ${page} error: ${err.message} — skipping.`);
      await sleep(TMDB_DELAY_MS * 3);
    }
  }

  if (batch.length > 0) await flushBatch(collection, batch, 'Phase2-TV-Final');
  console.log(`\n  ✓ Phase 2 complete. Fetched: ${fetched} TV shows.\n`);
}

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
      if (results.length === 0) { console.log(`\n  [Phase 3] Empty page ${page} — stopping early.`); break; }

      for (const item of results) {
        const mapped = mapTmdbAnime(item);
        if (!mapped) continue;
        batch.push(buildBulkOp(mapped));
        fetched++;
        stats.tmdbAnimeFetched++;
      }

      if (batch.length >= BATCH_SIZE) await flushBatch(collection, batch, 'Phase3-Anime');
      progress('Anime (TMDB)', page, ANIME_PAGES, `fetched=${fetched}`);
      await sleep(TMDB_DELAY_MS);
    } catch (err) {
      console.warn(`\n  [Phase 3] Page ${page} error: ${err.message} — skipping.`);
      await sleep(TMDB_DELAY_MS * 3);
    }
  }

  if (batch.length > 0) await flushBatch(collection, batch, 'Phase3-Anime-Final');
  console.log(`\n  ✓ Phase 3 complete. Fetched: ${fetched} anime (TMDB).\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — ANILIST ENRICHMENT
// ─────────────────────────────────────────────────────────────────────────────
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
  console.log(  '║  PHASE 4 — AniList Enrichment  (~10,000 anime)     ║');
  console.log(  '╚══════════════════════════════════════════════════════╝');
  console.log(  '  ⚠  This phase takes ~8 hours for 200 pages. You can');
  console.log(  '     safely Ctrl+C and resume with --phase=4 later.\n');

  const batch = [];
  let enriched = 0;
  let totalPages = ANILIST_PAGES;

  for (let page = 1; page <= totalPages; page++) {
    if (page > 1) await sleep(ANILIST_DELAY_MS);

    try {
      const data = await anilistPost(ANILIST_POPULAR_QUERY, { page, perPage: ANILIST_PER_PAGE });

      if (!data?.Page?.media?.length) {
        console.log(`\n  [Phase 4] Empty page ${page} — stopping.`);
        break;
      }

      const pageInfo = data.Page.pageInfo;
      if (pageInfo?.lastPage && pageInfo.lastPage < totalPages) {
        totalPages = pageInfo.lastPage;
      }

      for (const media of data.Page.media) {
        const enrichFields = mapAnilistEnrichment(media);
        if (!enrichFields) { stats.anilistSkipped++; continue; }

        const titleRomaji  = String(media.title?.romaji  || '').trim();
        const titleEnglish = String(media.title?.english || '').trim();

        const titleFilter = {
          $or: [
            ...(titleRomaji  ? [{ title: { $regex: `^${titleRomaji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`,  $options: 'i' } }] : []),
            ...(titleEnglish ? [{ title: { $regex: `^${titleEnglish.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }] : []),
          ],
        };

        const { setPayload, unsetFields } = pruneNullIds(enrichFields);
        const update = { $set: setPayload };
        if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

        const filter = {
          $or: [
            { anilistId:  enrichFields.anilistId },
            { anilist_id: enrichFields.anilistId },
            ...(titleFilter.$or || []),
          ],
        };

        batch.push({ updateOne: { filter, update, upsert: true } });
        enriched++;
        stats.anilistEnriched++;
      }

      if (batch.length >= BATCH_SIZE) await flushBatch(collection, batch, 'Phase4-AniList');

      progress('AniList Enrich', page, totalPages,
        `enriched=${enriched} | next in ${ANILIST_DELAY_MS}ms`);

    } catch (err) {
      stats.anilistErrors++;
      console.warn(`\n  [Phase 4] Page ${page} error: ${err.message} — skipping page.`);
      await sleep(ANILIST_DELAY_MS * 2);
    }
  }

  if (batch.length > 0) await flushBatch(collection, batch, 'Phase4-AniList-Final');

  console.log(`\n  ✓ Phase 4 complete.`);
  console.log(`    Enriched: ${enriched} | Skipped: ${stats.anilistSkipped} | Errors: ${stats.anilistErrors}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// ENSURE INDEXES
// ─────────────────────────────────────────────────────────────────────────────
async function ensureIndexes(collection) {
  console.log('  Ensuring indexes...');
  try {
    await collection.createIndex({ tmdbId:    1 }, { unique: true, sparse: true, background: true });
    await collection.createIndex({ tmdb_id:   1 }, { unique: true, sparse: true, background: true });
    await collection.createIndex({ anilistId:  1 }, { sparse: true, background: true });
    await collection.createIndex({ anilist_id: 1 }, { sparse: true, background: true });
    await collection.createIndex({ category:   1 }, { background: true });
    await collection.createIndex({ title:      1 }, { background: true });
    await collection.createIndex({ views:     -1 }, { background: true });
    await collection.createIndex({ releaseYear: -1 }, { background: true });
    await collection.createIndex({ averageRating: -1, views: -1, createdAt: -1 }, { background: true });
    await collection.createIndex({ category: 1, averageRating: -1, views: -1 }, { background: true });
    await collection.createIndex(
      { title: 'text', description: 'text' },
      { background: true }
    );
    console.log('  ✓ Indexes ready.');
  } catch (err) {
    console.warn(`  ⚠ Index creation warning: ${err.message}`);
  }
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
  console.log('\n  CinePulse — Mass Seed Script  v2.0  (100K Matrix Edition)');

  if (MODE === 'matrix') {
    const profileName = PROFILE_TARGET || 'all';
    console.log(`  Mode: MATRIX | Profile: ${profileName}${DRY_RUN ? ' | DRY-RUN' : ''}`);
  } else {
    console.log(`  Mode: PHASE  | Phases: ${PHASES_RUN.join(', ')}${DRY_RUN ? ' | DRY-RUN' : ''}`);
  }
  console.log('─'.repeat(70));

  // ── Validate environment ──
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('\n  ✗ ERROR: MONGODB_URI (or MONGO_URI) is not set in your .env file.');
    process.exit(1);
  }

  try { getTmdbAuth(); } catch (err) {
    console.error(`\n  ✗ ERROR: ${err.message}\n`);
    process.exit(1);
  }

  // ── Connect to MongoDB ──
  console.log('\n  Connecting to MongoDB...');
  try {
    await mongoose.connect(mongoUri, {
      maxPoolSize:              5,
      minPoolSize:              1,
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS:          60000,
      connectTimeoutMS:         15000,
    });
    console.log(`  ✓ Connected: ${mongoose.connection.host}/${mongoose.connection.name}`);
  } catch (err) {
    console.error(`\n  ✗ MongoDB connection failed: ${err.message}`);
    process.exit(1);
  }

  const collection = mongoose.connection.collection('movies');

  if (!DRY_RUN) await ensureIndexes(collection);

  // ── Dispatch to correct mode ──
  if (MODE === 'matrix') {
    const profileName = PROFILE_TARGET || 'all';
    await runMatrixProfile(collection, profileName);
  } else {
    // Legacy phase mode
    if (PHASES_RUN.includes(1)) await phase1_tmdbMovies(collection);
    if (PHASES_RUN.includes(2)) await phase2_tmdbTv(collection);
    if (PHASES_RUN.includes(3)) await phase3_tmdbAnime(collection);
    if (PHASES_RUN.includes(4)) await phase4_anilistEnrich(collection);
  }

  // ── Final summary ──
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const hh = String(Math.floor(elapsed / 3600)).padStart(2, '0');
  const mm = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');

  console.log('\n' + '═'.repeat(70));
  console.log('  SEED COMPLETE');
  console.log('═'.repeat(70));
  console.log(`  Time elapsed:            ${hh}:${mm}:${ss}`);
  if (MODE === 'matrix') {
    console.log(`  Matrix records fetched:  ${stats.matrixFetched.toLocaleString()}`);
  } else {
    console.log(`  TMDB Movies fetched:     ${stats.tmdbMoviesFetched.toLocaleString()}`);
    console.log(`  TMDB TV fetched:         ${stats.tmdbTvFetched.toLocaleString()}`);
    console.log(`  TMDB Anime fetched:      ${stats.tmdbAnimeFetched.toLocaleString()}`);
    console.log(`  AniList enriched:        ${stats.anilistEnriched.toLocaleString()}`);
    console.log(`  AniList skipped:         ${stats.anilistSkipped.toLocaleString()}`);
    console.log(`  AniList errors:          ${stats.anilistErrors.toLocaleString()}`);
  }
  console.log('─'.repeat(70));
  console.log(`  DB upserted (new):       ${stats.dbUpserted.toLocaleString()}`);
  console.log(`  DB modified (updated):   ${stats.dbModified.toLocaleString()}`);
  console.log(`  DB write errors:         ${stats.dbErrors.toLocaleString()}`);
  console.log(`  Batches flushed:         ${stats.batchesFlushed.toLocaleString()}`);
  console.log('═'.repeat(70) + '\n');

  await mongoose.disconnect();
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n\n  ⚠  Interrupted (Ctrl+C). Closing MongoDB connection...');
  if (MODE === 'matrix') {
    console.log(`  Matrix records fetched so far: ${stats.matrixFetched.toLocaleString()}`);
  } else {
    console.log(`  Progress — Movies: ${stats.tmdbMoviesFetched} | TV: ${stats.tmdbTvFetched} | Anime: ${stats.tmdbAnimeFetched} | AniList: ${stats.anilistEnriched}`);
  }
  console.log(`  DB writes — Upserted: ${stats.dbUpserted} | Modified: ${stats.dbModified} | Errors: ${stats.dbErrors}`);
  try { await mongoose.disconnect(); } catch (_) {}
  console.log('  Connection closed. Re-run with same flags to resume (upsert is idempotent).\n');
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  console.error('\n  ✗ Unhandled rejection:', reason);
});

// ── Kick off ──
main().catch(err => {
  console.error('\n  ✗ Fatal error:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
