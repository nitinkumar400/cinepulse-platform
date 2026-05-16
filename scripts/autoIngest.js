/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CinePulse — Auto-Ingest Pipeline
 * scripts/autoIngest.js
 *
 * Automatically discovers and upserts new content into MongoDB:
 *   A. Currently Airing TV Shows        (TMDB /tv/on_the_air)
 *   B. Digital-Release Movies           (TMDB /discover/movie, 60+ days old)
 *   C. Currently Releasing Anime        (AniList GraphQL, status: RELEASING)
 *
 * Run manually:  node scripts/autoIngest.js
 * Automated:     GitHub Actions every 6 hours (see .github/workflows/auto-ingest.yml)
 *
 * SAFETY:
 *   - All upserts use tmdbId / anilistId as unique keys — never duplicates
 *   - pruneNullIdFields() prevents null collisions on sparse unique indexes
 *   - Duplicate key (11000) errors are caught and retried without the ID
 *   - Ctrl+C safe — all committed upserts are preserved
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Movie    = require('../backend/models/Movie');

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────
const TMDB_KEY    = process.env.TMDB_API_KEY  || process.env.TMDB_KEY || '';
const TMDB_BASE   = 'https://api.themoviedb.org/3';
const TMDB_IMG_W  = 'https://image.tmdb.org/t/p/w500';
const TMDB_IMG_O  = 'https://image.tmdb.org/t/p/original';
const ANILIST_API = 'https://graphql.anilist.co';

// Pages to fetch per source (each TMDB page = 20 items)
const TMDB_PAGES_TV    = 3;   // 60 airing TV shows
const TMDB_PAGES_MOVIE = 3;   // 60 digital-release movies
const ANILIST_PER_PAGE = 50;  // 50 releasing anime

const DELAY_MS      = 250;   // between TMDB requests
const FETCH_TIMEOUT = 10000; // 10s per request

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

const GENRE_MAP = {
  28:'Action',12:'Adventure',16:'Animation',35:'Comedy',80:'Crime',
  99:'Documentary',18:'Drama',10751:'Family',14:'Fantasy',36:'History',
  27:'Horror',10402:'Music',9648:'Mystery',10749:'Romance',878:'Sci-Fi',
  53:'Thriller',10752:'War',37:'Western',10759:'Action',10762:'Kids',
  10765:'Sci-Fi',10768:'War',
};

function mapGenreIds(ids = []) {
  return ids.map(id => GENRE_MAP[id]).filter(Boolean);
}

function mapTmdbStatus(s = '') {
  const map = {
    'Released':'Completed','Ended':'Completed',
    'Returning Series':'Ongoing','In Production':'Ongoing',
    'In Development':'Upcoming','Planned':'Upcoming',
    'Canceled':'Cancelled','Cancelled':'Cancelled',
  };
  return map[s] || 'Completed';
}

function mapAnilistStatus(s = '') {
  const map = {
    FINISHED:'Completed', RELEASING:'Ongoing',
    NOT_YET_RELEASED:'Upcoming', CANCELLED:'Cancelled', HIATUS:'Ongoing',
  };
  return map[s] || 'Completed';
}

/** Remove null/zero ID fields to avoid sparse unique index collisions */
function pruneNullIds(payload) {
  const p = { ...payload };
  if (!p.tmdbId   || p.tmdbId   <= 0) delete p.tmdbId;
  if (!p.tmdb_id  || p.tmdb_id  <= 0) delete p.tmdb_id;
  if (!p.anilistId  || p.anilistId  <= 0) delete p.anilistId;
  if (!p.anilist_id || p.anilist_id <= 0) delete p.anilist_id;
  return p;
}

/** Safe upsert — catches duplicate key and retries without the conflicting ID */
async function safeUpsert(filter, setPayload) {
  const clean = pruneNullIds(setPayload);
  try {
    await Movie.findOneAndUpdate(
      filter,
      { $set: clean },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return true;
  } catch (err) {
    if (err.code === 11000) {
      // Duplicate key — strip the conflicting ID and retry
      const safe = { ...clean };
      delete safe.tmdbId; delete safe.tmdb_id;
      delete safe.anilistId; delete safe.anilist_id;
      try {
        await Movie.findOneAndUpdate(
          filter,
          { $set: safe },
          { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        return true;
      } catch { return false; }
    }
    throw err;
  }
}

/** Fetch TMDB endpoint with retry */
async function tmdbGet(endpoint, params = {}, attempt = 1) {
  if (!TMDB_KEY) throw new Error('TMDB_API_KEY not set in environment');

  const url = new URL(`${TMDB_BASE}${endpoint}`);
  url.searchParams.set('api_key', TMDB_KEY);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timer);
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('retry-after') || '10', 10) * 1000;
      log(`  ⏳ TMDB rate limit — waiting ${wait / 1000}s`);
      await sleep(wait);
      return tmdbGet(endpoint, params, attempt);
    }
    if (!res.ok) throw new Error(`TMDB HTTP ${res.status} on ${endpoint}`);
    return res.json();
  } catch (err) {
    clearTimeout(timer);
    if (attempt < 3) {
      await sleep(DELAY_MS * 3);
      return tmdbGet(endpoint, params, attempt + 1);
    }
    throw err;
  }
}

/** Fetch AniList GraphQL with retry */
async function anilistPost(query, variables = {}, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(ANILIST_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ query, variables }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    if (res.status === 429) {
      const wait = parseInt(res.headers.get('retry-after') || '60', 10) * 1000;
      log(`  ⏳ AniList rate limit — waiting ${wait / 1000}s`);
      await sleep(wait);
      return anilistPost(query, variables, attempt);
    }
    if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'AniList error');
    return json.data || {};
  } catch (err) {
    clearTimeout(timer);
    if (attempt < 3) {
      await sleep(1500 * attempt);
      return anilistPost(query, variables, attempt + 1);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A. FETCH AIRING TV SHOWS
// TMDB /tv/on_the_air — shows currently airing with new episodes this week
// ─────────────────────────────────────────────────────────────────────────────
async function fetchAiringTv() {
  log('📺  Fetching airing TV shows from TMDB...');
  const items = [];

  for (let page = 1; page <= TMDB_PAGES_TV; page++) {
    try {
      const data = await tmdbGet('/tv/on_the_air', { page, language: 'en-US' });
      const results = data.results || [];
      items.push(...results);
      log(`  TV page ${page}/${TMDB_PAGES_TV}: +${results.length} shows`);
      if (!data.total_pages || page >= data.total_pages) break;
    } catch (err) {
      log(`  ❌ TV page ${page} failed: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  log(`  ✅ Fetched ${items.length} airing TV shows`);
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// B. FETCH DIGITAL-RELEASE MOVIES
// Uses /discover/movie with primary_release_date.lte = 60 days ago
// This avoids CAM rips — only movies that have had time to reach digital
// ─────────────────────────────────────────────────────────────────────────────
async function fetchDigitalMovies() {
  log('🎬  Fetching digital-release movies from TMDB...');
  const items = [];

  // 60 days ago = safely past theatrical window, on digital/streaming
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const dateStr = sixtyDaysAgo.toISOString().split('T')[0]; // YYYY-MM-DD

  for (let page = 1; page <= TMDB_PAGES_MOVIE; page++) {
    try {
      const data = await tmdbGet('/discover/movie', {
        page,
        language:                  'en-US',
        sort_by:                   'popularity.desc',
        'primary_release_date.lte': dateStr,
        'vote_count.gte':           50,    // filter out obscure/unrated
        'vote_average.gte':         5.0,   // minimum quality threshold
        include_adult:              false,
        include_video:              false,
      });
      const results = data.results || [];
      items.push(...results);
      log(`  Movie page ${page}/${TMDB_PAGES_MOVIE}: +${results.length} movies`);
      if (!data.total_pages || page >= data.total_pages) break;
    } catch (err) {
      log(`  ❌ Movie page ${page} failed: ${err.message}`);
    }
    await sleep(DELAY_MS);
  }

  log(`  ✅ Fetched ${items.length} digital-release movies`);
  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// C. FETCH RELEASING ANIME
// AniList GraphQL — status: RELEASING, sorted by UPDATED_AT_DESC
// This catches both ongoing series and newly started ones
// ─────────────────────────────────────────────────────────────────────────────
const ANIME_QUERY = `
query ($page: Int, $perPage: Int) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(
      type: ANIME
      status: RELEASING
      sort: UPDATED_AT_DESC
      isAdult: false
    ) {
      id
      idMal
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      averageScore
      popularity
      episodes
      duration
      status
      genres
      seasonYear
      countryOfOrigin
      studios(isMain: true) { nodes { name } }
      nextAiringEpisode { episode airingAt }
    }
  }
}`;

async function fetchReleasingAnime() {
  log('🎌  Fetching releasing anime from AniList...');
  const items = [];

  try {
    const data = await anilistPost(ANIME_QUERY, { page: 1, perPage: ANILIST_PER_PAGE });
    const results = data?.Page?.media || [];
    items.push(...results);
    log(`  ✅ Fetched ${results.length} releasing anime`);
  } catch (err) {
    log(`  ❌ AniList fetch failed: ${err.message}`);
  }

  return items;
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT: TV SHOWS
// ─────────────────────────────────────────────────────────────────────────────
async function upsertTvShows(items) {
  log(`\n💾  Upserting ${items.length} TV shows...`);
  let upserted = 0, updated = 0, failed = 0;

  // Deduplicate by tmdbId
  const seen = new Set();
  const deduped = items.filter(item => {
    const id = Number(item.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const item of deduped) {
    const tmdbId = Number(item.id);
    if (!tmdbId) continue;

    const title = String(item.name || item.title || '').trim();
    if (!title) continue;

    const filter = { $or: [{ tmdbId }, { tmdb_id: tmdbId }] };
    const existing = await Movie.findOne(filter).select('_id').lean();

    const payload = {
      title,
      description: String(item.overview || 'No description available.').trim().slice(0, 600),
      category:    'series',
      provider:    'tmdb',
      tmdbId,
      tmdb_id:     tmdbId,
      genre:       mapGenreIds(item.genre_ids || []),
      tmdb_genre_ids: item.genre_ids || [],
      releaseYear: parseInt(String(item.first_air_date || '2024').split('-')[0], 10) || 2024,
      thumbnailUrl: item.poster_path   ? `${TMDB_IMG_W}${item.poster_path}`   : '',
      bannerUrl:    item.backdrop_path ? `${TMDB_IMG_O}${item.backdrop_path}` : '',
      averageRating: Number(item.vote_average || 0),
      vote_average:  Number(item.vote_average || 0),
      original_language: String(item.original_language || '').toLowerCase(),
      status: 'Ongoing', // on_the_air = currently airing
      videoUrl: '',
    };

    try {
      const ok = await safeUpsert(filter, payload);
      if (ok) { existing ? updated++ : upserted++; }
      else failed++;
    } catch (err) {
      log(`  ❌ TV upsert failed for "${title}": ${err.message}`);
      failed++;
    }
  }

  log(`  TV shows — upserted: ${upserted} | updated: ${updated} | failed: ${failed}`);
  return { upserted, updated, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT: MOVIES
// ─────────────────────────────────────────────────────────────────────────────
async function upsertMovies(items) {
  log(`\n💾  Upserting ${items.length} movies...`);
  let upserted = 0, updated = 0, failed = 0;

  const seen = new Set();
  const deduped = items.filter(item => {
    const id = Number(item.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const item of deduped) {
    const tmdbId = Number(item.id);
    if (!tmdbId) continue;

    const title = String(item.title || item.name || '').trim();
    if (!title) continue;

    const filter = { $or: [{ tmdbId }, { tmdb_id: tmdbId }] };
    const existing = await Movie.findOne(filter).select('_id').lean();

    const payload = {
      title,
      description: String(item.overview || 'No description available.').trim().slice(0, 600),
      category:    'movie',
      provider:    'tmdb',
      tmdbId,
      tmdb_id:     tmdbId,
      genre:       mapGenreIds(item.genre_ids || []),
      tmdb_genre_ids: item.genre_ids || [],
      releaseYear: parseInt(String(item.release_date || '2024').split('-')[0], 10) || 2024,
      thumbnailUrl: item.poster_path   ? `${TMDB_IMG_W}${item.poster_path}`   : '',
      bannerUrl:    item.backdrop_path ? `${TMDB_IMG_O}${item.backdrop_path}` : '',
      averageRating: Number(item.vote_average || 0),
      vote_average:  Number(item.vote_average || 0),
      original_language: String(item.original_language || '').toLowerCase(),
      status: 'Completed',
      videoUrl: '',
    };

    try {
      const ok = await safeUpsert(filter, payload);
      if (ok) { existing ? updated++ : upserted++; }
      else failed++;
    } catch (err) {
      log(`  ❌ Movie upsert failed for "${title}": ${err.message}`);
      failed++;
    }
  }

  log(`  Movies — upserted: ${upserted} | updated: ${updated} | failed: ${failed}`);
  return { upserted, updated, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// UPSERT: ANIME
// ─────────────────────────────────────────────────────────────────────────────
async function upsertAnime(items) {
  log(`\n💾  Upserting ${items.length} anime...`);
  let upserted = 0, updated = 0, failed = 0;

  const seen = new Set();
  const deduped = items.filter(item => {
    const id = Number(item.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  for (const anime of deduped) {
    const anilistId = Number(anime.id);
    if (!anilistId) continue;

    const title = String(
      anime.title?.english || anime.title?.romaji || anime.title?.native || ''
    ).trim();
    if (!title) continue;

    const filter = { $or: [{ anilistId }, { anilist_id: anilistId }] };
    const existing = await Movie.findOne(filter).select('_id').lean();

    const score = Number(anime.averageScore || 0);
    const nextAiringAt = anime.nextAiringEpisode?.airingAt
      ? new Date(anime.nextAiringEpisode.airingAt * 1000)
      : null;

    const payload = {
      title,
      description: String(anime.description || 'No description available.')
        .replace(/<[^>]+>/g, '').trim().slice(0, 600),
      category:    'anime',
      provider:    'anilist',
      anilistId,
      anilist_id:  anilistId,
      idMal:       Number(anime.idMal) || null,
      genre:       anime.genres || [],
      releaseYear: Number(anime.seasonYear) || new Date().getFullYear(),
      duration:    Number(anime.duration || 24),
      totalEpisodes: Number(anime.episodes || 0),
      thumbnailUrl: anime.coverImage?.extraLarge || anime.coverImage?.large || '',
      bannerUrl:    anime.bannerImage || anime.coverImage?.extraLarge || '',
      studio:       anime.studios?.nodes?.[0]?.name || '',
      averageRating: score > 0 ? Math.min(10, Number((score / 10).toFixed(1))) : 0,
      vote_average:  score > 0 ? Math.min(10, Number((score / 10).toFixed(1))) : 0,
      original_language: String(anime.countryOfOrigin || 'ja').toLowerCase(),
      spoken_languages: ['Japanese', 'English'],
      subDubTag:   'Subbed',
      status:      mapAnilistStatus(anime.status),
      nextAiringEpisode: {
        episode:  Number(anime.nextAiringEpisode?.episode || 0),
        airingAt: nextAiringAt,
      },
      videoUrl: '',
    };

    try {
      const ok = await safeUpsert(filter, payload);
      if (ok) { existing ? updated++ : upserted++; }
      else failed++;
    } catch (err) {
      log(`  ❌ Anime upsert failed for "${title}": ${err.message}`);
      failed++;
    }
  }

  log(`  Anime — upserted: ${upserted} | updated: ${updated} | failed: ${failed}`);
  return { upserted, updated, failed };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startMs = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   CinePulse — Auto-Ingest Pipeline                           ║');
  console.log('║   TV Shows · Digital Movies · Releasing Anime                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  // ── Validate env ──
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) { console.error('❌  MONGODB_URI not set'); process.exit(1); }
  if (!TMDB_KEY)  { console.error('❌  TMDB_API_KEY not set'); process.exit(1); }

  // ── Connect ──
  log('🔌  Connecting to MongoDB Atlas...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  log('✅  Connected\n');

  // ── Fetch all three sources in parallel ──
  const [tvItems, movieItems, animeItems] = await Promise.all([
    fetchAiringTv(),
    fetchDigitalMovies(),
    fetchReleasingAnime(),
  ]);

  // ── Upsert sequentially (safe for Atlas free tier) ──
  const tvStats    = await upsertTvShows(tvItems);
  const movieStats = await upsertMovies(movieItems);
  const animeStats = await upsertAnime(animeItems);

  // ── Summary ──
  const elapsed = Math.round((Date.now() - startMs) / 1000);
  const totalNew = tvStats.upserted + movieStats.upserted + animeStats.upserted;
  const totalUpd = tvStats.updated  + movieStats.updated  + animeStats.updated;

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   INGEST COMPLETE                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  New records added  : ${String(totalNew).padEnd(39)}║`);
  console.log(`║  Existing updated   : ${String(totalUpd).padEnd(39)}║`);
  console.log(`║  TV shows processed : ${String(tvItems.length).padEnd(39)}║`);
  console.log(`║  Movies processed   : ${String(movieItems.length).padEnd(39)}║`);
  console.log(`║  Anime processed    : ${String(animeItems.length).padEnd(39)}║`);
  console.log(`║  Elapsed            : ${String(elapsed + 's').padEnd(39)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  await mongoose.disconnect();
  log('🔌  Disconnected');
  process.exit(0);
}

process.on('SIGINT', async () => {
  console.log('\n⚠️  Interrupted');
  try { await mongoose.disconnect(); } catch {}
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('❌  Unhandled rejection:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});

main().catch((err) => {
  console.error('❌  Fatal:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
