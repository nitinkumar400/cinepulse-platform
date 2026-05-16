/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VideoEngine v4.0 — Static Trust Model (User-Driven Server Selection)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Architecture:
 *   1. Priority-Ordered Waterfall Array (from EmbedServers.STANDARD_SERVERS)
 *   2. 3.5s Static Trust Timeout — reveals iframe after fixed delay
 *   3. Cross-Domain postMessage Handshake (early spinner dismiss if received)
 *   4. Manual server switching — NO automatic rotation
 *
 * The watchdog auto-failover loop was removed to prevent infinite switching
 * caused by AdBlockers/Brave Shields stripping cross-domain postMessage.
 *
 * Safety: Does NOT alter Express routes, serverless functions, or Mongoose
 * configs. All URL parameters (?id, &season, &episode) are preserved.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const VideoEngine = (() => {

  // ─────────────────────────────────────────────────────────────────────────
  // CONSTANTS
  // ─────────────────────────────────────────────────────────────────────────
  const STATIC_TRUST_TIMEOUT_MS = 3500; // 3.5 seconds
  const TOAST_DURATION_MS = 3500;

  // Legacy priority map (kept for backward compat with upload/native sources)
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
  };

  // ─────────────────────────────────────────────────────────────────────────
  // FAILOVER STATE
  // ─────────────────────────────────────────────────────────────────────────
  let _activeServerIndex = 0;
  let _staticTrustTimer = null;
  let _handshakeReceived = false;
  let _currentSources = [];
  let _currentMovie = null;
  let _currentSeason = 1;
  let _currentEpisode = 1;
  let _iframeElement = null;
  let _circuitBroken = false;
  let _onFailoverCallback = null;
  let _onCircuitBreakCallback = null;
  let _onStreamVerifiedCallback = null;
  let _messageListenerBound = false;


  // ─────────────────────────────────────────────────────────────────────────
  // A. PRIORITY-ORDERED WATERFALL ARRAY
  // Pulls from EmbedServers.STANDARD_SERVERS, sorted by priority (asc).
  // ─────────────────────────────────────────────────────────────────────────
  function buildPriorityWaterfall(movie, season, episode) {
    if (typeof EmbedServers === 'undefined' || !EmbedServers.STANDARD_SERVERS) {
      console.warn('[VideoEngine] EmbedServers not loaded — cannot build waterfall.');
      return [];
    }

    const servers = EmbedServers.STANDARD_SERVERS;
    const tmdbId = Number(movie.tmdbId || movie.tmdb_id || 0);
    if (!tmdbId) return [];

    const category = String(movie.category || '').toLowerCase();
    const isTv = ['series', 'anime', 'cartoon', 'tv'].includes(category)
      || Number(movie.totalEpisodes || 0) > 1;

    const s = Number(season || movie.animeSeasonNumber || 1);
    const e = Number(episode || 1);

    // Convert object to sorted array by priority
    const sorted = Object.values(servers)
      .slice()
      .sort((a, b) => (a.priority || 99) - (b.priority || 99));

    return sorted.map((srv, idx) => {
      const url = isTv
        ? srv.tvUrl(tmdbId, s, e)
        : srv.movieUrl(tmdbId);

      return {
        id: `failover-${srv.key}-${tmdbId}`,
        server: srv.key,
        serverName: srv.name,
        label: srv.name,
        priority: srv.priority,
        url: url,
        embedUrl: url,
        playUrl: '',
        quality: 'Auto',
        isExternal: true,
        isEmbed: true,
        timeout: srv.timeout || 8000,
        sandboxPolicy: srv.sandboxPolicy || 'balanced',
        status: 'unknown',
        statusLabel: `Server ${idx + 1} • ${srv.name}`,
        sourceType: srv.key,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // C. CROSS-DOMAIN HANDSHAKE INTERCEPTOR
  // Listens for postMessage events from embedded players indicating
  // stream readiness (e.g., {event:"ready"}, {status:"playing"}).
  // ─────────────────────────────────────────────────────────────────────────
  function bindMessageListener() {
    if (_messageListenerBound) return;
    _messageListenerBound = true;

    window.addEventListener('message', (event) => {
      // Defensive: ignore messages from self
      if (event.source === window) return;

      let payload = null;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        // Non-JSON message — check raw string for known signals
        const raw = String(event.data || '').toLowerCase();
        if (raw.includes('ready') || raw.includes('playing') || raw.includes('loaded')) {
          handleHandshakeSuccess('raw-string-signal');
          return;
        }
        return;
      }

      if (!payload || typeof payload !== 'object') return;

      // Known readiness signatures from premium vendors
      const isReady =
        payload.event === 'ready' ||
        payload.event === 'playerReady' ||
        payload.event === 'player_ready' ||
        payload.event === 'loaded' ||
        payload.event === 'play' ||
        payload.event === 'playing' ||
        payload.status === 'playing' ||
        payload.status === 'ready' ||
        payload.type === 'ready' ||
        payload.type === 'playerReady' ||
        payload.method === 'ready' ||
        payload.data?.event === 'ready' ||
        payload.data?.status === 'playing' ||
        // VidLink specific
        payload.key === 'vidlink-ready' ||
        // VidSrc specific
        payload.info?.playerState === 1 ||
        payload.playerState === 1;

      if (isReady) {
        handleHandshakeSuccess(payload.event || payload.status || 'postMessage');
      }
    });
  }

  function handleHandshakeSuccess(signal) {
    if (_handshakeReceived) return; // Already handled
    _handshakeReceived = true;
    
    if (_staticTrustTimer !== null) {
      clearTimeout(_staticTrustTimer);
      _staticTrustTimer = null;
    }

    // Mark current source as working
    if (_currentSources[_activeServerIndex]) {
      _currentSources[_activeServerIndex].status = 'working';
    }

    if (typeof _onStreamVerifiedCallback === 'function') {
      _onStreamVerifiedCallback(_currentSources[_activeServerIndex], signal);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATIC TRUST TIMEOUT
  // ─────────────────────────────────────────────────────────────────────────
  function startStaticTrustTimeout() {
    if (_staticTrustTimer !== null) {
      clearTimeout(_staticTrustTimer);
      _staticTrustTimer = null;
    }
    _handshakeReceived = false;

    _staticTrustTimer = setTimeout(() => {
      if (_handshakeReceived) return;
      _handshakeReceived = true;
      
      // Time is up, simply reveal the iframe.
      if (typeof _onStreamVerifiedCallback === 'function') {
        _onStreamVerifiedCallback(_currentSources[_activeServerIndex], 'static-trust-timeout');
      }
    }, STATIC_TRUST_TIMEOUT_MS);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // IFRAME SANDBOX POLICY APPLICATION
  // ─────────────────────────────────────────────────────────────────────────
  function applyIframeSandbox(iframe, policy) {
    if (!iframe) return;
    // All embed providers reject sandbox restrictions — always remove it.
    // Keeping sandbox causes "Iframe Sandbox Detected" errors from providers
    // that check if they are running inside a restricted iframe context.
    iframe.removeAttribute('sandbox');
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DOM IFRAME REBUILDER
  // Completely destroys and recreates the iframe element on every stream
  // invocation or failover event. This eliminates stale iframe state,
  // memory leaks, and cross-origin caching bugs that occur when merely
  // updating .src on a persistent iframe.
  // ─────────────────────────────────────────────────────────────────────────
  let _containerElement = null;

  function rebuildIframe(targetServerUrl, sandboxPolicy) {
    // Step 1: Locate the parent player wrapper
    const wrapper = _containerElement
      || ((_iframeElement && _iframeElement.parentElement) ? _iframeElement.parentElement : null);

    if (!wrapper) {
      console.warn('[VideoEngine] No container element available for iframe rebuild.');
      return null;
    }

    // Step 2: Completely clear inner HTML — destroy previous iframe DOM node
    wrapper.innerHTML = '';

    // Step 3: Create a brand new iframe element
    const iframe = document.createElement('iframe');

    // Step 4: Apply verified, context-aware attributes
    iframe.id = 'video-player';
    iframe.src = targetServerUrl;
    iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
    iframe.allowFullscreen = true;
    iframe.setAttribute('allowfullscreen', 'true');
    iframe.setAttribute('webkitallowfullscreen', 'true');
    iframe.setAttribute('mozallowfullscreen', 'true');
    iframe.referrerPolicy = 'no-referrer';
    iframe.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;';

    // Step 5: Providers detect sandbox and block playback. Never set it.
    iframe.removeAttribute('sandbox');

    // Attach native event listener for Hybrid Handshake Mechanism
    iframe.dataset.onloadFired = "false";
    iframe.addEventListener('load', () => {
      iframe.dataset.onloadFired = "true";
    });

    // Step 6: Append fresh iframe into parent wrapper
    wrapper.appendChild(iframe);

    // Update internal reference
    _iframeElement = iframe;

    return iframe;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TOAST NOTIFICATION (non-intrusive)
  // ─────────────────────────────────────────────────────────────────────────
  function showFailoverToast(message) {
    // Remove existing toast if present
    const existing = document.getElementById('videoEngineToast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'videoEngineToast';
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(20px);
      background: linear-gradient(135deg, rgba(20, 20, 35, 0.95), rgba(30, 30, 50, 0.95));
      color: #e0e0e0;
      padding: 12px 24px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 500;
      z-index: 99999;
      backdrop-filter: blur(12px);
      border: 1px solid rgba(229, 9, 20, 0.3);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
      opacity: 0;
      transition: opacity 0.3s ease, transform 0.3s ease;
      pointer-events: none;
      max-width: 90vw;
      text-align: center;
    `;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Auto-dismiss
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
      setTimeout(() => toast.remove(), 350);
    }, TOAST_DURATION_MS);
  }


  // ─────────────────────────────────────────────────────────────────────────
  // E. CIRCUIT BREAKER ERROR SCREEN
  // Renders a user-friendly error inside the player card when all
  // mirrors are exhausted without a verified handshake.
  // ─────────────────────────────────────────────────────────────────────────
  function renderCircuitBreakerScreen(container) {
    if (!container) return;

    container.innerHTML = `
      <div style="
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        min-height: 280px;
        background: linear-gradient(180deg, #0d0d1a 0%, #1a1a2e 100%);
        border-radius: 12px;
        padding: 40px 24px;
        text-align: center;
        color: #e0e0e0;
      ">
        <div style="
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: rgba(229, 9, 20, 0.15);
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 20px;
        ">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#e50914" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <h3 style="
          margin: 0 0 10px;
          font-size: 18px;
          font-weight: 600;
          color: #fff;
        ">Stream Temporarily Unavailable</h3>
        <p style="
          margin: 0 0 20px;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.6);
          max-width: 380px;
          line-height: 1.5;
        ">Stream currently undergoing automated maintenance. Please try again shortly or check other titles.</p>
        <button onclick="window.VideoEngine.retryAllServers()" style="
          padding: 10px 24px;
          background: linear-gradient(135deg, #e50914, #c40812);
          color: #fff;
          border: none;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
          box-shadow: 0 4px 16px rgba(229, 9, 20, 0.3);
        " onmouseover="this.style.transform='translateY(-1px)'" onmouseout="this.style.transform='translateY(0)'">
          Retry All Servers
        </button>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAIN INITIALIZATION — mountStream()
  // Called by movieDetailsPage.js when a video is mounted or episode switched.
  // ─────────────────────────────────────────────────────────────────────────
  function mountStream(options = {}) {
    const {
      movie,
      season = 1,
      episode = 1,
      iframeElement,
      containerElement,
      onFailover,
      onCircuitBreak,
      onStreamVerified,
      sources,
    } = options;

    if (!movie && !sources) {
      console.warn('[VideoEngine] mountStream called without movie or sources.');
      return null;
    }

    // Bind the cross-domain listener (once globally)
    bindMessageListener();

    // Store state
    _currentMovie = movie || null;
    _currentSeason = Number(season || 1);
    _currentEpisode = Number(episode || 1);
    _iframeElement = iframeElement || null;
    _containerElement = containerElement || (iframeElement ? iframeElement.parentElement : null);
    _circuitBroken = false;
    _handshakeReceived = false;
    _onFailoverCallback = onFailover || null;
    _onCircuitBreakCallback = onCircuitBreak || null;
    _onStreamVerifiedCallback = onStreamVerified || null;

    // Build priority waterfall from STANDARD_SERVERS
    if (sources && sources.length) {
      _currentSources = sources;
    } else {
      _currentSources = buildPriorityWaterfall(movie, season, episode);
    }

    if (!_currentSources.length) {
      console.warn('[VideoEngine] No embed sources available for this title.');
      return null;
    }

    // Reset index to first server
    _activeServerIndex = 0;

    // DOM Iframe Rebuilder: destroy old iframe and create fresh one
    const firstSource = _currentSources[0];
    rebuildIframe(firstSource.embedUrl || firstSource.url, firstSource.sandboxPolicy || 'balanced');

    // Start the static trust timeout (3.5s)
    startStaticTrustTimeout();

    return {
      sources: _currentSources,
      activeIndex: _activeServerIndex,
      activeSource: firstSource,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RETRY — Reset all server statuses and restart from top
  // Flushes system cache, resets priority index to 0, triggers fresh
  // DOM Iframe Rebuilder cycle from scratch.
  // ─────────────────────────────────────────────────────────────────────────
  function retryAllServers() {
    // Flush circuit breaker state
    _circuitBroken = false;
    if (_staticTrustTimer !== null) {
      clearTimeout(_staticTrustTimer);
      _staticTrustTimer = null;
    }

    // Reset all source statuses to unknown
    _currentSources.forEach(s => { s.status = 'unknown'; });

    // Reset active server priority index to 0
    _activeServerIndex = 0;
    _handshakeReceived = false;

    // Flush session failed providers cache
    try { sessionStorage.removeItem('cinepulse_session_failed_providers'); } catch {}

    // DOM Iframe Rebuilder: destroy and recreate from scratch
    if (_currentSources[0]) {
      const first = _currentSources[0];
      rebuildIframe(first.embedUrl || first.url, first.sandboxPolicy || 'balanced');
    }

    // Start fresh static trust cycle
    startStaticTrustTimeout();

    // Notify failover callback of reset
    if (typeof _onFailoverCallback === 'function') {
      _onFailoverCallback(0, _currentSources[0]);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MANUAL SERVER SWITCH (user clicks a server button)
  // ─────────────────────────────────────────────────────────────────────────
  function switchToServer(index) {
    if (index < 0 || index >= _currentSources.length) return;
    if (_staticTrustTimer !== null) {
      clearTimeout(_staticTrustTimer);
      _staticTrustTimer = null;
    }
    _handshakeReceived = false;
    _activeServerIndex = index;

    const source = _currentSources[index];

    // DOM Iframe Rebuilder: fresh iframe for manual switch
    rebuildIframe(source.embedUrl || source.url, source.sandboxPolicy || 'balanced');
    
    // Start fresh static trust cycle
    startStaticTrustTimeout();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STOP — Cleanup when navigating away or destroying player
  // ─────────────────────────────────────────────────────────────────────────
  function stop() {
    if (_staticTrustTimer !== null) {
      clearTimeout(_staticTrustTimer);
      _staticTrustTimer = null;
    }
    _handshakeReceived = false;
    _circuitBroken = false;
    _currentSources = [];
    _activeServerIndex = 0;
    _iframeElement = null;
    _containerElement = null;
    _currentMovie = null;
  }


  // ─────────────────────────────────────────────────────────────────────────
  // LEGACY COMPAT — Preserve existing VideoEngine API surface
  // ─────────────────────────────────────────────────────────────────────────
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

    if (normalizedServer === 'upload') return rawUrl;
    if (normalizedServer === 'youtube' && id) return `https://www.youtube.com/embed/${id}`;
    if (normalizedServer === 'dailymotion' && id) return `https://www.dailymotion.com/embed/video/${id}`;
    if (normalizedServer === 'vimeo' && id) return `https://player.vimeo.com/video/${id}`;
    if (!rawUrl) return '';
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

  function getEmbedServers(movie) {
    if (!movie?.tmdbId) return [];
    const tmdbId = movie.tmdbId;
    const category = String(movie.category || '').toLowerCase();
    const isTv = ['series', 'anime', 'tv', 'cartoon'].includes(category) || Number(movie.totalEpisodes) > 0;
    const type = isTv ? 'tv' : 'movie';

    if (typeof EmbedServers !== 'undefined') {
      return EmbedServers.buildAllSources(tmdbId, type, movie.season || 1, movie.episode || 1);
    }
    return [];
  }

  function buildMovieSources(movie, options = {}) {
    const sources = Array.isArray(movie.sources) ? movie.sources.map(createSourceConfig) : [];

    if (movie.videoUrl) {
      const uploadExists = sources.some(s => s.server === 'upload' && s.url === movie.videoUrl);
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

    const embedSources = getEmbedServers(movie);
    if (embedSources.length && !options.skipAutoEmbed) {
      const existingUrls = new Set(sources.map(s => s.url));
      const newEmbedSources = embedSources.filter(s => !existingUrls.has(s.url));
      sources.push(...newEmbedSources);
    }

    return sources.sort((a, b) => {
      const priorityDiff = (SERVER_PRIORITY[a.server] ?? 99) - (SERVER_PRIORITY[b.server] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.label || '').localeCompare(b.label || '');
    });
  }

  function getBestSource(movie, excludeFailed = true) {
    const sources = buildMovieSources(movie);
    if (!sources.length) return null;
    const uploadSources = sources.filter(s => s.server === 'upload');
    const embedSources = sources.filter(s => s.isEmbed && s.status !== 'failed');
    const otherSources = sources.filter(s => !s.isEmbed && s.server !== 'upload');
    const candidates = [...uploadSources, ...embedSources, ...otherSources];
    if (excludeFailed) {
      const working = candidates.find(s => s.status !== 'failed');
      return working || candidates[0];
    }
    return candidates[0];
  }

  function getNextSource(movie, currentSourceId) {
    const sources = buildMovieSources(movie);
    const currentIndex = sources.findIndex(s => s.id === currentSourceId);
    if (currentIndex === -1) return sources[0] || null;
    for (let i = currentIndex + 1; i < sources.length; i++) {
      if (sources[i].status !== 'failed') return sources[i];
    }
    for (let i = 0; i < currentIndex; i++) {
      if (sources[i].status !== 'failed') return sources[i];
    }
    return sources[currentIndex];
  }

  function getPreferredSource(movie) {
    const sources = buildMovieSources(movie);
    return { sources, preferred: sources[0] || null };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NATIVE HLS.JS STREAM MOUNTER (FOR ANIME EXPERIMENTAL FLOW)
  // ─────────────────────────────────────────────────────────────────────────
  let autoPlayCountdownTimer = null;
  let countdownSecondsLeft = 8;

  function triggerAutoPlayCountdown(wrapper) {
    if (autoPlayCountdownTimer) clearInterval(autoPlayCountdownTimer);
    countdownSecondsLeft = 8;
    
    let overlay = document.getElementById('autoplay-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'autoplay-overlay';
      overlay.style.cssText = 'position:absolute; inset:0; background:rgba(0,0,0,0.85); z-index:20; display:flex; flex-direction:column; align-items:center; justify-content:center; color:white; font-family:sans-serif; backdrop-filter:blur(4px); border-radius:8px;';
      
      const title = document.createElement('h2');
      title.textContent = 'Next Episode Playing In...';
      title.style.cssText = 'margin-bottom:20px; font-size:24px; font-weight:600; text-shadow:0 2px 4px rgba(0,0,0,0.5);';
      
      const count = document.createElement('div');
      count.id = 'autoplay-count';
      count.style.cssText = 'font-size:72px; font-weight:bold; margin-bottom:30px; text-shadow:0 4px 12px rgba(0,0,0,0.5);';
      
      const btnRow = document.createElement('div');
      btnRow.style.cssText = 'display:flex; gap:16px;';
      
      const playBtn = document.createElement('button');
      playBtn.innerHTML = '<i class="ri-play-fill"></i> Play Now';
      playBtn.style.cssText = 'padding:12px 28px; background:#e50914; color:white; border:none; border-radius:4px; font-size:16px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:8px; transition:transform 0.2s;';
      playBtn.onmouseover = () => playBtn.style.transform = 'scale(1.05)';
      playBtn.onmouseout = () => playBtn.style.transform = 'scale(1)';
      playBtn.onclick = () => {
        clearInterval(autoPlayCountdownTimer);
        overlay.remove();
        if (typeof window.playEpisodeInPlace === 'function') {
           window.playEpisodeInPlace(window.currentPlayingSeason || 1, window.currentPlayingEpisode + 1);
        }
      };
      
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = 'Cancel';
      cancelBtn.style.cssText = 'padding:12px 28px; background:rgba(255,255,255,0.15); color:white; border:1px solid rgba(255,255,255,0.3); border-radius:4px; font-size:16px; font-weight:500; cursor:pointer; transition:background 0.2s;';
      cancelBtn.onmouseover = () => cancelBtn.style.background = 'rgba(255,255,255,0.25)';
      cancelBtn.onmouseout = () => cancelBtn.style.background = 'rgba(255,255,255,0.15)';
      cancelBtn.onclick = () => {
        clearInterval(autoPlayCountdownTimer);
        overlay.remove();
      };
      
      btnRow.appendChild(playBtn);
      btnRow.appendChild(cancelBtn);
      
      overlay.appendChild(title);
      overlay.appendChild(count);
      overlay.appendChild(btnRow);
      wrapper.appendChild(overlay);
    }
    
    const countEl = document.getElementById('autoplay-count');
    countEl.textContent = countdownSecondsLeft;
    
    autoPlayCountdownTimer = setInterval(() => {
      countdownSecondsLeft--;
      countEl.textContent = countdownSecondsLeft;
      if (countdownSecondsLeft <= 0) {
        clearInterval(autoPlayCountdownTimer);
        const currentOverlay = document.getElementById('autoplay-overlay');
        if (currentOverlay) currentOverlay.remove();
        
        if (typeof window.playEpisodeInPlace === 'function') {
           window.playEpisodeInPlace(window.currentPlayingSeason || 1, window.currentPlayingEpisode + 1);
        }
      }
    }, 1000);
  }

  function mountNativeStream(streamUrl) {
    const viewport = document.querySelector('.player-viewport');
    const nativeShell = document.getElementById('nativePlayerShell');
    const embedShell = document.getElementById('embedShell');
    const wrapper = nativeShell || viewport || _containerElement || document.getElementById('embedPlayerHost');
    if (!wrapper) {
      console.warn('[VideoEngine] No container found for native stream mount.');
      return;
    }
    
    // Switch to native playback surface
    if (nativeShell) {
      nativeShell.classList.add('is-active');
      nativeShell.style.display = 'block';
    }
    if (embedShell) {
      embedShell.classList.remove('is-active');
      embedShell.style.display = 'none';
    }
    
    // Hide or destroy existing iframe
    if (_iframeElement) {
      _iframeElement.style.display = 'none';
    }
    const existingIframe = wrapper.querySelector('iframe');
    if (existingIframe) existingIframe.style.display = 'none';

    // Remove any existing native stream player and the default video element
    const existingPlayer = document.getElementById('native-stream-player');
    if (existingPlayer) existingPlayer.remove();
    const defaultVideo = document.getElementById('videoPlayer');
    if (defaultVideo) defaultVideo.style.display = 'none';

    // Create new video element
    const videoElement = document.createElement('video');
    videoElement.id = 'native-stream-player';
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.style.cssText = 'width:100%; height:100%; background:#000; border-radius:8px; position:absolute; inset:0; z-index:10;';
    
    // Ensure wrapper has positioning context
    if (wrapper.style.position !== 'absolute' && wrapper.style.position !== 'relative') {
      wrapper.style.position = 'relative';
    }
    
    wrapper.appendChild(videoElement);

    // Instantiate HLS.js
    if (typeof Hls !== 'undefined' && Hls.isSupported()) {
      const hlsInstance = new Hls({
        maxBufferLength: 30,
        maxMaxBufferLength: 60,
      });
      hlsInstance.loadSource(streamUrl);
      hlsInstance.attachMedia(videoElement);
      hlsInstance.on(Hls.Events.MANIFEST_PARSED, () => {
        videoElement.play().catch(() => {});
      });
      hlsInstance.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.warn('[VideoEngine] HLS fatal error, falling back to embed servers');
          hlsInstance.destroy();
          videoElement.remove();
          if (defaultVideo) defaultVideo.style.display = 'block';
        }
      });
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = streamUrl;
      videoElement.play().catch(() => {});
    } else {
      console.error('[VideoEngine] HLS playback not supported by browser.');
      videoElement.remove();
      if (defaultVideo) defaultVideo.style.display = 'block';
      return;
    }

    // Netflix-style autoplay countdown when episode ends
    videoElement.addEventListener('ended', () => {
      const maxEp = window.maxAnimeEpisodesCount || Number(window.currentMovie?.totalEpisodes || 9999);
      if (window.currentPlayingEpisode + 1 <= maxEp) {
        triggerAutoPlayCountdown(viewport || wrapper);
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GETTERS (for external inspection)
  // ─────────────────────────────────────────────────────────────────────────
  function getActiveServerIndex() { return _activeServerIndex; }
  function getCurrentSources() { return _currentSources; }
  function isCircuitBroken() { return _circuitBroken; }
  function isHandshakeReceived() { return _handshakeReceived; }

  // ─────────────────────────────────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────────────────────────────────
  window.VideoEngine = {
    // New Failover Monitoring Loop API
    mountStream,
    mountNativeStream,
    switchToServer,
    retryAllServers,
    stop,
    renderCircuitBreakerScreen,
    applyIframeSandbox,
    rebuildIframe,
    showFailoverToast,
    buildPriorityWaterfall,

    // State getters
    getActiveServerIndex,
    getCurrentSources,
    isCircuitBroken,
    isHandshakeReceived,

    // Legacy API (backward compat)
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
 * Multi-Embed Player Controller (Legacy — preserved for backward compat)
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

  const init = (containerId, sources, options = {}) => {
    const container = document.getElementById(containerId);
    if (!container) return null;

    currentContainer = container;
    currentSources = sources || [];
    currentSourceIndex = 0;
    onErrorCallback = options.onError;
    onLoadCallback = options.onLoad;
    container.innerHTML = '';

    if (currentSources.length > 1) {
      renderServerButtons(container);
    }

    const frameContainer = document.createElement('div');
    frameContainer.id = 'embedFrameContainer';
    frameContainer.style.cssText = 'position:relative;width:100%;aspect-ratio:16/9;background:#000;border-radius:12px;overflow:hidden;';
    container.appendChild(frameContainer);

    loadSource(0);
    return { switchServer, reload, destroy };
  };

  const renderServerButtons = (container) => {
    const selectorDiv = document.createElement('div');
    selectorDiv.className = 'embed-server-selector';
    selectorDiv.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;padding:12px 0;margin-bottom:12px;';

    currentSources.forEach((source, idx) => {
      const btn = document.createElement('button');
      btn.className = `server-btn ${idx === 0 ? 'active' : ''}`;
      btn.dataset.index = idx;
      btn.textContent = source.label || `Server ${idx + 1}`;
      btn.style.cssText = `padding:8px 16px;border:1px solid ${idx === 0 ? '#e50914' : 'rgba(255,255,255,0.2)'};background:${idx === 0 ? '#e50914' : 'transparent'};color:${idx === 0 ? '#fff' : 'rgba(255,255,255,0.8)'};border-radius:6px;cursor:pointer;font-size:13px;font-weight:500;transition:all 0.2s;`;
      btn.onclick = () => switchServer(idx);
      selectorDiv.appendChild(btn);
    });

    container.appendChild(selectorDiv);
  };

  const updateActiveButton = (index) => {
    const buttons = currentContainer?.querySelectorAll('.server-btn');
    buttons?.forEach((btn, idx) => {
      const isActive = idx === index;
      btn.style.borderColor = isActive ? '#e50914' : 'rgba(255,255,255,0.2)';
      btn.style.background = isActive ? '#e50914' : 'transparent';
      btn.style.color = isActive ? '#fff' : 'rgba(255,255,255,0.8)';
    });
  };

  const loadSource = (index) => {
    if (!currentSources[index]) return false;
    const source = currentSources[index];
    const container = currentContainer?.querySelector('#embedFrameContainer');
    if (!container) return false;

    currentSourceIndex = index;
    updateActiveButton(index);
    container.innerHTML = '';
    clearTimeout(loadTimeout);

    const loadingDiv = document.createElement('div');
    loadingDiv.id = 'embedLoading';
    loadingDiv.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.9);color:#fff;font-size:14px;z-index:10;';
    loadingDiv.innerHTML = `<div style="text-align:center;"><div style="width:40px;height:40px;border:3px solid rgba(255,255,255,0.2);border-top-color:#e50914;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 12px;"></div><div>Loading from ${source.label}...</div></div><style>@keyframes spin{to{transform:rotate(360deg);}}</style>`;
    container.appendChild(loadingDiv);

    currentFrame = document.createElement('iframe');
    currentFrame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:none;opacity:0;transition:opacity 0.3s;';
    currentFrame.src = source.embedUrl || source.url;
    currentFrame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture';
    currentFrame.removeAttribute('sandbox');
    currentFrame.referrerPolicy = 'no-referrer';
    currentFrame.setAttribute('allowfullscreen', 'true');

    currentFrame.onload = () => {
      clearTimeout(loadTimeout);
      loadingDiv.style.display = 'none';
      currentFrame.style.opacity = '1';
      if (onLoadCallback) onLoadCallback(source);
    };

    loadTimeout = setTimeout(() => {
      if (loadingDiv.style.display !== 'none') {
        source.status = 'failed';
        if (index < currentSources.length - 1) {
          loadSource(index + 1);
        } else {
          loadingDiv.innerHTML = `<div style="text-align:center;color:#ef4444;"><div style="font-size:32px;margin-bottom:8px;">⚠</div><div>Failed to load from all servers</div><button onclick="MultiEmbedPlayer.reload()" style="margin-top:12px;padding:8px 16px;background:#e50914;color:#fff;border:none;border-radius:4px;cursor:pointer;">Retry</button></div>`;
          if (onErrorCallback) onErrorCallback(source);
        }
      }
    }, source.timeout || 8000);

    container.appendChild(currentFrame);
    return true;
  };

  const switchServer = (index) => {
    if (index === currentSourceIndex) return;
    loadSource(index);
  };

  const reload = () => { loadSource(currentSourceIndex); };

  const destroy = () => {
    clearTimeout(loadTimeout);
    if (currentContainer) currentContainer.innerHTML = '';
    currentFrame = null;
    currentSources = [];
    currentSourceIndex = 0;
  };

  return {
    init,
    switchServer,
    reload,
    destroy,
    getCurrentSource: () => currentSources[currentSourceIndex],
    getAllSources: () => currentSources,
  };
})();

window.MultiEmbedPlayer = MultiEmbedPlayer;
