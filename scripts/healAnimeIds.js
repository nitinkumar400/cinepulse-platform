/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CinePulse — Database Healer: Title → AniList ID Translator
 * scripts/healAnimeIds.js
 *
 * STRATEGY:
 *   For every anime/cartoon record that has a tmdbId but no anilistId,
 *   search AniList's free GraphQL API by title to get the AniList ID.
 *   No API key required. Rate limit: 90 req/min (we use 1 req/1.5s = 40/min).
 *
 * USAGE:
 *   node scripts/healAnimeIds.js              # full run
 *   node scripts/healAnimeIds.js --dry-run    # preview only, no DB writes
 *   node scripts/healAnimeIds.js --limit=100  # process first 100 records
 *   node scripts/healAnimeIds.js --skip=500   # resume from record 500
 *
 * RATE LIMITING:
 *   1500ms delay between requests → ~40 req/min (AniList allows 90/min).
 *   Safe margin to avoid 429 errors.
 *
 * SAFETY:
 *   - Ctrl+C safe: all saved records are preserved
 *   - Dry-run: logs what WOULD be written without touching DB
 *   - Idempotent: skips records that already have anilistId
 *   - Never overwrites a valid anilistId with null
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const Movie    = require('../backend/models/Movie');

// ─────────────────────────────────────────────────────────────────────────────
// CLI FLAGS
// ─────────────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

const limitArg = args.find(a => a.startsWith('--limit='));
const LIMIT    = limitArg ? parseInt(limitArg.replace('--limit=', ''), 10) : 0;

const skipArg = args.find(a => a.startsWith('--skip='));
const SKIP    = skipArg  ? parseInt(skipArg.replace('--skip=', ''), 10)  : 0;

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const ANILIST_API  = 'https://graphql.anilist.co';
const DELAY_MS     = 1500;   // 1.5s between requests → ~40 req/min
const FETCH_TIMEOUT = 10000; // 10s timeout per request
const MAX_RETRIES  = 2;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const pad = (n, w = 5) => String(n).padStart(w, ' ');

function elapsed(startMs) {
  const s = Math.floor((Date.now() - startMs) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANILIST GRAPHQL SEARCH
// Searches by title, returns best match { anilistId, totalEpisodes }
// Tries: exact English title → exact Romaji → fuzzy first result
// ─────────────────────────────────────────────────────────────────────────────
const SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 5) {
    media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
      id
      title { romaji english native }
      episodes
      status
      averageScore
    }
  }
}`;

async function searchAniList(title, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const res = await fetch(ANILIST_API, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body:    JSON.stringify({ query: SEARCH_QUERY, variables: { search: title } }),
      signal:  controller.signal,
    });
    clearTimeout(timer);

    // AniList rate limit hit
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') || '60', 10);
      console.warn(`    ⏳ Rate limited — waiting ${retryAfter}s...`);
      await sleep(retryAfter * 1000);
      return searchAniList(title, attempt);
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    if (json.errors) throw new Error(json.errors[0].message);

    const results = json?.data?.Page?.media || [];
    if (!results.length) return null;

    // ── Best match logic ──
    const normalizedTitle = title.trim().toLowerCase();

    // 1. Exact English title match
    const exactEn = results.find(m =>
      String(m.title?.english || '').trim().toLowerCase() === normalizedTitle
    );
    if (exactEn) return { anilistId: exactEn.id, totalEpisodes: exactEn.episodes || 0 };

    // 2. Exact Romaji match
    const exactRomaji = results.find(m =>
      String(m.title?.romaji || '').trim().toLowerCase() === normalizedTitle
    );
    if (exactRomaji) return { anilistId: exactRomaji.id, totalEpisodes: exactRomaji.episodes || 0 };

    // 3. Partial match — title contains search term
    const partial = results.find(m => {
      const en = String(m.title?.english || '').trim().toLowerCase();
      const ro = String(m.title?.romaji  || '').trim().toLowerCase();
      return en.includes(normalizedTitle) || normalizedTitle.includes(en) ||
             ro.includes(normalizedTitle) || normalizedTitle.includes(ro);
    });
    if (partial) return { anilistId: partial.id, totalEpisodes: partial.episodes || 0 };

    // 4. Fallback: first result (highest search relevance score from AniList)
    const first = results[0];
    return { anilistId: first.id, totalEpisodes: first.episodes || 0 };

  } catch (err) {
    clearTimeout(timer);
    const isRetryable = err.name === 'AbortError' || String(err.message).includes('5');
    if (isRetryable && attempt < MAX_RETRIES) {
      console.warn(`    ↻ Retry ${attempt}/${MAX_RETRIES - 1} for "${title}"...`);
      await sleep(DELAY_MS * 2);
      return searchAniList(title, attempt + 1);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  const startMs = Date.now();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   CinePulse — Database Healer: Title → AniList ID Fixer      ║');
  console.log('║   Source: AniList GraphQL API (free, no key required)        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  if (DRY_RUN) console.log('  ⚠️  DRY-RUN MODE — no database writes will occur');
  if (LIMIT)   console.log(`  ℹ️  Processing first ${LIMIT} records only`);
  if (SKIP)    console.log(`  ℹ️  Skipping first ${SKIP} records`);
  console.log('');

  // ── Connect ──
  const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!mongoUri) {
    console.error('❌  MONGODB_URI not set in .env — aborting.');
    process.exit(1);
  }

  console.log('🔌  Connecting to MongoDB Atlas...');
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
    socketTimeoutMS: 45000,
  });
  console.log('✅  Connected.\n');

  // ── Query ──
  let query = Movie.find({
    category: { $in: ['anime', 'cartoon'] },
    $or: [
      { anilistId: { $exists: false } },
      { anilistId: null },
      { anilistId: 0 },
    ],
  })
  .select('_id title tmdbId anilistId totalEpisodes releaseYear')
  .lean();

  if (SKIP)  query = query.skip(SKIP);
  if (LIMIT) query = query.limit(LIMIT);

  const animeToHeal = await query.exec();
  const total = animeToHeal.length;

  console.log(`🔍  Found ${total} anime records requiring AniList IDs.`);
  if (total === 0) {
    console.log('🎉  Nothing to heal — database is already clean!');
    await mongoose.disconnect();
    return;
  }

  const estMins = Math.ceil((total * DELAY_MS) / 60000);
  console.log(`⏱   Estimated time: ~${estMins} minutes at ${DELAY_MS}ms/request\n`);

  // ── Counters ──
  let healed  = 0;
  let skipped = 0;  // AniList returned no results
  let failed  = 0;  // network error

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN LOOP — sequential, one request at a time
  // ─────────────────────────────────────────────────────────────────────────
  for (let i = 0; i < animeToHeal.length; i++) {
    const movie = animeToHeal[i];
    const pos   = `[${pad(i + 1 + SKIP)}/${pad(total + SKIP)}]`;
    const title = (movie.title || 'Unknown').slice(0, 45).padEnd(45, ' ');

    // Guard: already healed (race condition)
    if (movie.anilistId && movie.anilistId > 0) {
      console.log(`${pos} ⏭  ${title} — already has anilistId=${movie.anilistId}`);
      continue;
    }

    try {
      const result = await searchAniList(movie.title);

      if (!result || !result.anilistId) {
        console.log(`${pos} ⚠️  ${title} — not found on AniList`);
        skipped++;
      } else {
        const { anilistId, totalEpisodes } = result;

        if (!DRY_RUN) {
          await Movie.findByIdAndUpdate(
            movie._id,
            {
              $set: {
                anilistId:  anilistId,
                anilist_id: anilistId,
                ...(totalEpisodes > 0 ? { totalEpisodes } : {}),
              },
            },
            { runValidators: false }
          );
        }

        const epNote = totalEpisodes > 0 ? ` | eps=${totalEpisodes}` : '';
        const dryTag = DRY_RUN ? ' [DRY]' : '';
        console.log(`${pos} ✅  ${title} — anilistId=${anilistId}${epNote}${dryTag}`);
        healed++;
      }
    } catch (err) {
      const reason = err.name === 'AbortError' ? 'timeout' : err.message;
      console.log(`${pos} ❌  ${title} — ${reason}`);
      failed++;
    }

    // Progress every 25 records
    if ((i + 1) % 25 === 0) {
      const pct = Math.round(((i + 1) / total) * 100);
      console.log(`\n  ── ${i + 1}/${total} (${pct}%) | ✅ ${healed} healed | ⚠️ ${skipped} skipped | ❌ ${failed} failed | ⏱ ${elapsed(startMs)}\n`);
    }

    // Rate limit delay (skip after last item)
    if (i < animeToHeal.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // ── Summary ──
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                     HEAL COMPLETE                           ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Total processed : ${String(total).padEnd(41)}║`);
  console.log(`║  ✅ Healed        : ${String(healed).padEnd(41)}║`);
  console.log(`║  ⚠️  Not on AniList: ${String(skipped).padEnd(40)}║`);
  console.log(`║  ❌ Failed        : ${String(failed).padEnd(41)}║`);
  console.log(`║  ⏱  Elapsed       : ${elapsed(startMs).padEnd(41)}║`);
  if (DRY_RUN) {
    console.log('║                                                              ║');
    console.log('║  ⚠️  DRY-RUN — no records were actually modified             ║');
  }
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await mongoose.disconnect();
  console.log('🔌  Disconnected.\n');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Ctrl+C — all saved records are preserved.');
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
