/**
 * VideoEngine — Enhanced with Multi-Server Auto-Embed
 * Supports 6+ automatic embed servers with smart failover
 */
const VideoEngine = (() => {
  const SERVER_PRIORITY = {
    upload: 0,
    embed2: 1,
    superembed: 2,
    autoembed: 3,
    vidsrc: 4,
    vidlink: 5,
    dailymotion: 6,
    youtube: 7,
    vimeo: 8,
    multiembed: 15,
  };

  function normalizeServer(server = '', url = '') {
    const value = String(server || '').trim().toLowerCase();
    if (value === 'storage' || value === 'local') return 'upload';
    if (value) return value;

    const raw = String(url || '').toLowerCase();
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) return 'youtube';
    if (raw.includes('dailymotion.com') || raw.includes('dai.ly')) return 'dailymotion';
    if (raw.includes('vimeo.com')) return 'vimeo';
    return 'upload';
  }

  function buildRuntimeUrl(server, source = {}) {
    const normalizedServer = normalizeServer(server, source.url || source.path);
    const rawUrl = String(source.url || source.path || '').trim();
    const id = String(source.id || source.providerId || '').trim();

    if (normalizedServer === 'upload') {
      return rawUrl;
    }

    if (normalizedServer === 'youtube' && id) {
      if (typeof window.buildYouTubeEmbed === 'function') {
        return window.buildYouTubeEmbed(`https://youtu.be/${id}`) || '';
      }
      return `https://www.youtube.com/embed/${id}`;
    }

    if (normalizedServer === 'dailymotion' && id) {
      return `https://www.dailymotion.com/embed/video/${id}`;
    }

    if (normalizedServer === 'vimeo' && id) {
      return `https://player.vimeo.com/video/${id}`;
    }

    if (!rawUrl) return '';

    if (normalizedServer === 'youtube' || normalizedServer === 'dailymotion' || normalizedServer === 'vimeo') {
      if (typeof window.getCleanEmbedUrl === 'function') {
        return window.getCleanEmbedUrl(rawUrl);
      }
    }

    return rawUrl;
  }

  function toEmbedUrl(source) {
    return buildRuntimeUrl(source.server || source.type, source);
  }

  function createSourceConfig(source, index = 0) {
    const server = normalizeServer(source.server || source.type || source.sourceType, source.url || source.path);
    const quality = String(source.quality || 'HD').trim() || 'HD';
    const playUrl = buildRuntimeUrl(server, source);
    const fallbackLabel = index === 0 || index === 'native' ? 'Primary' : `Fallback ${Number(index)}`;
    const label = String(source.label || fallbackLabel).trim() || 'Primary';

    return {
      id: source._id || source.key || `${server}-${index}`,
      server,
      sourceType: source.sourceType || source.type || server,
      url: String(source.url || source.path || '').trim(),
      providerId: String(source.id || '').trim(),
      quality,
      embedUrl: server === 'upload' ? '' : playUrl,
      playUrl: server === 'upload' ? playUrl : '',
      label,
      statusLabel: quality ? `${label} • ${quality}` : label,
      isExternal: server !== 'upload',
    };
  }

  function buildTmdbEmbedUrl(movie) {
    if (!movie?.tmdbId) return '';
    const category = String(movie.category || '').toLowerCase();
    const isTv = ['series', 'anime'].includes(category) || Number(movie.totalEpisodes) > 0;
    const tmdbType = isTv ? 'tv' : 'movie';
    return `https://2embed.cc/iframe/${tmdbType}?tmdb=${encodeURIComponent(movie.tmdbId)}`;
  }

  // buildTmdbSource removed as requested

  // ═══════════════════════════════════════════════════════════════════════════
  // AUTO-EMBED SERVERS — Build URLs from TMDb ID
  // ═══════════════════════════════════════════════════════════════════════════
  function getEmbedServers(movie) {
    if (!movie?.tmdbId) return [];

    const tmdbId = movie.tmdbId;
    const category = String(movie.category || '').toLowerCase();
    const isTv = ['series', 'anime', 'tv', 'cartoon'].includes(category) || Number(movie.totalEpisodes) > 0;
    const type = isTv ? 'tv' : 'movie';

    // Use EmbedServers module if available, otherwise build manually
    if (typeof EmbedServers !== 'undefined') {
      return EmbedServers.buildAllSources(tmdbId, type, movie.season || 1, movie.episode || 1);
    }

    // Fallback: Build manually
    const servers = [
      { key: 'vidsrc', name: 'VidSrc', movie: (id) => `https://vidsrc.me/embed/movie?tmdb=${id}`, tv: (id, s, e) => `https://vidsrc.me/embed/tv?tmdb=${id}&season=${s}&episode=${e}` },
      { key: 'embed2', name: '2Embed', movie: (id) => `https://www.2embed.cc/embed/${id}`, tv: (id, s, e) => `https://www.2embed.cc/embedtv/${id}&s=${s}&e=${e}` },
      { key: 'autoembed', name: 'AutoEmbed', movie: (id) => `https://autoembed.cc/embed/movie/${id}`, tv: (id, s, e) => `https://autoembed.cc/embed/tv/${id}-${s}-${e}` },
      { key: 'vidlink', name: 'VidLink', movie: (id) => `https://vidlink.pro/embed/movie/${id}`, tv: (id, s, e) => `https://vidlink.pro/embed/tv/${id}/${s}/${e}` },
      { key: 'multiembed', name: 'MultiEmbed', movie: (id) => `https://multiembed.mov/?video_id=${id}&tmdb=1`, tv: (id, s, e) => `https://multiembed.mov/?video_id=${id}&tmdb=1&s=${s}&e=${e}` },
    ];

    return servers.map((srv, idx) => {
      const url = isTv ? srv.tv(tmdbId, movie.season || 1, movie.episode || 1) : srv.movie(tmdbId);
      return {
        id: `embed-${srv.key}`,
        server: srv.key,
        serverName: srv.name,
        priority: 10 + idx,
        url: url,
        embedUrl: url,
        playUrl: '',
        label: srv.name,
        quality: 'Auto',
        isExternal: true,
        isEmbed: true,
        sourceType: srv.key,
      };
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BUILD ALL MOVIE SOURCES (Upload + External + Auto-Embed)
  // ═══════════════════════════════════════════════════════════════════════════
  function buildMovieSources(movie, options = {}) {
    const sources = Array.isArray(movie.sources) ? movie.sources.map(createSourceConfig) : [];

    // Add uploaded/direct sources
    if (movie.videoUrl) {
      const uploadExists = sources.some((source) =>
        source.server === 'upload' && source.url === movie.videoUrl
      );

      if (!uploadExists) {
        const fallbackServer = normalizeServer(movie.sourceType, movie.videoUrl);
        sources.unshift(createSourceConfig({
          server: fallbackServer,
          sourceType: movie.sourceType || fallbackServer,
          url: movie.videoUrl,
          quality: movie.qualities?.['1080p'] ? 'Full HD' : 'HD',
          label: 'Primary',
        }, 'native'));
      }
    }

    // Legacy TMDb embed removed

    // ═══════════════════════════════════════════════════════════════════════════
    // AUTO-EMBED: Add multi-server sources from TMDb ID
    // ═══════════════════════════════════════════════════════════════════════════
    const embedSources = getEmbedServers(movie);
    if (embedSources.length && !options.skipAutoEmbed) {
      // Filter out duplicates (same URL)
      const existingUrls = new Set(sources.map(s => s.url));
      const newEmbedSources = embedSources.filter(s => !existingUrls.has(s.url));
      sources.push(...newEmbedSources);
    }

    return sources.sort((a, b) => {
      const priorityDiff = (SERVER_PRIORITY[a.server] ?? 99) - (SERVER_PRIORITY[b.server] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return a.label.localeCompare(b.label);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SMART SERVER SELECTOR — Get best available server with failover
  // ═══════════════════════════════════════════════════════════════════════════
  function getBestSource(movie, excludeFailed = true) {
    const sources = buildMovieSources(movie);
    if (!sources.length) return null;

    // Prefer upload sources first, then auto-embed by priority
    const uploadSources = sources.filter(s => s.server === 'upload');
    const embedSources = sources.filter(s => s.isEmbed && s.status !== 'failed');
    const otherSources = sources.filter(s => !s.isEmbed && s.server !== 'upload');

    // Priority: Upload > Working Embed > Other External
    const candidates = [...uploadSources, ...embedSources, ...otherSources];

    if (excludeFailed) {
      const working = candidates.find(s => s.status !== 'failed');
      return working || candidates[0]; // Fallback to first if all marked failed
    }

    return candidates[0];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET NEXT SERVER FOR FAILOVER
  // ═══════════════════════════════════════════════════════════════════════════
  function getNextSource(movie, currentSourceId) {
    const sources = buildMovieSources(movie);
    const currentIndex = sources.findIndex(s => s.id === currentSourceId);

    if (currentIndex === -1) return sources[0] || null;

    // Find next non-failed source
    for (let i = currentIndex + 1; i < sources.length; i++) {
      if (sources[i].status !== 'failed') return sources[i];
    }

    // Loop back to beginning
    for (let i = 0; i < currentIndex; i++) {
      if (sources[i].status !== 'failed') return sources[i];
    }

    return sources[currentIndex]; // Return current if all failed
  }

  function getPreferredSource(movie) {
    const sources = buildMovieSources(movie);
    return {
      sources,
      preferred: sources[0] || null,
    };
  }

  window.VideoEngine = {
    normalizeServer,
    toEmbedUrl,
    buildMovieSources,
    getPreferredSource,
    getBestSource,
    getNextSource,
    getEmbedServers,
    SERVERS: Object.keys(SERVER_PRIORITY),
  };

  return window.VideoEngine;
})();

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Multi-Embed Player Controller
 * Handles iframe embedding with server switching and failover
 * ═══════════════════════════════════════════════════════════════════════════
 */
const MultiEmbedPlayer = (() => {
  let currentContainer = null;
  let currentFrame = null;
  let currentSources = [];
  let currentSourceIndex = 0;
  let loadTimeout = null;
  let onErrorCallback = null;
  let onLoadCallback = null;

  // Initialize player
  const init = (containerId, sources, options = {}) => {
    const container = document.getElementById(containerId);
    if (!container) return null;

    currentContainer = container;
    currentSources = sources || [];
    currentSourceIndex = 0;
    onErrorCallback = options.onError;
    onLoadCallback = options.onLoad;

    // Clear container
    container.innerHTML = '';

    // Render server selector if multiple sources
    if (currentSources.length > 1) {
      renderServerButtons(container);
    }

    // Create iframe container
    const frameContainer = document.createElement('div');
    frameContainer.id = 'embedFrameContainer';
    frameContainer.style.cssText = `
      position: relative;
      width: 100%;
      aspect-ratio: 16/9;
      background: #000;
      border-radius: 12px;
      overflow: hidden;
    `;
    container.appendChild(frameContainer);

    // Load first source
    loadSource(0);

    return { switchServer, reload, destroy };
  };

  // Render server selection buttons
  const renderServerButtons = (container) => {
    const selectorDiv = document.createElement('div');
    selectorDiv.className = 'embed-server-selector';
    selectorDiv.style.cssText = `
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      padding: 12px 0;
      margin-bottom: 12px;
    `;

    currentSources.forEach((source, idx) => {
      const btn = document.createElement('button');
      btn.className = `server-btn ${idx === 0 ? 'active' : ''}`;
      btn.dataset.index = idx;
      btn.textContent = source.label || `Server ${idx + 1}`;
      btn.style.cssText = `
        padding: 8px 16px;
        border: 1px solid ${idx === 0 ? '#e50914' : 'rgba(255,255,255,0.2)'};
        background: ${idx === 0 ? '#e50914' : 'transparent'};
        color: ${idx === 0 ? '#fff' : 'rgba(255,255,255,0.8)'};
        border-radius: 6px;
        cursor: pointer;
        font-size: 13px;
        font-weight: 500;
        transition: all 0.2s;
      `;
      btn.onclick = () => switchServer(idx);
      selectorDiv.appendChild(btn);
    });

    container.appendChild(selectorDiv);
  };

  // Update active button state
  const updateActiveButton = (index) => {
    const buttons = currentContainer?.querySelectorAll('.server-btn');
    buttons?.forEach((btn, idx) => {
      const isActive = idx === index;
      btn.style.borderColor = isActive ? '#e50914' : 'rgba(255,255,255,0.2)';
      btn.style.background = isActive ? '#e50914' : 'transparent';
      btn.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.8)';
    });
  };

  // Load a specific source
  const loadSource = (index) => {
    if (!currentSources[index]) return false;

    const source = currentSources[index];
    const container = currentContainer?.querySelector('#embedFrameContainer');
    if (!container) return false;

    currentSourceIndex = index;
    updateActiveButton(index);

    // Clear existing
    container.innerHTML = '';
    clearTimeout(loadTimeout);

    // Show loading
    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'embedLoading';
    loadingDiv.style.cssText = `
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,0.9);
      color: #fff;
      font-size: 14px;
      z-index: 10;
    `;
    loadingDiv.innerHTML = `
      <div style="text-align: center;">
        <div style="width: 40px; height: 40px; border: 3px solid rgba(255,255,255,0.2); border-top-color: #e50914; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 12px;"></div>
        <div>Loading from ${source.label}...</div>
      </div>
      <style>@keyframes spin { to { transform: rotate(360deg); } }</style>
    `;
    container.appendChild(loadingDiv);

    // Create iframe
    currentFrame = document.createElement('iframe');
    currentFrame.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: none;
      opacity: 0;
      transition: opacity 0.3s;
    `;
    currentFrame.src = source.embedUrl || source.url;
    currentFrame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    currentFrame.referrerPolicy = 'no-referrer';
    currentFrame.setAttribute('allowfullscreen', 'true');

    // Handle load
    currentFrame.onload = () => {
      clearTimeout(loadTimeout);
      loadingDiv.style.display = 'none';
      currentFrame.style.opacity = '1';
      if (onLoadCallback) onLoadCallback(source);
    };

    // Handle error/timeout
    loadTimeout = setTimeout(() => {
      if (loadingDiv.style.display !== 'none') {
        // Load failed/timed out
        source.status = 'failed';
        if (index < currentSources.length - 1) {
          // Auto-switch to next server
          loadSource(index + 1);
        } else {
          // All failed
          loadingDiv.innerHTML = `
            <div style="text-align: center; color: #ef4444;">
              <div style="font-size: 32px; margin-bottom: 8px;">⚠</div>
              <div>Failed to load from all servers</div>
              <button onclick="MultiEmbedPlayer.reload()" style="margin-top: 12px; padding: 8px 16px; background: #e50914; color: #fff; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
            </div>
          `;
          if (onErrorCallback) onErrorCallback(source);
        }
      }
    }, source.timeout || 8000);

    container.appendChild(currentFrame);
    return true;
  };

  // Switch to specific server
  const switchServer = (index) => {
    if (index === currentSourceIndex) return;
    loadSource(index);
  };

  // Reload current source
  const reload = () => {
    loadSource(currentSourceIndex);
  };

  // Destroy player
  const destroy = () => {
    clearTimeout(loadTimeout);
    if (currentContainer) {
      currentContainer.innerHTML = '';
    }
    currentFrame = null;
    currentSources = [];
    currentSourceIndex = 0;
  };

  // Public API
  return {
    init,
    switchServer,
    reload,
    destroy,
    getCurrentSource: () => currentSources[currentSourceIndex],
    getAllSources: () => currentSources,
  };
})();

// Make globally available
window.MultiEmbedPlayer = MultiEmbedPlayer;
