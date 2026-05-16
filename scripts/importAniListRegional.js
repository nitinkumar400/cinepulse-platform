/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CinePulse — AniList Regional Importer
 * scripts/importAniListRegional.js
 *
 * WHAT IT DOES:
 *   Imports anime from AniList for Japan, China, Korea, and India.
 *   Uses AniList's GraphQL API to fetch by country of origin.
 *   Fully idempotent — safe to re-run, never double-imports.
 *   Resume-safe — if interrupted, picks up exactly where it left off
 *   using a local progress file (.anilist_import_progress.json).
 *
 * USAGE:
 *   node scripts/importAniListRegional.js                    # all regions
 *   node scripts/importAniListRegional.js --region=JP        # Japan only
 *   node scripts/importAniListRegional.js --region=CN        # China only
 *   node scripts/importAniListRegional.js --region=KR        # Korea only
 *   node scripts/importAniListRegional.js --region=IN        # India only
 *   node scripts/importAniListRegional.js --dry-run          # preview only
 *   node scripts/importAniListRegional.js --reset            # clear progress & restart
 *
 * NPM SHORTCUTS (add to package.json):
 *   npm run import:anime           → all regions
 *   npm run import:anime:jp        → Japan
 *   npm run import:anime:cn        → China
 *   npm run import:anime:kr        → Korea
 *   npm run import:anime:in        → India
 *
 * RATE LIMITING:
 *   AniList allows 90 requests/minute. We use 800ms delay = ~75 req/min.
 *   Safe margin with no risk of 429 errors.
 *
 * DEDUPLICATION:
 *   Uses anilistId as the unique key. bulkWrite with upsert:true means
 *   re-running updates existing records instead of creating duplicates.
 *
 * RESUME LOGIC:
 *   Progress is saved to .anilist_import_progress.json after every page.
 *   On restart, the script reads this file and skips already-done pages.
 *   Use --reset to clear progress and start fresh.
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const fs       = require('fs');
const path     = require('path');
const Movie    = require('../backend/models/Movie');

// ─────────────────────────────────────────────────────────────────────────────
// CLI FLAGS
// ─────────────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const DRY_RUN    = args.includes('--dry-run');
const RESET      = args.includes('--reset');
const regionArg  = args.find(a => a.startsWith('--region='));
const REGION_FILTER = regionArg ? regionArg.replace('--region=', '').toUpperCase() : null;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ANILIST_API    = 'https://graphql.anilist.co';
const DELAY_MS       = 800;    // 800ms between requests → ~75 req/min
const FETCH_TIMEOUT  = 12000;  // 12s per request
const PER_PAGE       = 50;     // AniList max per page
const BATCH_SIZE     = 100;    // MongoDB bulkWrite batch size
const PROGRESS_FILE  = path.resolve(__dirname, '.anilist_import_progress.json');

// ─────────────────────────────────────────────────────────────────────────────
// REGIONAL PROFILES
// Each region maps to an AniList countryOfOrigin code.
// We fetch by popularity descending to get the best content first.
// ─────────────────────────────────────────────────────────────────────────────
const REGIONS = [
  {
    code:        'JP',
    name:        'Japan',
    country:     'JP',
    category:    'anime',
    maxPages:    200,   // 200 pages × 50 = 10,000 titles
    description: 'Japanese Anime',
  },
  {
    code:        'CN',
    name:        'China (Donghua)',
    country:     'CN',
    category:    'anime',
    maxPages:    100,   // 100 pages × 50 = 5,000 titles
    description: 'Chinese Donghua / Manhua Adaptations',
  },
  {
    code:        'KR',
    name:        'Korea',
    country:     'KR',
    category:    'anime',
    maxPages:    60,    // 60 pages × 50 = 3,000 titles
    description: 'Korean Manhwa Anime / Donghua',
  },
  {
    code:        'IN',
    name:        'India',
    country:     'IN',
    category:    'anime',
    maxPages:    20,    // 20 pages × 50 = 1,000 titles
    description: 'Indian Animation',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// GRAPHQL QUERY
// Fetches anime by country of origin, sorted by popularity descending.
// ─────────────────────────────────────────────────────────────────────────────
const FETCH_QUERY = `
query ($page: Int, $perPage: Int, $country: CountryCode) {
  Page(page: $page, perPage: $perPage) {
    pageInfo {
      total
      currentPage
      lastPage
      hasNextPage
    }
    media(
      type: ANIME
      countryOfOrigin: $country
      sort: POPULARITY_DESC
      isAdult: false
    ) {
      id
      title { romaji english native }
      description(asHtml: false)
      coverImage { extraLarge large }
      bannerImage
      averageScore
      popularity
      episodes
      duration
      status
      season
      seasonYear
      startDate { year month day }
      genres
      studios(isMain: true) { nodes { name } }
      countryOfOrigin
      isAdult
    }
  }
}`;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function elapsed(startMs) {
  const s = Math.floor((Date.now() - startMs) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function mapStatus(s) {
  const map = {
    FINISHED:         'Completed',
    RELEASING:        'Ongoing',
    NOT_YET_RELEASED: 'Upcoming',
    CANCELLED:        'Cancelled',
    HIATUS:           'Ongoing',
  };
  return map[s] || 'Completed';
}

function cleanDescription(raw = '') {
  return String(raw || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .trim()
    .slice(0, 500);
}

// ─────────────────────────────────────────────────────────────────────────────
// PROGRESS FILE — resume support
// ─────────────────────────────────────────────────────────────────────────────
function loadProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) {
      return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
    }
  } catch {}
  return {};
}

function saveProgress(progress) {
  try {
    fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
  } catch (e) {
    console.warn('  ⚠️  Could not save progress file:', e.message);
  }
}

function clearProgress() {
  try {
    if (fs.existsSync(PROGRESS_FILE)) fs.unlinkSync(PROGRESS_FILE);
  } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// ANILIST FETCH WITH RETRY
// ─────────────────────────────────────────────────────────────────────────────
async function fetchPage(country, page, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(ANILIST_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({
        query: FETCH_QUERY,
        variables: { page, perPage: PER_PAGE, country },
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Rate limit — wait and retry
    if (res.status === 429) {
      const wait = parseInt(res.headers.get('retry-after') || '60', 10);
      console.warn(`  ⏳ Rate limited — waiting ${wait}s...`);
      await sleep(wait * 1000);
      return fetchPage(country, page, attempt);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0]?.message || 'GraphQL error');

    return json.data?.Page || null;

  } catch (err) {
    clearTimeout(timer);
    if (attempt < 3) {
      console.warn(`  ↻ Retry ${attempt}/2 for ${country} page ${page}...`);
      await sleep(DELAY_MS * 3);
      return fetchPage(country, page, attempt + 1);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT ANILIST MEDIA → MongoDB document
// ─────────────────────────────────────────────────────────────────────────────
function formatMedia(media, category) {
  const title = media.title?.english || media.title?.romaji || media.title?.native || 'Unknown';
  const studio = media.studios?.nodes?.[0]?.name || '';
  const score = media.averageScore
    ? Math.min(10, parseFloat((media.averageScore / 10).toFixed(1)))
    : 0;
  const year = media.seasonYear || media.startDate?.year || new Date().getFullYear();

  return {
    title,
    description:   cleanDescription(media.description),
    category,
    genre:         media.genres || [],
    releaseYear:   year,
    duration:      media.duration || 24,
    rating:        'TV-14',
    language:      'English',
    spoken_languages: ['Japanese', 'English'],
    provider:      'anilist',
    studio,
    thumbnailUrl:  media.coverImage?.extraLarge || media.coverImage?.large || '',
    bannerUrl:     media.bannerImage || media.coverImage?.extraLarge || '',
    videoUrl:      '',
    anilistId:     media.id,
    anilist_id:    media.id,
    totalEpisodes: media.episodes || 0,
    status:        mapStatus(media.status),
    averageRating: score,
    vote_average:  score,
    isFeatured:    false,
    isNewRelease:  true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT ONE REGION
// ─────────────────────────────────────────────────────────────────────────────
async function importRegion(region, progress, startMs) {
  const { code, name, country, category, maxPages, description } = region;

  console.log(`\n${'═'.repeat(64)}`);
  console.log(`  🌏  ${name} — ${description}`);
  console.log(`${'═'.repeat(64)}`);

  // Resume: find last completed page for this region
  const startPage = (progress[code] || 0) + 1;
  if (startPage > 1) {
    console.log(`  ↩️  Resuming from page ${startPage} (pages 1–${startPage - 1} already done)`);
  }

  let totalFetched  = 0;
  let totalUpserted = 0;
  let totalSkipped  = 0;
  let batch         = [];

  for (let page = startPage; page <= maxPages; page++) {
    let pageData;
    try {
      pageData = await fetchPage(country, page);
    } catch (err) {
      console.error(`  ❌  Failed to fetch ${name} page ${page}: ${err.message}`);
      break;
    }

    if (!pageData) break;

    const items = pageData.media || [];
    if (!items.length) {
      console.log(`  ✅  ${name}: no more results at page ${page}`);
      break;
    }

    // Filter adults
    const clean = items.filter(m => !m.isAdult);
    totalFetched += clean.length;

    // Build upsert operations
    for (const media of clean) {
      const doc = formatMedia(media, category);
      batch.push({
        updateOne: {
          filter: { anilistId: media.id },
          update: { $set: doc },
          upsert: true,
        },
      });
    }

    // Flush batch when full
    if (batch.length >= BATCH_SIZE) {
      if (!DRY_RUN) {
        const result = await Movie.bulkWrite(batch, { ordered: false });
        totalUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);
        totalSkipped  += batch.length - (result.upsertedCount || 0) - (result.modifiedCount || 0);
      } else {
        totalUpserted += batch.length;
      }
      batch = [];
    }

    // Save progress after every page
    if (!DRY_RUN) {
      progress[code] = page;
      saveProgress(progress);
    }

    const pageInfo = pageData.pageInfo || {};
    const pct = Math.round((page / Math.min(maxPages, pageInfo.lastPage || maxPages)) * 100);
    process.stdout.write(
      `\r  📄  ${name}: page ${page}/${pageInfo.lastPage || '?'} (${pct}%) | fetched=${totalFetched} | saved=${totalUpserted} | ⏱ ${elapsed(startMs)}   `
    );

    // Stop if AniList says no more pages
    if (!pageInfo.hasNextPage) {
      console.log(`\n  ✅  ${name}: reached last page (${page})`);
      break;
    }

    await sleep(DELAY_MS);
  }

  // Flush remaining batch
  if (batch.length > 0) {
    if (!DRY_RUN) {
      const result = await Movie.bulkWrite(batch, { ordered: false });
      totalUpserted += (result.upsertedCount || 0) + (result.modifiedCount || 0);
    } else {
      totalUpserted += batch.length;
    }
    batch = [];
  }

  // Mark region complete
  if (!DRY_RUN) {
    progress[code] = maxPages;
    saveProgress(progress);
  }

  console.log(`\n  ✅  ${name} done — fetched=${totalFetched} | saved=${totalUpserted}${DRY_RUN ? ' [DRY]' : ''}`);
  return { fetched: totalFetched, upserted: totalUpserted };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startMs = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   CinePulse — AniList Regional Importer                      ║');
  console.log('║   Regions: Japan · China · Korea · India                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  if (DRY_RUN)       console.log('  ⚠️  DRY-RUN MODE — no database writes');
  if (REGION_FILTER) console.log(`  ℹ️  Region filter: ${REGION_FILTER} only`);
  console.log('');

  // ── Reset progress if requested ──
  if (RESET) {
    clearProgress();
    console.log('  🔄  Progress file cleared — starting fresh.\n');
  }

  // ── Connect ──
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌  MONGODB_URI not set in .env — aborting.');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB Atlas...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS:          45000,
  });
  console.log('✅  Connected.\n');

  // ── Load progress ──
  const progress = loadProgress();
  if (Object.keys(progress).length > 0 && !RESET) {
    console.log('  📂  Resuming from saved progress:');
    Object.entries(progress).forEach(([code, page]) => {
      const region = REGIONS.find(r => r.code === code);
      if (region) console.log(`       ${region.name}: completed up to page ${page}/${region.maxPages}`);
    });
    console.log('');
  }

  // ── Filter regions ──
  const regionsToRun = REGION_FILTER
    ? REGIONS.filter(r => r.code === REGION_FILTER)
    : REGIONS;

  if (!regionsToRun.length) {
    console.error(`❌  Unknown region: ${REGION_FILTER}. Valid: JP, CN, KR, IN`);
    await mongoose.disconnect();
    process.exit(1);
  }

  // ── Run each region ──
  const totals = { fetched: 0, upserted: 0 };
  for (const region of regionsToRun) {
    const result = await importRegion(region, progress, startMs);
    totals.fetched   += result.fetched;
    totals.upserted  += result.upserted;
  }

  // ── Final summary ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   IMPORT COMPLETE                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total fetched    : ${String(totals.fetched).padEnd(41)}║`);
  console.log(`║  Total saved/upd  : ${String(totals.upserted).padEnd(41)}║`);
  console.log(`║  Elapsed          : ${elapsed(startMs).padEnd(41)}║`);
  if (DRY_RUN) {
    console.log('║                                                              ║');
    console.log('║  ⚠️  DRY-RUN — no records were actually written              ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Clean up progress file on successful full run
  if (!DRY_RUN && !REGION_FILTER) {
    clearProgress();
    console.log('  🧹  Progress file cleared (full run complete).\n');
  }

  await mongoose.disconnect();
  console.log('🔌  Disconnected.\n');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN — Ctrl+C saves progress before exit
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Interrupted — progress saved. Resume with: npm run import:anime');
  try { await mongoose.disconnect(); } catch {}
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('\n❌  Unhandled rejection:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});

main().catch((err) => {
  console.error('\n❌  Fatal error:', err.message || err);
  mongoose.disconnect().finally(() => process.exit(1));
});
