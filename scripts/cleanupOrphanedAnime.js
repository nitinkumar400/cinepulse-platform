/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CinePulse — Cleanup: Orphaned Anime Records
 * scripts/cleanupOrphanedAnime.js
 *
 * WHAT IT DOES:
 *   Deletes anime/cartoon records that have no anilistId after the healer
 *   ran. These are obscure titles that AniList doesn't know about — they
 *   have no playable source (Consumet needs anilistId for HLS streams) and
 *   no episode data, so they are dead weight in the catalog.
 *
 * USAGE:
 *   node scripts/cleanupOrphanedAnime.js --dry-run   # preview, no deletes
 *   node scripts/cleanupOrphanedAnime.js             # live delete
 *   node scripts/cleanupOrphanedAnime.js --list      # print titles before deleting
 *
 * SAFETY:
 *   - Always run --dry-run first to see the count and a sample
 *   - --list prints every title that will be deleted (use before live run)
 *   - Requires typing "YES" to confirm before any live deletion
 *   - Ctrl+C safe at any point
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const readline = require('readline');
const Movie    = require('../backend/models/Movie');

// ─────────────────────────────────────────────────────────────────────────────
// CLI FLAGS
// ─────────────────────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const LIST    = args.includes('--list');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Prompt user for confirmation in terminal */
function confirm(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TARGET FILTER
// Targets anime/cartoon records with no valid anilistId
// ─────────────────────────────────────────────────────────────────────────────
const ORPHAN_FILTER = {
  category: { $in: ['anime', 'cartoon'] },
  $or: [
    { anilistId: { $exists: false } },
    { anilistId: null },
    { anilistId: 0 },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   CinePulse — Cleanup: Orphaned Anime Records                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  if (DRY_RUN) console.log('  ⚠️  DRY-RUN MODE — no records will be deleted\n');
  else         console.log('  🔴  LIVE MODE — records WILL be permanently deleted\n');

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

  // ── Count orphans ──
  const count = await Movie.countDocuments(ORPHAN_FILTER);

  console.log(`🔍  Orphaned anime records (no anilistId): ${count}`);

  if (count === 0) {
    console.log('🎉  No orphaned records found — catalog is clean!');
    await mongoose.disconnect();
    return;
  }

  // ── Total anime in DB for context ──
  const totalAnime = await Movie.countDocuments({ category: { $in: ['anime', 'cartoon'] } });
  const pct = ((count / totalAnime) * 100).toFixed(1);
  console.log(`📊  That is ${pct}% of your ${totalAnime} total anime/cartoon records.\n`);

  // ── Sample preview (always shown) ──
  const sample = await Movie.find(ORPHAN_FILTER)
    .select('title category releaseYear tmdbId')
    .limit(LIST ? 9999 : 10)
    .lean();

  const label = LIST ? 'Full list of records to be deleted:' : 'Sample (first 10):';
  console.log(`📋  ${label}`);
  console.log('─'.repeat(64));
  sample.forEach((m, i) => {
    const year   = m.releaseYear ? ` (${m.releaseYear})` : '';
    const tmdb   = m.tmdbId ? ` [tmdbId=${m.tmdbId}]` : ' [no tmdbId]';
    const cat    = m.category.padEnd(8);
    console.log(`  ${String(i + 1).padStart(4)}.  [${cat}] ${m.title}${year}${tmdb}`);
  });
  if (!LIST && count > 10) {
    console.log(`         ... and ${count - 10} more.`);
    console.log(`         Run with --list to see all titles.\n`);
  }
  console.log('─'.repeat(64));
  console.log('');

  // ── Dry-run exits here ──
  if (DRY_RUN) {
    console.log(`✅  Dry-run complete. ${count} records WOULD be deleted.`);
    console.log('    Run without --dry-run to perform the actual deletion.\n');
    await mongoose.disconnect();
    return;
  }

  // ── Live run: require explicit confirmation ──
  console.log(`⚠️  You are about to PERMANENTLY DELETE ${count} records from MongoDB.`);
  console.log('    This cannot be undone.\n');

  const answer = await confirm('    Type "YES" to confirm deletion, or anything else to abort: ');

  if (answer !== 'YES') {
    console.log('\n🚫  Aborted — no records were deleted.\n');
    await mongoose.disconnect();
    return;
  }

  // ── Execute deletion ──
  console.log('\n🗑️   Deleting orphaned records...');
  const result = await Movie.deleteMany(ORPHAN_FILTER);
  const deleted = result.deletedCount || 0;

  console.log(`✅  Deleted ${deleted} orphaned anime records.\n`);

  // ── Final summary ──
  const remaining = await Movie.countDocuments({ category: { $in: ['anime', 'cartoon'] } });
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                   CLEANUP COMPLETE                          ║');
  console.log('╠══════════════════════════════════════════════════════════════╣');
  console.log(`║  Records deleted  : ${String(deleted).padEnd(41)}║`);
  console.log(`║  Anime remaining  : ${String(remaining).padEnd(41)}║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await mongoose.disconnect();
  console.log('🔌  Disconnected.\n');
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  console.log('\n\n⚠️  Ctrl+C — no records were deleted.');
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
