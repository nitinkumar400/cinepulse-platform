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
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME SPECIALIST SERVERS — For Anime (requires anilist_id)
  // Updated May 2026: Replaced dead domains (autoembed.cc, player.smashy.stream)
  // with verified working anime embed providers
  // ═══════════════════════════════════════════════════════════════════════════
  const ANIME_SERVERS = {
    animevidsrc: {
      name: 'Anime VidSrc',
      key: 'animevidsrc',
      priority: 1,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://vidsrc.cc/v2/embed/tv/${anilistId}/${1}/${episodeNumber}?anilist=true`,
      timeout: 9000,
    },
    anime2embed: {
      name: 'Anime 2Embed',
      key: 'anime2embed',
      priority: 2,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://www.2embed.cc/embedanime/anilist-${anilistId}&ep=${episodeNumber}`,
      timeout: 9000,
    },
    animevidsrcto: {
      name: 'Anime VidSrc.to',
      key: 'animevidsrcto',
      priority: 3,
      sandboxPolicy: 'none',
      animeUrl: (anilistId, episodeNumber) => `https://vidsrc.to/embed/anime/anilist/${anilistId}/${episodeNumber}`,
      timeout: 9000,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════
  let serverStatus = {};

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
      // Use anime specialist servers
      const anilistId = movieData?.anilistId || movieData?.anilist_id || movieData?.providerId || null;

      Object.values(ANIME_SERVERS).forEach((server, idx) => {
        if (!anilistId) return; // Silently skip entire pool
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

      // Anime fallback: ALWAYS add standard TV servers if tmdb_id exists
      // (both when anilist_id is missing AND as additional fallback when it exists)
      const tmdbId = movieData?.tmdbId || movieData?.tmdb_id || null;
      if (tmdbId) {
        Object.values(STANDARD_SERVERS).forEach((server) => {
          const url = server.tvUrl(tmdbId, Number(season || 1), Number(episode || 1));
          if (!url) return;

          sources.push({
            id: `hydra-std-${server.key}`,
            server: server.key,
            serverName: server.name,
            label: `Server ${sources.length + 1}`,
            priority: server.priority + 10,
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
  };
})();

// Make globally available
window.EmbedServers = EmbedServers;
