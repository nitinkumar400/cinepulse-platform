/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CINE STREAM — Multi-Server Auto-Embed System
 * Automatic video embedding with 6+ servers + smart failover
 * ═══════════════════════════════════════════════════════════════════════════
 */

const EmbedServers = (() => {
  // ═══════════════════════════════════════════════════════════════════════════
  // SERVER CONFIGURATION — 6+ Auto-Embed Providers
  // ═══════════════════════════════════════════════════════════════════════════
  const SERVERS = {
    vidsrc: {
      name: 'VidSrc',
      priority: 4,
      movieUrl: (tmdbId) => `https://vidsrc.to/embed/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidsrc.to/embed/tv/${tmdbId}/${season}/${episode}`,
      timeout: 8000,
    },
    embed2: {
      name: '2Embed',
      priority: 1,
      movieUrl: (tmdbId) => `https://www.2embed.cc/embed/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://www.2embed.cc/embedtv/${tmdbId}&s=${season}&e=${episode}`,
      timeout: 7000,
    },
    autoembed: {
      name: 'AutoEmbed',
      priority: 3,
      movieUrl: (tmdbId) => `https://autoembed.to/movie/tmdb/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://autoembed.to/tv/tmdb/${tmdbId}-${season}-${episode}`,
      timeout: 7000,
    },
    vidlink: {
      name: 'VidLink',
      priority: 5,
      movieUrl: (tmdbId) => `https://vidlink.pro/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://vidlink.pro/tv/${tmdbId}/${season}/${episode}`,
      timeout: 7000,
    },
    superembed: {
      name: 'SuperEmbed',
      priority: 2,
      movieUrl: (tmdbId) => `https://superembed.stream/movie/${tmdbId}`,
      tvUrl: (tmdbId, season, episode) => `https://superembed.stream/tv/${tmdbId}/${season}/${episode}`,
      timeout: 8000,
    },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STATE
  // ═══════════════════════════════════════════════════════════════════════════
  let currentServerKey = null;
  let currentTmdbId = null;
  let currentType = 'movie'; // 'movie' or 'tv'
  let currentSeason = 1;
  let currentEpisode = 1;
  let serverStatus = {}; // Track working/failed servers
  let autoRotateInterval = null;

  // ═══════════════════════════════════════════════════════════════════════════
  // GET EMBED URL FOR SERVER
  // ═══════════════════════════════════════════════════════════════════════════
  const getEmbedUrl = (serverKey, tmdbId, type = 'movie', season = 1, episode = 1) => {
    const server = SERVERS[serverKey];
    if (!server || !tmdbId) return null;

    return type === 'movie'
      ? server.movieUrl(tmdbId)
      : server.tvUrl(tmdbId, season, episode);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD ALL SERVER SOURCES FOR A MOVIE/TV SHOW
  // ═══════════════════════════════════════════════════════════════════════════
  const buildAllSources = (tmdbId, type = 'movie', season = 1, episode = 1) => {
    if (!tmdbId) return [];

    const sources = [];

    Object.entries(SERVERS).forEach(([key, server]) => {
      const url = getEmbedUrl(key, tmdbId, type, season, episode);
      if (url) {
        sources.push({
          id: `embed-${key}`,
          server: key,
          serverName: server.name,
          priority: server.priority,
          url: url,
          embedUrl: url,
          playUrl: '', // External embeds don't have direct play URL
          label: server.name,
          quality: 'Auto',
          isExternal: true,
          isEmbed: true,
          timeout: server.timeout,
          status: serverStatus[key] || 'unknown', // 'working', 'failed', 'unknown'
        });
      }
    });

    // Sort by priority (lower = higher priority)
    return sources.sort((a, b) => a.priority - b.priority);
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // GET BEST AVAILABLE SERVER (with failover)
  // ═══════════════════════════════════════════════════════════════════════════
  const getBestServer = (sources, excludeFailed = true) => {
    if (!sources || !sources.length) return null;

    // Filter out failed servers if requested
    const available = excludeFailed
      ? sources.filter(s => s.status !== 'failed')
      : sources;

    if (!available.length) {
      // All failed - return first one as last resort
      return sources[0];
    }

    // Return highest priority available server
    return available[0];
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // MARK SERVER STATUS
  // ═══════════════════════════════════════════════════════════════════════════
  const markServerStatus = (serverKey, status) => {
    serverStatus[serverKey] = status;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // RESET ALL SERVER STATUSES
  // ═══════════════════════════════════════════════════════════════════════════
  const resetServerStatuses = () => {
    serverStatus = {};
    Object.keys(SERVERS).forEach(key => {
      serverStatus[key] = 'unknown';
    });
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-ROTATE TO NEXT SERVER ON FAILURE
  // ═══════════════════════════════════════════════════════════════════════════
  const getNextServer = (sources, currentKey) => {
    if (!sources || !sources.length) return null;

    const currentIndex = sources.findIndex(s => s.server === currentKey);
    if (currentIndex === -1) return sources[0];

    // Try next server in priority order
    for (let i = currentIndex + 1; i < sources.length; i++) {
      if (sources[i].status !== 'failed') {
        return sources[i];
      }
    }

    // All subsequent failed - try from beginning
    for (let i = 0; i < currentIndex; i++) {
      if (sources[i].status !== 'failed') {
        return sources[i];
      }
    }

    // Everything failed - return current as last resort
    return sources[currentIndex];
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // CREATE IFRAME ATTRIBUTES FOR EMBED
  // ═══════════════════════════════════════════════════════════════════════════
  const getIframeAttributes = () => ({
    allow: 'autoplay; fullscreen; encrypted-media; picture-in-picture; clipboard-write',
    referrerPolicy: 'no-referrer',
    loading: 'eager',
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER SERVER SELECTOR UI
  // ═══════════════════════════════════════════════════════════════════════════
  const renderServerSelector = (sources, activeKey, onSwitch) => {
    if (!sources || sources.length < 2) return '';

    const buttons = sources.map(source => {
      const isActive = source.server === activeKey;
      const statusClass = source.status === 'failed' ? 'server-failed'
                        : source.status === 'working' ? 'server-working'
                        : '';

      return `
        <button
          class="server-btn ${isActive ? 'active' : ''} ${statusClass}"
          data-server="${source.server}"
          title="${source.serverName} ${source.status === 'failed' ? '(Failed)' : ''}"
          style="
            padding: 8px 16px;
            border: 1px solid ${isActive ? 'var(--accent, #e50914)' : 'rgba(255,255,255,0.2)'};
            background: ${isActive ? 'var(--accent, #e50914)' : 'transparent'};
            color: ${isActive ? '#fff' : 'rgba(255,255,255,0.8)'};
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
          "
        >
          <span class="server-indicator" style="
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: ${source.status === 'working' ? '#22c55e' : source.status === 'failed' ? '#ef4444' : '#fbbf24'};
          "></span>
          ${source.serverName}
        </button>
      `;
    }).join('');

    return `
      <div class="embed-server-selector" style="
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        padding: 12px;
        background: rgba(0,0,0,0.4);
        border-radius: 8px;
        margin-bottom: 12px;
      ">
        <span style="color: rgba(255,255,255,0.6); font-size: 13px; margin-right: 8px; align-self: center;">Servers:</span>
        ${buttons}
      </div>
      <style>
        .server-btn:hover:not(.active) {
          border-color: rgba(255,255,255,0.4) !important;
          background: rgba(255,255,255,0.05) !important;
        }
        .server-btn.server-failed {
          opacity: 0.5;
          text-decoration: line-through;
        }
      </style>
    `;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // TV SHOW CONTROLS (Season/Episode Selectors)
  // ═══════════════════════════════════════════════════════════════════════════
  const renderTvControls = (seasons = [], currentS = 1, currentE = 1, onChange) => {
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
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // GET ALL SERVER NAMES (for display)
  // ═══════════════════════════════════════════════════════════════════════════
  const getServerList = () => {
    return Object.entries(SERVERS).map(([key, server]) => ({
      key,
      name: server.name,
      priority: server.priority,
    }));
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPOSED API
  // ═══════════════════════════════════════════════════════════════════════════
  return {
    SERVERS,
    getEmbedUrl,
    buildAllSources,
    getBestServer,
    getNextServer,
    markServerStatus,
    resetServerStatuses,
    getIframeAttributes,
    renderServerSelector,
    renderTvControls,
    getServerList,
  };
})();

// Make globally available
window.EmbedServers = EmbedServers;
