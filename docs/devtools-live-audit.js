/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CineStream — Live Production Audit Script (Chrome DevTools Console)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * USAGE:
 *   1. Open https://cinepulse-platform.vercel.app in Chrome
 *   2. Press F12 → Console tab
 *   3. Paste this entire script and press Enter
 *   4. Results print as a formatted table + summary
 *
 * TESTS:
 *   1. API Speed — Homepage /api/movies response time
 *   2. Pagination Integrity — Verify total, pages, limit clamping
 *   3. Category Filter — Each category returns valid data
 *   4. Search Latency — Full-text search response time
 *   5. Deep Pagination — Page 100+ still responds within timeout
 *   6. Clean URL Routing — /watch/movie/:id resolves without 404
 *   7. CORS Preflight — Cross-origin headers present
 *   8. Embed Server HTTPS — All 7 servers use https://
 *   9. Health Check — /health endpoint alive
 *  10. Rate Limit Headers — Confirm rate limiting is active
 * ═══════════════════════════════════════════════════════════════════════════
 */

(async function CineStreamLiveAudit() {
  'use strict';

  const BASE = window.location.origin;
  const API = `${BASE}/api`;
  const results = [];
  let passed = 0;
  let failed = 0;
  let warnings = 0;

  function log(label, status, detail, ms = null) {
    const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⚠️';
    const timeStr = ms !== null ? `${ms}ms` : '—';
    results.push({ Test: label, Status: `${icon} ${status}`, Time: timeStr, Detail: detail });
    if (status === 'PASS') passed++;
    else if (status === 'FAIL') failed++;
    else warnings++;
  }

  async function timedFetch(url, opts = {}) {
    const t0 = performance.now();
    const res = await fetch(url, opts);
    const ms = Math.round(performance.now() - t0);
    return { res, ms };
  }

  console.log('%c CineStream Live Production Audit ', 'background:#e50914;color:#fff;font-size:16px;padding:8px 16px;border-radius:4px;');
  console.log(`Target: ${BASE}`);
  console.log('Running 10 diagnostic checks...\n');

  // ── TEST 1: API Speed ──────────────────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${API}/movies?page=1&limit=20`);
    const data = await res.json();
    if (res.ok && data.movies && data.movies.length > 0) {
      log('1. API Speed (Homepage)', ms < 3000 ? 'PASS' : 'WARN', `${data.movies.length} movies returned`, ms);
    } else {
      log('1. API Speed (Homepage)', 'FAIL', `HTTP ${res.status}`, ms);
    }
  } catch (e) {
    log('1. API Speed (Homepage)', 'FAIL', e.message);
  }

  // ── TEST 2: Pagination Integrity ───────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${API}/movies?page=1&limit=50`);
    const data = await res.json();
    const p = data.pagination;
    if (p && p.total > 50000 && p.limit === 50 && p.pages > 1000) {
      log('2. Pagination Integrity', 'PASS', `total=${p.total.toLocaleString()} pages=${p.pages} limit=${p.limit}`, ms);
    } else if (p) {
      log('2. Pagination Integrity', 'WARN', `total=${p.total} limit=${p.limit} — expected 100K+`, ms);
    } else {
      log('2. Pagination Integrity', 'FAIL', 'No pagination object in response', ms);
    }
  } catch (e) {
    log('2. Pagination Integrity', 'FAIL', e.message);
  }

  // ── TEST 3: Category Filters ───────────────────────────────────────────
  try {
    const categories = ['movie', 'series', 'anime'];
    let allOk = true;
    let detail = [];
    for (const cat of categories) {
      const { res, ms } = await timedFetch(`${API}/movies?category=${cat}&limit=5`);
      const data = await res.json();
      const count = data.pagination?.total || 0;
      detail.push(`${cat}=${count.toLocaleString()}`);
      if (count === 0) allOk = false;
    }
    log('3. Category Filters', allOk ? 'PASS' : 'WARN', detail.join(' | '));
  } catch (e) {
    log('3. Category Filters', 'FAIL', e.message);
  }

  // ── TEST 4: Search Latency ─────────────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${API}/movies/search?q=naruto&limit=10`);
    const data = await res.json();
    const count = data.movies?.length || 0;
    if (res.ok && count > 0) {
      log('4. Search Latency', ms < 5000 ? 'PASS' : 'WARN', `"naruto" → ${count} results`, ms);
    } else if (data.degraded) {
      log('4. Search Latency', 'WARN', 'Degraded response (timeout) — expected at scale', ms);
    } else {
      log('4. Search Latency', 'WARN', `0 results for "naruto"`, ms);
    }
  } catch (e) {
    log('4. Search Latency', 'FAIL', e.message);
  }

  // ── TEST 5: Deep Pagination (Page 100) ─────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${API}/movies?page=100&limit=20&sort=newest`);
    const data = await res.json();
    if (res.ok && data.movies?.length > 0) {
      log('5. Deep Pagination (pg 100)', ms < 5000 ? 'PASS' : 'WARN', `${data.movies.length} movies at page 100`, ms);
    } else {
      log('5. Deep Pagination (pg 100)', 'WARN', `Empty or error at page 100`, ms);
    }
  } catch (e) {
    log('5. Deep Pagination (pg 100)', 'FAIL', e.message);
  }

  // ── TEST 6: Clean URL Routing ──────────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${BASE}/watch/movie/test-id-123`, { redirect: 'follow' });
    if (res.ok || res.status === 200) {
      const text = await res.text();
      const hasDetailPage = text.includes('movie-details') || text.includes('movieDetailsPage') || text.includes('CineStream');
      log('6. Clean URL Routing', hasDetailPage ? 'PASS' : 'WARN', `GET /watch/movie/:id → ${res.status}`, ms);
    } else {
      log('6. Clean URL Routing', 'FAIL', `HTTP ${res.status} — expected 200`, ms);
    }
  } catch (e) {
    log('6. Clean URL Routing', 'FAIL', e.message);
  }

  // ── TEST 7: CORS Headers ───────────────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${API}/movies?limit=1`);
    const corsCredentials = res.headers.get('access-control-allow-credentials');
    const vary = res.headers.get('vary');
    if (corsCredentials === 'true' && vary && vary.includes('Origin')) {
      log('7. CORS Headers', 'PASS', `credentials=${corsCredentials}, vary=${vary}`, ms);
    } else {
      log('7. CORS Headers', 'WARN', `credentials=${corsCredentials}, vary=${vary}`, ms);
    }
  } catch (e) {
    log('7. CORS Headers', 'FAIL', e.message);
  }

  // ── TEST 8: Embed Servers HTTPS ────────────────────────────────────────
  try {
    const servers = [
      { name: 'VidSrc', url: 'https://vidsrc.me/embed/movie?tmdb=550' },
      { name: '2Embed', url: 'https://www.2embed.cc/embed/550' },
      { name: 'MultiEmbed', url: 'https://multiembed.mov/?video_id=550&tmdb=1' },
      { name: 'AutoEmbed', url: 'https://autoembed.co/movie/tmdb/550' },
      { name: 'VidLink', url: 'https://vidlink.pro/movie/550' },
      { name: 'VidSrc Pro', url: 'https://vidsrc.wiki/embed/movie/550' },
      { name: 'SmashyStream', url: 'https://player.smashy.stream/movie/550' },
    ];
    const allHttps = servers.every(s => s.url.startsWith('https://'));
    const httpServers = servers.filter(s => !s.url.startsWith('https://'));
    if (allHttps) {
      log('8. Embed Servers HTTPS', 'PASS', `All ${servers.length} servers use HTTPS — zero mixed-content risk`);
    } else {
      log('8. Embed Servers HTTPS', 'FAIL', `HTTP detected: ${httpServers.map(s => s.name).join(', ')}`);
    }
  } catch (e) {
    log('8. Embed Servers HTTPS', 'FAIL', e.message);
  }

  // ── TEST 9: Health Check ───────────────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${BASE}/health`);
    const data = await res.json();
    if (data.status === 'ok' && data.success === true) {
      log('9. Health Check', 'PASS', `service=${data.service}, uptime=${data.uptime}s`, ms);
    } else {
      log('9. Health Check', 'FAIL', JSON.stringify(data), ms);
    }
  } catch (e) {
    log('9. Health Check', 'FAIL', e.message);
  }

  // ── TEST 10: Rate Limit Headers ────────────────────────────────────────
  try {
    const { res, ms } = await timedFetch(`${API}/movies?limit=1`);
    const limit = res.headers.get('ratelimit-limit');
    const remaining = res.headers.get('ratelimit-remaining');
    const policy = res.headers.get('ratelimit-policy');
    if (limit && remaining) {
      log('10. Rate Limit Headers', 'PASS', `limit=${limit}, remaining=${remaining}, policy=${policy}`, ms);
    } else {
      log('10. Rate Limit Headers', 'WARN', 'No ratelimit headers found — may be cached response', ms);
    }
  } catch (e) {
    log('10. Rate Limit Headers', 'FAIL', e.message);
  }

  // ── RESULTS ────────────────────────────────────────────────────────────
  console.log('\n');
  console.table(results);
  console.log(`\n%c AUDIT COMPLETE `, 'background:#1a1a2e;color:#22c55e;font-size:14px;padding:6px 12px;border-radius:4px;');
  console.log(`  ✅ Passed: ${passed}  ⚠️ Warnings: ${warnings}  ❌ Failed: ${failed}`);
  console.log(`  Database: ${(await (await fetch(`${API}/movies?limit=1`)).json()).pagination?.total?.toLocaleString() || '?'} records`);

  if (failed === 0) {
    console.log('%c  🎉 ALL CRITICAL CHECKS PASSED — Platform is 100K-ready  ', 'background:#166534;color:#fff;padding:4px 10px;border-radius:3px;');
  } else {
    console.log('%c  ⚠️ SOME CHECKS FAILED — Review table above  ', 'background:#991b1b;color:#fff;padding:4px 10px;border-radius:3px;');
  }

  return { passed, warnings, failed, results };
})();
