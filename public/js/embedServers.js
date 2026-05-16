/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CINE STREAM — Global Master Hydra Multi-Server System
 * Supports Western Movies, TV Series, Anime & Asian Dramas
 * Smart routing: Standard TMDB servers vs Anime Specialist (AniList) servers
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EmbedServers = (() => {

  // ═══════════════════════════════════════════════════════════════════════════
  // STANDARD SERVERS — For Movies & TV (requires tmdb_id)
  // Ordered by VERIFIED reliability (May 2026 live testing)
  // ═══════════════════════════════════════════════════════════════════════════
  const STANDARD_SERVERS = {
    // Priority 1 — VidLink: CONFIRMED WORKING — loads actual video player
    vidlink: {
      name: 'VidLink',
      key: 'vidlink',
      priority: 1,
      sandboxPolicy: 'none',  // VidLink rejects any sandbox attribute
      movieUrl: (tmdbId) => `https://vidlink.pro/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`,
      timeout: 9000,
    },
    // Priority 2 — Videasy (vidsrc.cc): VERIFIED ALIVE — returns full player
    videasy: {
      name: 'Videasy',
      key: 'videasy',
      priority: 2,
      sandboxPolicy: 'none',
      movieUrl: (tmdbId) => `https://vidsrc.cc/v2/embed/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidsrc.cc/v2/embed/tv/${tmdbId}/${season}/${episode}`,
      timeout: 9000,
    },
    // Priority 3 — VidSrc.io: VERIFIED ALIVE — returns correct movie title, supports tmdb param
    vidsrcio: {
      name: 'VidSrc IO',
      key: 'vidsrcio',
      priority: 3,
      sandboxPolicy: 'none',
      movieUrl: (tmdbId) => `https://vidsrc.io/embed/movie?tmdb=${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidsrc.io/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}`,
      timeout: 9000,
    },
    // Priority 4 — VidSrc.icu: VERIFIED ALIVE — returns player page
    vidsrcicu: {
      name: 'VidSrc ICU',
      key: 'vidsrcicu',
      priority: 4,
      sandboxPolicy: 'none',
      movieUrl: (tmdbId) => `https://vidsrc.icu/embed/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidsrc.icu/embed/tv/${tmdbId}/${season}/${episode}`,
      timeout: 9000,
    },
    // Priority 5 — 2Embed: ALIVE but needs sandbox:'none' to avoid "Sandbox Detected" error
    embed2: {
      name: '2Embed',
      key: 'embed2',
      priority: 5,
      sandboxPolicy: 'none',
      movieUrl: (tmdbId) => `https://www.2embed.cc/embed/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`,
      timeout: 8000,
    },
    // Priority 6 — VidSrc.to: VERIFIED ALIVE — robust player via vsembed.ru backend
    vidsrc: {
      name: 'VidSrc',
      key: 'vidsrc',
      priority: 6,
      sandboxPolicy: 'none',
      movieUrl: (tmdbId) => `https://vidsrc.to/embed/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`,
      timeout: 9000,
    },
    // Priority 7 — VidNest: VERIFIED WORKING (May 2026) — supports movies, TV, AND anime via TMDB
    vidnest: {
      name: 'VidNest',
      key: 'vidnest_std',
      priority: 7,
      sandboxPolicy: 'none',
      movieUrl: (tmdbId) => `https://vidnest.fun/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidnest.fun/tv/${tmdbId}/${season}/${episode}`,
      timeout: 10000,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME SPECIALIST SERVERS — For Anime (requires anilist_id)
  // ⚠️ DEMOTED (May 2026): These anilist-id-based endpoints have become unstable.
  // The TMDB-id-based STANDARD_SERVERS work reliably for anime that have a tmdbId.
  // We keep these as last-resort fallback (priority 100+) for anime that lack
  // a tmdbId, but for the vast majority of anime, STANDARD_SERVERS render first.
  // ═══════════════════════════════════════════════════════════════════════════
  const ANIME_SERVERS = {
    // Priority 100 — VidNest: VERIFIED WORKING (May 2026) — dedicated anime embed
    // with AnimePahe backend. Accepts anilist_id + episode + sub/dub.
    vidnest: {
      name: 'VidNest Anime',
      key: 'vidnest',
      priority: 100,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://vidnest.fun/anime/${anilistId}/${episodeNumber}/sub`,
      timeout: 10000,
    },
    // Priority 101 — VidNest AnimePahe: alternate backend for broader coverage
    vidnestpahe: {
      name: 'VidNest Pahe',
      key: 'vidnestpahe',
      priority: 101,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://vidnest.fun/animepahe/${anilistId}/${episodeNumber}/sub`,
      timeout: 10000,
    },
    // Priority 102 — Anime VidSrc (vidsrc.cc): UNRELIABLE — vidsrc.cc states
    // "Currently we do not support anime" on their homepage. Kept as last resort.
    animevidsrc: {
      name: 'Anime VidSrc',
      key: 'animevidsrc',
      priority: 102,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://vidsrc.cc/v2/embed/tv/${anilistId}/${1}/${episodeNumber}?anilist=true`,
      timeout: 9000,
    },
    // Priority 103 — Anime 2Embed: HiAnime backend is dead post-Crunchyroll takedown
    anime2embed: {
      name: 'Anime 2Embed',
      key: 'anime2embed',
      priority: 103,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://www.2embed.cc/embedanime/anilist-${anilistId}&ep=${episodeNumber}`,
      timeout: 9000,
    },
    // Priority 104 — Anime VidSrc.to: Occasionally works but inconsistent
    animevidsrcto: {
      name: 'Anime VidSrc.to',
      key: 'animevidsrcto',
      priority: 104,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://vidsrc.to/embed/anime/anilist/${anilistId}/${episodeNumber}`,
      timeout: 9000,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════
  let serverStatus = {};

  // MongoDB-fetch mode (Task 10.1, Requirement 21).
  //
  // `loadFromMongoDB()` is opt-in: pages that want admin-controlled
  // server config call `EmbedServers.loadFromMongoDB()` early in their
  // boot. On success, the STANDARD_SERVERS / ANIME_SERVERS objects are
  // mutated in place to reflect the MongoDB-stored documents, so every
  // existing call site (`buildHydraSources`, `canPlay`, `getServerList`,
  // etc.) automatically picks up the new list with NO source changes.
  //
  // On failure (network error, non-2xx, empty list) we log a warning
  // and continue with the hardcoded list silently — the player must
  // never break because of a config-fetch failure (Requirement 21.5
  // graceful-fallback intent).
  //
  // `_mongoLoadPromise` deduplicates concurrent calls so multiple
  // initialisers in the same page don't fire multiple HTTP requests.
  let _isLoadedFromMongo = false;
  let _mongoLoadPromise  = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // URL PATTERN SUBSTITUTION
  // Mirrors backend/services/serverHealthService.js so the same `{tmdbId}`,
  // `{season}`, `{episode}`, `{anilistId}` placeholders work both server-
  // side (health probes) and client-side (player URLs). Missing variables
  // substitute as the empty string rather than throwing — keeps the player
  // resilient when a partially populated movie record reaches this layer.
  // ═══════════════════════════════════════════════════════════════════════════
  function substitutePattern(pattern, vars) {
    if (typeof pattern !== 'string') return '';
    const v = vars || {};
    return pattern
      .split('{tmdbId}').join(String(v.tmdbId    != null ? v.tmdbId    : ''))
      .split('{season}').join(String(v.season    != null ? v.season    : ''))
      .split('{episode}').join(String(v.episode  != null ? v.episode   : ''))
      .split('{anilistId}').join(String(v.anilistId != null ? v.anilistId : ''));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LOAD FROM MONGODB (opt-in MongoDB-driven config — Requirement 21.1–21.3)
  // ───────────────────────────────────────────────────────────────────────────
  // Fetches the enabled server list from `GET /api/admin/servers/public`
  // (a dedicated public endpoint that returns only safe fields) and rebuilds
  // STANDARD_SERVERS and ANIME_SERVERS in place. Idempotent and dedupe-safe.
  //
  // Why mutate in place instead of replacing the references?
  //   The two collection objects are captured by closure inside this IIFE
  //   AND exported on the public API surface (`EmbedServers.STANDARD_SERVERS`).
  //   Reassigning the locals would leave the exported reference dangling.
  //   Clearing keys + assigning new ones keeps every existing reference live.
  //
  // Returns: Promise<boolean> — true on successful load, false on any
  //          fallback path (so callers can branch UI if they care).
  // ═══════════════════════════════════════════════════════════════════════════
  async function loadFromMongoDB() {
    // Dedupe concurrent calls — first caller wins, every later caller
    // awaits the same promise. After resolution the cached promise is
    // kept around so subsequent calls become a cheap no-op via the
    // `_isLoadedFromMongo` short-circuit on the next call.
    if (_mongoLoadPromise) return _mongoLoadPromise;

    _mongoLoadPromise = (async () => {
      // Resolve API base. `API_BASE` is set globally by config.js on every
      // page that uses this module; fall back to the relative `/api` so
      // the function still works if loaded standalone.
      const apiBase = (typeof window !== 'undefined' && (window.API_BASE
        || (window.__APP_CONFIG && window.__APP_CONFIG.apiBase))) || '/api';

      try {
        const response = await fetch(`${apiBase}/admin/servers/public`, {
          method:  'GET',
          headers: { Accept: 'application/json' },
          // No credentials needed — endpoint is intentionally public so
          // anonymous viewers can load admin-controlled server configs.
          credentials: 'omit',
        });

        if (!response.ok) {
          console.warn(
            '[EmbedServers] loadFromMongoDB: HTTP',
            response.status,
            '— continuing with hardcoded server list',
          );
          return false;
        }

        const payload = await response.json();
        // sendSuccess() wraps the payload as { success, servers, ... }.
        // Accept either the wrapped shape or a bare { servers } for
        // forward-compat with future response shapes.
        const servers = (payload && Array.isArray(payload.servers))
          ? payload.servers
          : (payload && payload.data && Array.isArray(payload.data.servers))
            ? payload.data.servers
            : null;

        if (!Array.isArray(servers) || servers.length === 0) {
          console.warn(
            '[EmbedServers] loadFromMongoDB: empty server list — continuing with hardcoded server list',
          );
          return false;
        }

        // ----- Build the new pools off to the side first -------------
        // We deliberately do NOT mutate STANDARD_SERVERS / ANIME_SERVERS
        // until we've confirmed the response actually produces at least
        // one usable entry. Otherwise a malformed response (entries
        // present but every one missing a `key` or `type`) would leave
        // the player with empty pools — worse than the hardcoded fallback.
        const nextStandard = {};
        const nextAnime    = {};

        for (const s of servers) {
          if (!s || typeof s.key !== 'string' || !s.key.trim()) continue;

          // Each entry mirrors the legacy hardcoded shape so downstream
          // builders (`buildHydraSources`, etc.) need no changes.
          const entry = {
            name:          String(s.name || s.key),
            key:           s.key,
            priority:      Number.isFinite(s.priority) ? s.priority : 999,
            sandboxPolicy: s.sandboxPolicy || 'none',
            timeout:       Number.isFinite(s.timeout) ? s.timeout : 9000,
          };

          if (s.type === 'standard') {
            // Closure captures the pattern strings — substitution is
            // deferred until the URL is actually requested.
            if (typeof s.movieUrlPattern === 'string' && s.movieUrlPattern) {
              const movieP = s.movieUrlPattern;
              entry.movieUrl = (tmdbId) => substitutePattern(movieP, { tmdbId });
            } else {
              // Always provide the function so call sites that don't
              // bother with category detection don't crash.
              entry.movieUrl = () => null;
            }
            if (typeof s.tvUrlPattern === 'string' && s.tvUrlPattern) {
              const tvP = s.tvUrlPattern;
              entry.tvUrl = (tmdbId, season, episode) =>
                substitutePattern(tvP, { tmdbId, season, episode });
            } else {
              entry.tvUrl = () => null;
            }
            nextStandard[s.key] = entry;
          } else if (s.type === 'anime') {
            if (typeof s.animeUrlPattern === 'string' && s.animeUrlPattern) {
              const animeP = s.animeUrlPattern;
              entry.animeUrl = (anilistId, episode) =>
                substitutePattern(animeP, { anilistId, episode });
            } else {
              entry.animeUrl = () => null;
            }
            nextAnime[s.key] = entry;
          }
          // Unknown `type` values are silently ignored — forward-compat
          // for any future server categories the backend may introduce.
        }

        const standardCount = Object.keys(nextStandard).length;
        const animeCount    = Object.keys(nextAnime).length;

        if (standardCount === 0 && animeCount === 0) {
          // The response had entries but none were usable. Leave the
          // hardcoded pools untouched so the player keeps working.
          console.warn(
            '[EmbedServers] loadFromMongoDB: response had no usable servers — continuing with hardcoded server list',
          );
          return false;
        }

        // ----- Commit: mutate the live pools in place ---------------
        // Now that we've validated the new pools are non-empty, swap
        // them into the exported objects. We mutate (not reassign)
        // because the references are captured by closure throughout
        // the rest of this module AND exposed on `EmbedServers.STANDARD_SERVERS`.
        Object.keys(STANDARD_SERVERS).forEach((k) => { delete STANDARD_SERVERS[k]; });
        Object.keys(ANIME_SERVERS).forEach((k)    => { delete ANIME_SERVERS[k];    });
        Object.assign(STANDARD_SERVERS, nextStandard);
        Object.assign(ANIME_SERVERS,    nextAnime);

        _isLoadedFromMongo = true;
        // Use info-level so admins can verify in DevTools that the
        // MongoDB-driven config actually took effect on the page.
        console.info(
          '[EmbedServers] Loaded from MongoDB:',
          standardCount, 'standard /', animeCount, 'anime servers',
        );
        return true;
      } catch (error) {
        // Network failure, CORS, JSON parse error, etc. The hardcoded
        // STANDARD_SERVERS/ANIME_SERVERS were never touched in this
        // path, so the player continues to work without code changes.
        console.warn(
          '[EmbedServers] loadFromMongoDB failed:',
          (error && error.message) || error,
          '— continuing with hardcoded server list',
        );
        // Reset the dedupe latch so a subsequent retry (e.g., user
        // reconnects) can attempt the load again.
        _mongoLoadPromise = null;
        return false;
      }
    })();

    return _mongoLoadPromise;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DETECT MEDIA CATEGORY
  // Returns: 'anime' | 'tv' | 'movie'
  // ═══════════════════════════════════════════════════════════════════════════
  function detectCategory(movieData) {
    const category = String(movieData?.category || movieData?.provider || '').toLowerCase();
    if (category === 'anime' || category === 'anilist') return 'anime';
    if (['series', 'tv', 'cartoon', 'k-drama', 'asian-drama', 'asian_drama'].includes(category)) return 'tv';
    if (Number(movieData?.totalEpisodes || 0) > 1) return 'tv';
    return 'movie';
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GENERATE EMBED URL (CORE ROUTING FUNCTION)
  // Evaluates movieData.category and routes to the correct server type.
  // Returns null (silently filtered) if a required ID is missing.
  // ═══════════════════════════════════════════════════════════════════════════
  function generateEmbedUrl(server, movieData, season = 1, episode = 1) {
    const mediaCategory = detectCategory(movieData);

    if (mediaCategory === 'anime') {
      // Route to anime specialist servers
      const animeServer = ANIME_SERVERS[server.key] || ANIME_SERVERS[server];
      if (!animeServer) return null;

      const anilistId = movieData?.anilistId || movieData?.anilist_id || movieData?.providerId || null;
      const epNum = Number(episode || 1);

      if (!anilistId) return null; // Silently filter: missing anilist_id
      return animeServer.animeUrl(anilistId, epNum);

    } else {
      // Route to standard servers (movie or TV)
      const stdServer = STANDARD_SERVERS[server.key] || STANDARD_SERVERS[server];
      if (!stdServer) return null;

      const tmdbId = movieData?.tmdbId || movieData?.tmdb_id || null;
      if (!tmdbId) return null; // Silently filter: missing tmdb_id

      if (mediaCategory === 'tv') {
        return stdServer.tvUrl(tmdbId, Number(season || 1), Number(episode || 1));
      } else {
        return stdServer.movieUrl(tmdbId);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD HYDRA SOURCES — Master source builder for a given movie/show
  // Automatically selects the correct pool (anime vs standard) and filters
  // out any server that cannot produce a valid URL for this specific title.
  // ═══════════════════════════════════════════════════════════════════════════
  function buildHydraSources(movieData, season = 1, episode = 1) {
    const mediaCategory = detectCategory(movieData);
    const sources = [];

    if (mediaCategory === 'anime') {
      // Anime routing strategy (May 2026 verified):
      //   1. STANDARD_SERVERS first (tmdb_id-based) — these work reliably for anime
      //      because TMDB indexes most anime as TV shows.
      //   2. ANIME_SERVERS as fallback (anilist_id-based) — last resort.
      const tmdbId = movieData?.tmdbId || movieData?.tmdb_id || null;
      const anilistId = movieData?.anilistId || movieData?.anilist_id || movieData?.providerId || null;

      // Pass 1: TMDB-id-based standard TV servers
      if (tmdbId) {
        Object.values(STANDARD_SERVERS).forEach((server) => {
          const url = server.tvUrl(tmdbId, Number(season || 1), Number(episode || 1));
          if (!url) return;

          sources.push({
            id: `hydra-anime-tv-${server.key}`,
            server: server.key,
            serverName: server.name,
            label: `Server ${sources.length + 1}`,
            priority: server.priority,
            url,
            embedUrl: url,
            playUrl: '',
            quality: 'Auto',
            isExternal: true,
            isEmbed: true,
            isAnime: true,
            timeout: server.timeout,
            sandboxPolicy: server.sandboxPolicy || 'balanced',
            status: serverStatus[server.key] || 'unknown',
            statusLabel: `Server ${sources.length + 1} • ${server.name}`,
            sourceType: server.key,
          });
        });
      }

      // Pass 2: Anime-specialist anilist-id servers (fallback only)
      if (anilistId) {
        Object.values(ANIME_SERVERS).forEach((server) => {
          const url = server.animeUrl(anilistId, Number(episode || 1));
          if (!url) return;

          sources.push({
            id: `hydra-anime-${server.key}`,
            server: server.key,
            serverName: server.name,
            label: `Server ${sources.length + 1}`,
            priority: server.priority,
            url,
            embedUrl: url,
            playUrl: '',
            quality: 'Auto',
            isExternal: true,
            isEmbed: true,
            isAnime: true,
            timeout: server.timeout,
            sandboxPolicy: server.sandboxPolicy || 'balanced',
            status: serverStatus[server.key] || 'unknown',
            statusLabel: `Server ${sources.length + 1} • ${server.name}`,
            sourceType: server.key,
          });
        });
      }

    } else {
      // Standard content — movies & TV (Western, Asian Drama, etc.)
      const tmdbId = movieData?.tmdbId || movieData?.tmdb_id || null;

      Object.values(STANDARD_SERVERS).forEach((server) => {
        if (!tmdbId) return; // Silently skip: no tmdb_id
        let url;
        if (mediaCategory === 'tv') {
          url = server.tvUrl(tmdbId, Number(season || 1), Number(episode || 1));
        } else {
          url = server.movieUrl(tmdbId);
        }
        if (!url) return;

        sources.push({
          id: `hydra-std-${server.key}`,
          server: server.key,
          serverName: server.name,
          label: `Server ${sources.length + 1}`,
          priority: server.priority,
          url,
          embedUrl: url,
          playUrl: '',
          quality: 'Auto',
          isExternal: true,
          isEmbed: true,
          timeout: server.timeout,
          sandboxPolicy: server.sandboxPolicy || 'balanced',
          status: serverStatus[server.key] || 'unknown',
          statusLabel: `Server ${sources.length + 1} • ${server.name}`,
          sourceType: server.key,
        });
      });
    }

    // Sort by priority (lower = higher priority)
    return sources.sort((a, b) => a.priority - b.priority);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // LEGACY COMPAT: buildAllSources (used by VideoEngine fallback)
  // ═══════════════════════════════════════════════════════════════════════════
  function buildAllSources(tmdbId, type = 'movie', season = 1, episode = 1) {
    const movieData = {
      tmdbId,
      tmdb_id: tmdbId,
      category: type === 'tv' ? 'series' : 'movie',
    };
    return buildHydraSources(movieData, season, episode);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET EMBED URL FOR A SPECIFIC SERVER (legacy compat)
  // ═══════════════════════════════════════════════════════════════════════════
  function getEmbedUrl(serverKey, tmdbId, type = 'movie', season = 1, episode = 1) {
    const server = STANDARD_SERVERS[serverKey];
    if (!server || !tmdbId) return null;
    return type === 'movie'
      ? server.movieUrl(tmdbId)
      : server.tvUrl(tmdbId, season, episode);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVER STATUS MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════
  function markServerStatus(serverKey, status) {
    serverStatus[serverKey] = status;
  }

  function resetServerStatuses() {
    serverStatus = {};
    const allServers = { ...STANDARD_SERVERS, ...ANIME_SERVERS };
    Object.keys(allServers).forEach(key => {
      serverStatus[key] = 'unknown';
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET BEST SERVER WITH FAILOVER
  // ═══════════════════════════════════════════════════════════════════════════
  function getBestServer(sources, excludeFailed = true) {
    if (!sources || !sources.length) return null;
    const available = excludeFailed
      ? sources.filter(s => s.status !== 'failed')
      : sources;
    return available.length ? available[0] : sources[0];
  }

  function getNextServer(sources, currentKey) {
    if (!sources || !sources.length) return null;
    const currentIndex = sources.findIndex(s => s.server === currentKey);
    if (currentIndex === -1) return sources[0];
    for (let i = currentIndex + 1; i < sources.length; i++) {
      if (sources[i].status !== 'failed') return sources[i];
    }
    for (let i = 0; i < currentIndex; i++) {
      if (sources[i].status !== 'failed') return sources[i];
    }
    return sources[currentIndex];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // IFRAME SANDBOX ATTRIBUTES — Balanced security
  // ALLOWS: scripts, same-origin, forms, popups (embed player UIs need this),
  //         popups-to-escape-sandbox, presentation (fullscreen)
  // BLOCKS: allow-top-navigation (forced page redirect — the real threat)
  //         allow-downloads (drive-by download prevention)
  // ═══════════════════════════════════════════════════════════════════════════
  function getIframeAttributes() {
    return {
      sandbox: 'allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-top-navigation-by-user-activation',
      allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture; gyroscope; accelerometer',
      referrerPolicy: 'no-referrer',
      loading: 'eager',
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER SERVER SELECTOR UI
  // Generates a horizontal row of "Server 1", "Server 2"... buttons
  // beneath the video player. Active server is highlighted.
  // ═══════════════════════════════════════════════════════════════════════════
  function renderServerSelector(sources, activeKey, onSwitch) {
    if (!sources || sources.length < 1) return '';

    const buttons = sources.map((source, idx) => {
      const isActive = source.server === activeKey;
      const isFailed = source.status === 'failed';
      const isWorking = source.status === 'working';
      const statusColor = isFailed ? '#ef4444' : isWorking ? '#22c55e' : '#fbbf24';
      const labelNum = idx + 1;

      return `
        <button
          class="hydra-srv-btn ${isActive ? 'hydra-srv-active' : ''} ${isFailed ? 'hydra-srv-failed' : ''}"
          data-server="${source.server}"
          data-index="${idx}"
          id="hydraSrvBtn${labelNum}"
          title="${source.serverName}${isFailed ? ' (Failed)' : ''}"
          style="
            padding: 7px 18px;
            border: 1.5px solid ${isActive ? 'var(--accent, #e50914)' : 'rgba(255,255,255,0.18)'};
            background: ${isActive ? 'linear-gradient(135deg, var(--accent, #e50914), #c40812)' : 'rgba(255,255,255,0.04)'};
            color: ${isActive ? '#fff' : 'rgba(255,255,255,0.75)'};
            border-radius: 8px;
            cursor: ${isFailed ? 'not-allowed' : 'pointer'};
            font-size: 12.5px;
            font-weight: ${isActive ? '600' : '500'};
            letter-spacing: 0.3px;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 7px;
            opacity: ${isFailed ? '0.45' : '1'};
            box-shadow: ${isActive ? '0 2px 12px rgba(229,9,20,0.35)' : 'none'};
          "
          ${isFailed ? 'disabled' : ''}
        >
          <span style="
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: ${statusColor};
            flex-shrink: 0;
            box-shadow: 0 0 5px ${statusColor}88;
          "></span>
          Server ${labelNum}
          ${isFailed ? '<span style="font-size:10px;letter-spacing:0.5px;opacity:0.8;">SKIP</span>' : ''}
        </button>
      `;
    }).join('');

    return `
      <div class="hydra-server-row" style="
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        align-items: center;
        padding: 10px 14px;
        background: rgba(0,0,0,0.45);
        border-radius: 10px;
        margin-top: 10px;
        backdrop-filter: blur(8px);
        border: 1px solid rgba(255,255,255,0.07);
      ">
        <span style="
          color: rgba(255,255,255,0.45);
          font-size: 11.5px;
          font-weight: 600;
          letter-spacing: 1px;
          text-transform: uppercase;
          margin-right: 4px;
          align-self: center;
        ">Servers</span>
        ${buttons}
      </div>
      <style>
        .hydra-srv-btn:hover:not(.hydra-srv-active):not([disabled]) {
          border-color: rgba(255,255,255,0.35) !important;
          background: rgba(255,255,255,0.09) !important;
          color: #fff !important;
          transform: translateY(-1px);
        }
        .hydra-srv-btn:active:not([disabled]) {
          transform: translateY(0);
        }
        .hydra-srv-failed {
          text-decoration: line-through;
        }
      </style>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TV SHOW CONTROLS (Season/Episode Selectors)
  // ═══════════════════════════════════════════════════════════════════════════
  function renderTvControls(seasons = [], currentS = 1, currentE = 1) {
    const seasonOptions = seasons.map(s =>
      `<option value="${s.number}" ${s.number === currentS ? 'selected' : ''}>Season ${s.number}</option>`
    ).join('');

    const currentSeason = seasons.find(s => s.number === currentS);
    const episodeCount = currentSeason?.episodes || 1;
    const episodeOptions = Array.from({ length: episodeCount }, (_, i) => {
      const ep = i + 1;
      return `<option value="${ep}" ${ep === currentE ? 'selected' : ''}>Episode ${ep}</option>`;
    }).join('');

    return `
      <div class="tv-controls" style="
        display: flex;
        gap: 16px;
        align-items: center;
        padding: 12px;
        background: rgba(0,0,0,0.4);
        border-radius: 8px;
        margin-bottom: 12px;
        flex-wrap: wrap;
      ">
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="color: rgba(255,255,255,0.6); font-size: 13px;">Season:</label>
          <select id="seasonSelect" style="
            padding: 6px 12px;
            background: #1a1a2e;
            border: 1px solid rgba(255,255,255,0.2);
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
          ">
            ${seasonOptions}
          </select>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <label style="color: rgba(255,255,255,0.6); font-size: 13px;">Episode:</label>
          <select id="episodeSelect" style="
            padding: 6px 12px;
            background: #1a1a2e;
            border: 1px solid rgba(255,255,255,0.2);
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 13px;
          ">
            ${episodeOptions}
          </select>
        </div>
        <button id="goEpisodeBtn" style="
          padding: 6px 16px;
          background: var(--accent, #e50914);
          color: #fff;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        ">Go</button>
      </div>
    `;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CAN PLAY — quick check used by listings to filter out unplayable items
  // Returns true if the item has at least one valid embed source path:
  //   - a tmdb_id (works with all 6 STANDARD_SERVERS), OR
  //   - an anilist_id (works with all 3 ANIME_SERVERS), OR
  //   - a videoUrl/uploaded sources array (covered upstream by the player).
  // ═══════════════════════════════════════════════════════════════════════════
  function canPlay(movieData) {
    if (!movieData) return false;
    const hasTmdb = !!(movieData.tmdbId || movieData.tmdb_id);
    const hasAnilist = !!(movieData.anilistId || movieData.anilist_id || movieData.providerId);
    const hasVideoUrl = !!String(movieData.videoUrl || '').trim();
    const hasUploadedSources = Array.isArray(movieData.sources) && movieData.sources.some(s => String(s?.url || '').trim());
    return hasTmdb || hasAnilist || hasVideoUrl || hasUploadedSources;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET SERVER LIST (for display)
  // ═══════════════════════════════════════════════════════════════════════════
  function getServerList() {
    const all = { ...STANDARD_SERVERS, ...ANIME_SERVERS };
    return Object.entries(all).map(([key, server]) => ({
      key,
      name: server.name,
      priority: server.priority,
      type: ANIME_SERVERS[key] ? 'anime' : 'standard',
    }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPOSED API
  // ═══════════════════════════════════════════════════════════════════════════
  return {
    // Server configs (read-only access)
    STANDARD_SERVERS,
    ANIME_SERVERS,
    // Legacy compat
    SERVERS: { ...STANDARD_SERVERS },
    // Core routing
    generateEmbedUrl,
    detectCategory,
    canPlay,
    // Source builders
    buildHydraSources,
    buildAllSources,      // legacy compat for VideoEngine
    getEmbedUrl,          // legacy compat
    // Server management
    getBestServer,
    getNextServer,
    markServerStatus,
    resetServerStatuses,
    // UI
    getIframeAttributes,
    renderServerSelector,
    renderTvControls,
    getServerList,
    // MongoDB-driven config (Task 10.1, Requirements 21.1–21.3)
    //   • loadFromMongoDB()    — opt-in async loader; mutates the
    //                            STANDARD_SERVERS/ANIME_SERVERS pools
    //                            in place on success.
    //   • isLoadedFromMongo()  — read-only flag the caller can use to
    //                            branch UI (e.g., "Servers managed
    //                            via admin panel" badge).
    loadFromMongoDB,
    isLoadedFromMongo: () => _isLoadedFromMongo,
  };
})();

// Make globally available
window.EmbedServers = EmbedServers;
