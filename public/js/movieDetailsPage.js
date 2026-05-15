(function () {

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL STATE & CONSTANTS — Single source of truth for this IIFE
// All variables declared here to prevent every ReferenceError permanently.
// ═══════════════════════════════════════════════════════════════════════════

// ── App-level constants ──
const SHARE_UNLOCK_KEY_PREFIX  = 'cinepulse_share_';
const CONTINUE_WATCHING_KEY    = 'cinepulse_continue_watching';

// ── Playback state ──
let currentMovie            = null;
let currentMovieId          = null;
let userLoggedIn            = false;
let playbackSources         = [];
let activeSourceIndex       = -1;
let activePlayerSwitchToken = 0;
let nativePlayerInitialized = false;
let progressTrackingReady   = false;
let activeEmbedPlayer       = null;
let providerSubtitleBlobUrls = [];
let progressTimer           = null;

// ── Episode/UI state ──
let seasonsData    = {};
let selectedRating = 0;
let currentPlayingSeason    = 1;
let currentPlayingEpisode   = 1;

// ─────────────────────────────────────────────────────────────────────────
// SESSION FAILED-PROVIDER MANAGEMENT
// Tracks servers that failed this session so we can skip them on retry.
// Uses sessionStorage so the list auto-clears when the tab is closed.
// ─────────────────────────────────────────────────────────────────────────
const _SESSION_FAILED_KEY = 'cinepulse_session_failed_providers';

function getFailedProviders() {
  try {
    return JSON.parse(sessionStorage.getItem(_SESSION_FAILED_KEY) || '[]');
  } catch { return []; }
}

function setFailedProviders(list) {
  try {
    sessionStorage.setItem(_SESSION_FAILED_KEY, JSON.stringify(Array.isArray(list) ? list : []));
  } catch {}
}

function markProviderFailed(source) {
  if (!source?.server) return;
  const key = String(source.server).trim().toLowerCase();
  const current = getFailedProviders();
  if (!current.includes(key)) {
    setFailedProviders([...current, key]);
  }
  source.status = 'failed';
}

// ─────────────────────────────────────────────────────────────────────────
// reorderSourcesBySessionHealth — sorts sources so non-failed ones come first.
// Preserved as a no-crash shim; the Hydra system handles primary ordering.
// ─────────────────────────────────────────────────────────────────────────
function reorderSourcesBySessionHealth(sources) {
  if (!Array.isArray(sources) || !sources.length) return sources || [];
  const failed = new Set(getFailedProviders());
  const good   = sources.filter(s => !failed.has(String(s.server || '').toLowerCase()));
  const bad    = sources.filter(s =>  failed.has(String(s.server || '').toLowerCase()));
  return [...good, ...bad];
}

// Search and auto-load subtitles for a movie
async function loadOpenSubtitles(movieTitle, movieId) {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await fetch(
      API_BASE + '/subtitles/search/' + encodeURIComponent(movieTitle) + '?langs=en,hi',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    const data = await readJsonResponse(res);
    if (!data.results || !data.results.length) return;

    // Take the best result (most downloaded) and load its download link
    var best = data.results[0];
    if (best && best.attributes && best.attributes.files && best.attributes.files[0]) {
      console.log('[Subtitles] Best match:', best.attributes.feature_details?.title || 'Unknown');
    }
  } catch(err) {
    console.warn('[Subtitles] Load failed:', err.message);
  }
}

async function hydrateAnimeTmdbId(movie) {
  if (!movie || movie.tmdbId || movie.tmdb_id) return movie;
  const isAnimeLike = String(movie.provider || '').toLowerCase() === 'anilist'
    || String(movie.category || '').toLowerCase() === 'anime';
  if (!isAnimeLike) return movie;

  const title = String(movie.title || '').trim();
  if (!title) return movie;

  try {
    const res = await apiFetch(`/tmdb-public/search?type=tv&query=${encodeURIComponent(title)}&page=1`, { silent: true });
    if (!res.ok) return movie;
    const payload = await readJsonResponse(res);
    const first = Array.isArray(payload?.results) ? payload.results[0] : null;
    if (!first?.tmdbId) return movie;

    return {
      ...movie,
      tmdbId: first.tmdbId,
      tmdb_id: first.tmdbId,
    };
  } catch {
    return movie;
  }
}

function mergeTmdbDetails(movie, details) {
  if (!details) return movie;
  const poster = details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : movie.thumbnailUrl;
  const banner = details.backdrop_path ? `https://image.tmdb.org/t/p/original${details.backdrop_path}` : movie.bannerUrl;
  const year = movie.releaseYear || (details.release_date || details.first_air_date || '').slice(0, 4);
  const genres = Array.isArray(details.genres) && details.genres.length
    ? details.genres.map((genre) => genre.name)
    : movie.genre || [];

  return {
    ...movie,
    title: details.title || details.name || movie.title,
    description: details.overview || movie.description,
    releaseYear: year || movie.releaseYear,
    thumbnailUrl: poster || movie.thumbnailUrl,
    bannerUrl: banner || movie.bannerUrl,
    rating: movie.rating || (details.vote_average ? details.vote_average.toFixed(1) : movie.rating),
    averageRating: movie.averageRating || details.vote_average || movie.averageRating,
    genre: genres,
    language: movie.language || details.original_language?.toUpperCase(),
    trailerUrl: movie.trailerUrl || getOfficialTrailerUrl(details.videos?.results),
  };
}

function normalizeMovieState(movie, fallbackMovie = null) {
  if (!movie) return movie;
  const nextAiringEpisode = movie.nextAiringEpisode || fallbackMovie?.nextAiringEpisode || null;
  return {
    ...movie,
    nextAiringEpisode,
  };
}

// Ensure Upcoming Episode card is shown for anime when episodes grid is empty
function ensureUpcomingEpisodeFallback(movie) {
  try {
    if (!movie || String(movie.category || '').toLowerCase() !== 'anime') return;
    const section = document.getElementById('episodesSection');
    const grid = document.getElementById('episodesGrid');
    if (!grid || !section) return;

    // If grid already has episode cards, skip
    const hasCards = Array.from(grid.children).some(c => c.classList && c.classList.contains('episode-card'));
    if (hasCards) return;

    const nextEp = Number(movie?.nextAiringEpisode?.episode || 0);
    const nextAtRaw = movie?.nextAiringEpisode?.airingAt || null;
    const nextAt = nextAtRaw ? new Date(nextAtRaw) : null;
    if (!nextEp || (nextAt && Number.isNaN(nextAt.getTime()))) return;

    const animeSeasonNumber = getAnimeSeasonNumber(movie);
    const nextAiringLabel = nextAt && !Number.isNaN(nextAt.getTime())
      ? `Airs ${nextAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : 'Airing soon';
    const tmdbId = Number(movie?.tmdbId || movie?.tmdb_id || 0);
    const embedUrl = tmdbId ? buildAnimeEpisodeEmbedUrl(tmdbId, animeSeasonNumber, nextEp) : '';
    const metaLabel = tmdbId ? nextAiringLabel : 'TMDB mapping pending';

    section.style.display = 'block';
    grid.innerHTML = `
      <div class="episode-card" data-anime-season="${animeSeasonNumber}" data-anime-ep="${nextEp}" data-anime-embed-url="${escapeHtml(embedUrl)}">
        <img class="ep-card-thumb" src="${mediaUrl(movie?.thumbnailUrl) || THUMB_PH}"
          alt="${escapeHtml(movie?.title || 'Anime Episode')}"
          loading="lazy"
          referrerpolicy="no-referrer"
          onerror="this.src='${THUMB_PH}'">
        <div style="flex:1;min-width:0;">
          <div class="ep-card-num">Season ${animeSeasonNumber} · Episode ${nextEp}</div>
          <div class="ep-card-title">${escapeHtml(movie?.title || 'Anime')}</div>
          <div class="ep-card-meta">
            <span><i class="ri-time-line"></i> ${escapeHtml(metaLabel)}</span>
          </div>
        </div>
        <div class="ep-play-btn"><i class="ri-play-fill" style="color:#fff;"></i></div>
      </div>`;
  } catch (err) {
    console.warn('Upcoming fallback render failed', err && err.message);
  }
}

const urlParams = new URLSearchParams(window.location.search);
const movieId   = urlParams.get('id');
const startTime = parseInt(urlParams.get('t') || '0');

// Placeholder images
const POSTER_PH = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQwIiBoZWlnaHQ9IjM2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTI0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjMzMzIj7wn46YIDM8L3RleHQ+PC9zdmc+';
const THUMB_PH  = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjY4IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxYTFhMjQiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1zaXplPSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM0NDQiPuKWkDwvdGV4dD48L3N2Zz4=';

// Bulletproof image resolver — same policy as app.js/getImageUrl
function mediaUrl(path, size) {
  if (!path) return '';
  if (path.includes('anilist.co')) return path;
  if (path.includes('image.tmdb.org')) return path;
  if (path.includes('cloudinary.com')) return path;
  if (path.startsWith('data:')) return path;
  const filename = String(path).split('/').pop().split('?')[0];
  if (!filename) return '';
  return `https://image.tmdb.org/t/p/${size || 'w500'}/${filename}`;
}

function toast(msg, type = 'success') {
  if (typeof showToast === 'function') showToast(msg, type);
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(text || ''));
  return d.innerHTML;
}

function getShareUnlockKey(movieId) {
  return `${SHARE_UNLOCK_KEY_PREFIX}${movieId}`;
}

function isHighSpeedServerUnlocked(movieId) {
  if (!movieId) return false;
  return localStorage.getItem(getShareUnlockKey(movieId)) === '1';
}

function unlockHighSpeedServer(movieId) {
  if (!movieId) return;
  localStorage.setItem(getShareUnlockKey(movieId), '1');
}

function saveContinueWatchingLocal(payload = {}) {
  const safePayload = {
    movieId: payload.movieId || currentMovieId || '',
    episodeId: payload.episodeId || '',
    title: payload.title || currentMovie?.title || '',
    thumbnailUrl: payload.thumbnailUrl || currentMovie?.thumbnailUrl || '',
    progress: Number(payload.progress || 0),
    totalDuration: Number(payload.totalDuration || 0),
    updatedAt: new Date().toISOString(),
    href: payload.href || window.location.pathname + window.location.search,
  };

  localStorage.setItem(CONTINUE_WATCHING_KEY, JSON.stringify(safePayload));
}

function buildAnimeEpisodeEmbedUrl(tmdbId, seasonNumber, episodeNumber) {
  const id = Number(tmdbId || currentMovie?.tmdbId || currentMovie?.tmdb_id || 0);
  const season = Number(seasonNumber || 1);
  const episode = Number(episodeNumber || 1);
  if (!id || !episode) return '';
  return `https://vidsrc.me/embed/tv?tmdb=${id}&season=${season}&episode=${episode}`;
}

function getAnimeSeasonNumber(movie = {}) {
  const explicit = Number(movie?.animeSeasonNumber || 0);
  if (explicit > 0) return explicit;

  const title = String(movie?.title || '').trim();
  const match = title.match(/\bseason\s*(\d+)\b/i) || title.match(/\bs(\d+)\b/i);
  const parsed = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INIT & EVENT DELEGATION
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.addEventListener('DOMContentLoaded', async () => {
  setupNavbar();
  // Harden: inject fallback CSS unconditionally so episodesGrid never appears empty
  try { injectAnimeFallbackCSS(); const grid = document.getElementById('episodesGrid'); if (grid) grid.setAttribute('data-anime-fallback','1'); } catch (e) {}

  // Quick preflight: fetch movie metadata early to hard-inject an anime episodes fallback
  try {
    if (movieId) {
      const preRes = await fetch(`/api/movies/${movieId}`);
      if (preRes && preRes.ok) {
        const preMovie = await preRes.json();
        const candidate = preMovie?.data || preMovie;
        if (candidate && String(candidate.category || '').toLowerCase() === 'anime') {
          try { injectAnimeFallbackCSS(); } catch (e) {}
          try { const grid = document.getElementById('episodesGrid'); if (grid) grid.setAttribute('data-anime-fallback','1'); } catch (e) {}
          try { ensureUpcomingEpisodeFallback(candidate); } catch (e) {}
        }
      }
    }
  } catch (e) {}

  const token  = localStorage.getItem('token');
userLoggedIn = !!token;

  if (!movieId) { showState('error'); return; }

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await apiFetch(`/movies/${movieId}`, { headers });
    if (!res.ok) {
      throw new Error(`Failed to fetch movie data: HTTP ${res.status}`);
    }

    const movieRaw  = await readJsonResponse(res);
    // API may return { data: movie } or the movie object directly
    const movieData  = movieRaw?.data || movieRaw;
    currentMovie = normalizeMovieState(await hydrateAnimeTmdbId(movieData), movieData);

    if (!currentMovie) {
      throw new Error('Movie data could not be loaded');
    }

    // Soft gate: warn but do NOT crash — Hydra handles anime (anilist_id) without tmdb_id
    if (!currentMovie.tmdbId && !currentMovie.tmdb_id) {
      const hasAnilist = currentMovie.anilistId || currentMovie.anilist_id || currentMovie.providerId;
      if (!hasAnilist) {
        console.warn('[Hydra] No tmdb_id or anilist_id — player may show no servers for this title.');
      }
    }

    currentMovieId = movieData._id || movieData.id;

    renderMovie(currentMovie);

  } catch(e) {
    console.error('Movie load error: Exact reason for failure:', e.message || e);
    showState('error');
    const errorStateEl = document.getElementById('errorState');
    if (errorStateEl) {
      errorStateEl.innerHTML = '<div style="text-align:center;padding:40px;"><h3>Movie Not Found or Unavailable</h3></div>';
    }
  }

  // Bind static buttons
  document.getElementById('watchNowBtn').addEventListener('click', scrollToPlayer);
  document.getElementById('watchlistBtn').addEventListener('click', toggleWatchlist);
  document.getElementById('shareBtn').addEventListener('click', shareMovie);
  document.getElementById('trailerBtn').addEventListener('click', openTrailer);
  document.getElementById('commentSubmitBtn').addEventListener('click', submitComment);
  document.getElementById('shortcutsBtn').addEventListener('click', () => {
    if (typeof VideoPlayer !== 'undefined') VideoPlayer.showShortcuts?.();
  });
  setupShareUnlockHandlers();
  // Server button delegation (replaces old <select>)
  document.getElementById('serverButtons').addEventListener('click', (e) => {
    const btn = e.target.closest('.srv-btn');
    if (!btn || btn.disabled) return;
    const nextIndex = parseInt(btn.dataset.index, 10);
    if (Number.isInteger(nextIndex)) {
      // Always allow manual server switch — even to the same server (force reload)
      switchPlaybackSource(nextIndex);
    }
  });

  // Track comments input chars
  document.getElementById('commentInput').addEventListener('input', function() {
    document.getElementById('commentCharCount').textContent = `${this.value.length} / 500`;
  });

  // â”€â”€ OPTIMIZED EVENT DELEGATION â”€â”€
  // Bound globally ONCE to prevent listener stacking
  
  // 1. Season Tabs Delegation
  document.getElementById('episodeSeasonTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    document.querySelectorAll('#episodeSeasonTabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    
    if (btn.hasAttribute('data-season-number')) {
      const seasonNumber = parseInt(btn.getAttribute('data-season-number'), 10);
      const tmdbId = Number(currentMovie?.tmdbId || currentMovie?.tmdb_id || 0);
      if (typeof loadTmdbSeasonCards === 'function') {
        loadTmdbSeasonCards(tmdbId, seasonNumber);
      }
    } else {
      renderEpisodeCards(seasonsData[btn.dataset.season]);
    }
  });

  // 2. Episodes Grid Delegation
  document.getElementById('episodesGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.episode-card');
    if (!card) return;

    if (card.dataset.animeEp) {
      const s = parseInt(card.dataset.animeSeason) || 1;
      const ep = parseInt(card.dataset.animeEp) || 1;
      playEpisodeInPlace(s, ep);
      return;
    }

    if (card.dataset.epId) {
      // Legacy fallback for custom uploaded episodes could go here, 
      // but for Hydra embeds, we extract season/ep directly.
      const rawText = card.textContent || '';
      const sMatch = rawText.match(/Season\s*(\d+)/i);
      const eMatch = rawText.match(/Episode\s*(\d+)/i);
      const s = sMatch ? parseInt(sMatch[1]) : 1;
      const ep = eMatch ? parseInt(eMatch[1]) : 1;
      playEpisodeInPlace(s, ep);
    }
  });

  // ── IN-PLACE EPISODE PLAYBACK ──
  window.playEpisodeInPlace = async function(season, episode) {
    try {
      showPlayerLoader(true, `Mounting Season ${season} Episode ${episode}...`);
      window.scrollTo({ top: 0, behavior: 'smooth' });

      currentPlayingSeason = season;
      currentPlayingEpisode = episode;

      let hydraSources = [];
      if (typeof EmbedServers !== 'undefined' && typeof EmbedServers.buildHydraSources === 'function') {
        hydraSources = EmbedServers.buildHydraSources(currentMovie, season, episode);
      }
      
      let newSources = [...hydraSources];

      if (newSources.length === 0) {
         showPlayerMessage('No streaming servers available for this episode.', 3000);
         showPlayerLoader(false);
         return;
      }

      playbackSources = reorderSourcesBySessionHealth(newSources);
      activeSourceIndex = 0;
      
      // Update UI active state
      document.querySelectorAll('.episode-card').forEach(c => {
         c.style.borderColor = 'var(--border)';
         const isAnimeMatch = c.dataset.animeSeason == season && c.dataset.animeEp == episode;
         const textMatch = c.textContent.includes(`Season ${season}`) && c.textContent.includes(`Episode ${episode}`);
         if (isAnimeMatch || (c.dataset.epId && textMatch)) {
           c.style.borderColor = 'var(--accent)';
         }
      });

      // Reset the static trust timer for the new stream
      if (typeof switchPlaybackSource !== 'undefined' && switchPlaybackSource._staticTrustTimer) {
        clearTimeout(switchPlaybackSource._staticTrustTimer);
      }
      
      // Update the URL silently for bookmarking/sharing
      const url = new URL(window.location);
      url.searchParams.set('id', currentMovieId);
      url.searchParams.set('season', season);
      url.searchParams.set('episode', episode);
      window.history.pushState({}, '', url);

      renderServerSelector();
      switchPlaybackSource(0);
    } catch (err) {
      console.error('Failed to play episode in-place:', err);
      showPlayerMessage('Failed to initialize episode stream.');
    }
  };

  // 3. Recommendations Grid Delegation
  document.getElementById('recGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.rec-card');
    if (card) window.location.href = `movie-details.html?id=${card.dataset.movieId}`;
  });
  document.getElementById('otherSeasonsGrid')?.addEventListener('click', (e) => {
    const card = e.target.closest('.rec-card');
    if (card) window.location.href = `movie-details.html?id=${card.dataset.movieId}`;
  });

  // 4. Comments Actions Delegation
  document.getElementById('commentsList').addEventListener('click', async (e) => {
    const deleteBtn = e.target.closest('.comment-delete-btn');
    const likeBtn   = e.target.closest('.like-btn');
    if (deleteBtn) await deleteComment(deleteBtn.dataset.id);
    if (likeBtn)   await likeComment(likeBtn.dataset.id, likeBtn);
  });

  // Navbar scroll effect
  window.addEventListener('scroll', () => {
    document.getElementById('navbar').classList.toggle('scrolled', window.scrollY > 50);
  });
});

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SHOW STATE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showState(state) {
  document.getElementById('loadingState').style.display = state === 'loading' ? 'block' : 'none';
  document.getElementById('movieContent').style.display = state === 'content' ? 'block' : 'none';
  document.getElementById('errorState').style.display   = state === 'error'   ? 'block' : 'none';
}

function setPlayerStatus(message, variant = '') {
  const statusEl = document.getElementById('playerStatus');
  if (!statusEl) return;
  statusEl.textContent = message || '';
  statusEl.className = `player-status${variant ? ` is-${variant}` : ''}`;
}

function showPlayerLoader(show, text = 'Loading stream...') {
  const loader = document.getElementById('playerLoader');
  const textEl = loader?.querySelector('.player-loader-text');
  if (textEl) textEl.textContent = text;
  loader?.classList.toggle('is-visible', !!show);
}

function showPlayerMessage(message, duration = 2200) {
  const el = document.getElementById('playerMessage');
  if (!el) return;
  el.textContent = message || '';
  el.classList.add('is-visible');
  clearTimeout(showPlayerMessage.timer);
  showPlayerMessage.timer = setTimeout(() => {
    el.classList.remove('is-visible');
  }, duration);
}

function getVideoElement() {
  return document.getElementById('videoPlayer');
}

function getEmbedFrame() {
  return document.getElementById('embedFrame');
}

function getEmbedShell() {
  return document.getElementById('embedShell');
}

function getEmbedPlayerHost() {
  return document.getElementById('embedPlayerHost');
}

function getNativeShell() {
  return document.getElementById('nativePlayerShell');
}

function activatePlaybackSurface(mode) {
  const nativeShell = getNativeShell();
  const embedShell = getEmbedShell();
  if (nativeShell) {
    nativeShell.classList.toggle('is-active', mode === 'native');
    nativeShell.style.display = mode === 'native' ? 'block' : 'none';
  }
  if (embedShell) {
    embedShell.classList.toggle('is-active', mode === 'embed');
    embedShell.style.display = mode === 'embed' ? 'block' : 'none';
  }
}

function destroyEmbedPlayer() {
  if (activeEmbedPlayer && typeof activeEmbedPlayer.destroy === 'function') {
    try {
      activeEmbedPlayer.destroy();
    } catch {}
  }
  activeEmbedPlayer = null;
}

function stopEmbedPlayback() {
  destroyEmbedPlayer();
  const frame = getEmbedFrame();
  if (frame) {
    frame.removeAttribute('srcdoc');
    frame.removeAttribute('src');
  }
}

function initProviderPlayer(source) {
  destroyEmbedPlayer();
  return null;
}

function revokeProviderSubtitleUrls() {
  providerSubtitleBlobUrls.forEach((url) => {
    try { URL.revokeObjectURL(url); } catch {}
  });
  providerSubtitleBlobUrls = [];
}

async function loadProviderSubtitleTracks(source) {
  try {
    if (!source?.url || source.server === 'upload') return;

    const response = await apiFetch(`/subtitles?url=${encodeURIComponent(source.url)}&sourceType=${encodeURIComponent(source.sourceType || source.server)}&langs=en,hi,ja`, { silent: true });
    const payload = await readJsonResponse(response);
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    if (!tracks.length) return;

    const video = getVideoElement();
    if (video && getNativeShell()?.classList.contains('is-active')) {
      revokeProviderSubtitleUrls();
      video.querySelectorAll('track[data-provider-track="true"]').forEach((track) => track.remove());

      tracks.forEach((track, index) => {
        try {
          const blobUrl = URL.createObjectURL(new Blob([track.vtt], { type: 'text/vtt' }));
          providerSubtitleBlobUrls.push(blobUrl);
          const element = document.createElement('track');
          element.kind = 'subtitles';
          element.label = track.label || track.language || `Subtitle ${index + 1}`;
          element.srclang = track.language || 'en';
          element.src = blobUrl;
          element.default = index === 0;
          element.dataset.providerTrack = 'true';
          video.appendChild(element);
        } catch {}
      });
    } else {
      showPlayerMessage(`Captions available: ${tracks.map((track) => track.language?.toUpperCase()).filter(Boolean).join(', ')}`);
    }
  } catch (error) {
    console.warn('Provider subtitle load failed:', error.message);
  }
}

function renderSourceOffline(source, reason = 'Content currently unavailable. Please try another server.') {
  markProviderFailed(source);
  stopEmbedPlayback();
  activatePlaybackSurface('embed');
  showPlayerLoader(false);
  setPlayerStatus('Stream unavailable on this provider.', 'error');

  const frame = getEmbedFrame();
  if (!frame) return;
  frame.removeAttribute('srcdoc');
  frame.removeAttribute('src');
  showPlayerMessage(
    'Provider blocked or unstable. Auto-switching to next server. If all fail, open another server manually.',
    4200
  );
}

function ensureNativePlayer(movie) {
  const video = getVideoElement();
  if (!video || typeof VideoPlayer === 'undefined' || !VideoPlayer.init) return;

  if (!nativePlayerInitialized) {
    VideoPlayer.init('videoPlayer', 'nativePlayerShell', movie._id);
    nativePlayerInitialized = true;
  }

  VideoPlayer.loadQualities?.(movie.qualities || {});
  if (movie.subtitles?.length > 0) {
    VideoPlayer.loadSubtitles?.(movie.subtitles);
  }

  if (!progressTrackingReady) {
    setupProgressTracking();
    progressTrackingReady = true;
  }
}

function wireNativeFallback() {
  const video = getVideoElement();
  if (!video || video.dataset.multiSourceBound === 'true') return;

  video.dataset.multiSourceBound = 'true';
  video.addEventListener('error', () => {
    if (activeSourceIndex < playbackSources.length - 1) {
      showPlayerMessage('Switching server...');
      setPlayerStatus('Current source failed. Trying another server...', 'switching');
      switchPlaybackSource(activeSourceIndex + 1, { auto: true });
    } else {
      showPlayerLoader(false);
      setPlayerStatus('Playback failed for all available servers.', 'error');
      showPlayerMessage('No working server available right now.', 3200);
    }
  });
}

function renderServerSelector() {
  const switcher = document.getElementById('serverSwitcher');
  const btnContainer = document.getElementById('serverButtons');
  if (!switcher || !btnContainer) return;

  if (!playbackSources.length) {
    switcher.style.display = 'none';
    btnContainer.innerHTML = '';
    const existingReset = document.getElementById('resetFailedServersBtn');
    if (existingReset) existingReset.remove();
    return;
  }

  switcher.style.display = playbackSources.length > 1 ? 'flex' : 'none';
  const failedProviders = new Set(getFailedProviders());

  // ── Hydra numbered server buttons: "Server 1", "Server 2", etc. ──
  btnContainer.innerHTML = playbackSources.map((source, index) => {
    const isActive = index === activeSourceIndex;
    const status = source.status || 'unknown';
    const isSessionFailed = failedProviders.has(String(source.server || '').trim().toLowerCase());
    const isFailed = status === 'failed' || isSessionFailed;
    const statusColor = isSessionFailed
      ? '#ef4444'
      : (status === 'working' ? '#22c55e' : isFailed ? '#ef4444' : '#fbbf24');
    const serverNum = index + 1;
    // Friendly tooltip shows the actual provider name
    const providerName = source.serverName || source.label || `Server ${serverNum}`;

    return `
      <button
        class="srv-btn ${isActive ? 'srv-active' : ''} ${isFailed ? 'srv-failed' : ''}"
        data-index="${index}"
        id="srvBtn${serverNum}"
        title="${escapeHtml(providerName)}${isFailed ? ' (Previously failed — click to retry)' : ''}"
        style="
          padding: 7px 18px;
          border: 1.5px solid ${isActive ? 'var(--accent, #e50914)' : 'rgba(255,255,255,0.18)'};
          background: ${isActive ? 'linear-gradient(135deg, var(--accent, #e50914), #c40812)' : 'rgba(255,255,255,0.04)'};
          color: ${isActive ? '#fff' : 'rgba(255,255,255,0.75)'};
          border-radius: 8px;
          cursor: pointer;
          font-size: 12.5px;
          font-weight: ${isActive ? '600' : '500'};
          letter-spacing: 0.3px;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 7px;
          opacity: ${isFailed ? '0.55' : '1'};
          box-shadow: ${isActive ? '0 2px 12px rgba(229,9,20,0.35)' : 'none'};
        "
      >
        <span style="width:7px;height:7px;border-radius:50%;background:${statusColor};box-shadow:0 0 5px ${statusColor}88;flex-shrink:0;"></span>
        Server ${serverNum}
      </button>
    `;
  }).join('');

  let resetBtn = document.getElementById('resetFailedServersBtn');
  if (!resetBtn) {
    resetBtn = document.createElement('button');
    resetBtn.id = 'resetFailedServersBtn';
    resetBtn.type = 'button';
    resetBtn.style.cssText = `
      margin-left: 8px;
      padding: 6px 10px;
      border: 1px solid rgba(255,255,255,0.25);
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.9);
      border-radius: 8px;
      cursor: pointer;
      font-size: 12px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    `;
    resetBtn.innerHTML = '<i class="ri-refresh-line"></i> Reset Servers';
    switcher.appendChild(resetBtn);
  }
  resetBtn.style.display = failedProviders.size > 0 ? 'inline-flex' : 'none';
  resetBtn.onclick = () => {
    setFailedProviders([]);
    playbackSources = reorderSourcesBySessionHealth(playbackSources);
    activeSourceIndex = 0;
    renderServerSelector();
    showPlayerMessage('Server list reset for this session.', 2400);
  };

  // ── Helper Text UX: inject hint below server buttons ──
  let helperText = document.getElementById('serverHelperText');
  if (!helperText && playbackSources.length > 1) {
    helperText = document.createElement('p');
    helperText.id = 'serverHelperText';
    helperText.className = 'server-helper-text';
    helperText.innerHTML = '💡 <strong>Tip:</strong> If a video doesn\'t load or shows an error, please try selecting a different Server.';
    helperText.style.cssText = `
      margin: 8px 0 0 0;
      padding: 0;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.45);
      text-align: left;
      line-height: 1.5;
      width: 100%;
      letter-spacing: 0.2px;
    `;
    switcher.appendChild(helperText);
  }
}

function renderNoPlaybackState() {
  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('videoContainer').style.display = 'block';
  document.getElementById('ratingWrapper').style.display = 'flex';
  activatePlaybackSurface('native');
  stopEmbedPlayback();
  const video = getVideoElement();
  if (video) {
    video.removeAttribute('src');
    video.load();
  }
  showPlayerLoader(false);
  setPlayerStatus('Video not available yet.', 'error');
  document.getElementById('serverSwitcher').style.display = 'none';
  document.getElementById('playerMessage').classList.remove('is-visible');
  const nativeShell = getNativeShell();
  if (nativeShell) {
    nativeShell.innerHTML = `
      <div class="player-error-state">
        <i class="ri-film-line"></i>
        <h3 style="margin:0;font-size:20px;">Playback unavailable</h3>
        <p>Content currently unavailable. Please try another server.</p>
      </div>`;
  }
}

function restoreNativeShellMarkup() {
  const nativeShell = getNativeShell();
  if (!nativeShell || nativeShell.querySelector('#videoPlayer')) return;
  nativeShell.innerHTML = `
    <video id="videoPlayer" preload="metadata" playsinline style="width:100%;display:block;height:100%;background:#000;">
      Your browser does not support video.
    </video>`;
  nativePlayerInitialized = false;
  progressTrackingReady = false;
}

async function switchPlaybackSource(index, options = {}) {
  if (!playbackSources[index]) return;

  restoreNativeShellMarkup();
  wireNativeFallback();
  getVideoElement()?.pause();

  activeSourceIndex = index;
  renderServerSelector();
  const source = playbackSources[index];
  const switchToken = ++activePlayerSwitchToken;
  const shortcutsBtn = document.getElementById('shortcutsBtn');
  showPlayerLoader(true, options.auto ? 'Switching server...' : 'Loading stream...');
  setPlayerStatus(`Playing from ${source.label}`, options.auto ? 'switching' : '');
  if (shortcutsBtn) {
    shortcutsBtn.style.opacity = source.server === 'upload' ? '1' : '0.55';
  }

  if (source.server === 'upload') {
    revokeProviderSubtitleUrls();
    stopEmbedPlayback();
    activatePlaybackSurface('native');
    const video = getVideoElement();
    if (!video) return;

    ensureNativePlayer(currentMovie);
    video.poster = mediaUrl(currentMovie?.thumbnailUrl) || '';
    video.src = mediaUrl(source.playUrl || source.url);
    video.currentTime = 0;
    video.load();

    const onCanPlay = () => {
      if (switchToken !== activePlayerSwitchToken) return;
      clearTimeout(switchPlaybackSource.embedTimer);
      showPlayerLoader(false);
      setPlayerStatus(`Now playing â€¢ ${source.quality || 'HD'}`);
      if (startTime > 0 && video.currentTime < startTime) {
        video.currentTime = startTime;
      }
      video.play().catch(() => {});
      video.removeEventListener('canplay', onCanPlay);
    };

    video.addEventListener('canplay', onCanPlay);
    return;
  }

  // External embed source - use popup player (embed servers block iframes)
  showPlayerLoader(false);
  source.status = 'ready';
  renderServerSelector();

  // Hide video player, show popup shell OR direct iframe embed shell
  const nativeShell = getNativeShell();
  const popupShell = document.getElementById('popupPlayerShell');
  const embedShell = getEmbedShell();
  const frame = getEmbedFrame();

  if (nativeShell) nativeShell.classList.remove('is-active');
  if (embedShell) {
    embedShell.style.display = 'block';
    embedShell.classList.add('is-active');
  }

  if (frame && source.embedUrl) {
    frame.src = source.embedUrl;
    if (popupShell) popupShell.style.display = 'none';
    setPlayerStatus(`Playing from ${source.label}`);
  } else {
    // Fallback to popup
    if (popupShell) {
      popupShell.style.display = 'block';
      popupShell.classList.add('is-active');
      const btn = document.getElementById('btnWatchPopupMain');
      if (btn) {
        btn.onclick = () => window.open(source.embedUrl || source.url, '_blank', 'width=1000,height=600,noopener,noreferrer');
      }
    }
    if (embedShell) {
      embedShell.style.display = 'none';
      embedShell.classList.remove('is-active');
    }
    setPlayerStatus(`Click "Watch Now" to open ${source.label}`);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// AUTO-EMBED PLAYER — Zero-touch source generation from tmdbId
//
// When a movie has no uploaded videoUrl and no manually-added sources,
// this delegates to EmbedServers.buildHydraSources() which is the
// single source of truth for all embed providers and their URLs.
// ══════════════════════════════════════════════════════════════════════════
function buildAutoEmbedSources(movie) {
  if (typeof EmbedServers !== 'undefined' && typeof EmbedServers.buildHydraSources === 'function') {
    return EmbedServers.buildHydraSources(movie);
  }
  return [];
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RENDER MOVIE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function renderMovie(m) {
  document.title = `Watch ${m.title} Full HD Free Online - CinePulse`;
  const seoDescription = `Stream ${m.title} in 1080p with English, Hindi, and Korean subtitles. Fast servers and no registration required on CinePulse.`;
  let metaDescription = document.querySelector('meta[name="description"]');
  if (!metaDescription) {
    metaDescription = document.createElement('meta');
    metaDescription.setAttribute('name', 'description');
    document.head.appendChild(metaDescription);
  }
  metaDescription.setAttribute('content', seoDescription);
  injectMovieJsonLd(m);

  const bgUrl = m.bannerUrl || m.thumbnailUrl || '';
  document.getElementById('detailsBg').style.backgroundImage = bgUrl ? `url('${mediaUrl(bgUrl, 'original')}')` : '';

  const posterEl = document.getElementById('moviePoster');
  posterEl.src     = mediaUrl(m.thumbnailUrl) || POSTER_PH;
  posterEl.onerror = () => { posterEl.src = POSTER_PH; };

  document.getElementById('movieCategory').textContent  = m.category    || '';
  document.getElementById('movieTitle').textContent     = m.title       || '';
  document.getElementById('movieDesc').textContent      = m.description || '';
  document.getElementById('movieYear').textContent      = m.releaseYear || '';
  document.getElementById('movieAgeRating').textContent = m.rating      || '';

  const h   = Math.floor((m.duration || 0) / 60);
  const min = (m.duration || 0) % 60;
  document.getElementById('movieDuration').textContent = h > 0 ? `${h}h ${min}m` : `${min}m`;

  document.getElementById('movieRating').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="var(--gold, #fbbf24)" style="vertical-align:text-bottom;margin-right:4px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${m.averageRating || 'N/A'} (${m.numRatings || 0} ratings)`;

  if (m.status && m.status !== 'Completed') {
    const badge = document.getElementById('movieStatusBadge');
    badge.textContent   = m.status;
    badge.style.display = 'inline';
    badge.style.background = m.status === 'Ongoing'  ? 'rgba(52,211,153,0.15)'  :
                             m.status === 'Upcoming' ? 'rgba(251,191,36,0.15)' : 'rgba(255,255,255,0.1)';
    badge.style.color = m.status === 'Ongoing'  ? '#34d399' :
                        m.status === 'Upcoming' ? '#fbbf24' : 'var(--text-muted)';
  }

  document.getElementById('movieGenres').innerHTML = (m.genre || []).map(g => 
    `<span class="genre-tag">${escapeHtml(g)}</span>`
  ).join('');

  document.getElementById('detailDirector').textContent = m.director  || '—';
  document.getElementById('detailStudio').textContent   = m.studio    || '—';
  document.getElementById('detailLanguage').textContent = m.language  || '—';
  document.getElementById('detailViews').textContent    = (m.views || 0).toLocaleString();
  document.getElementById('detailYear').textContent     = m.releaseYear || '—';
  document.getElementById('detailRating').textContent   = m.rating    || '—';

  // Show status/episode count for all multi-episode content types
  const catLower = String(m.category || '').toLowerCase();
  const isMultiEpisode = ['anime', 'series', 'cartoon', 'tv', 'k-drama', 'asian-drama', 'asian_drama', 'kdrama'].includes(catLower);
  if (isMultiEpisode) {
    if (m.status) {
      document.getElementById('detailStatusWrap').style.display = 'block';
      document.getElementById('detailStatus').textContent       = m.status;
    }
    if (m.totalEpisodes > 0) {
      document.getElementById('detailEpisodesWrap').style.display = 'block';
      document.getElementById('detailEpisodes').textContent       = m.totalEpisodes;
    }
  }

  if (m.cast && m.cast.length > 0) {
    document.getElementById('castSection').style.display = 'block';
    document.getElementById('castList').innerHTML = m.cast.map(n =>
      '<span style="background:var(--bg-card);padding:6px 16px;border-radius:20px; font-size:13px;color:var(--text-secondary);border:1px solid var(--border);">' + escapeHtml(n) + '</span>'
    ).join('');
  }

  if (m.trailerUrl) {
    document.getElementById('trailerBtn').style.display = 'inline-flex';
  }

  if (typeof isAdmin === 'function' && isAdmin()) {
    const deleteBtn = document.getElementById('adminDeleteMovieBtn');
    if (deleteBtn) {
      deleteBtn.style.display = 'inline-flex';
      deleteBtn.onclick = deleteMovie;
    }
  }

  setupPlayback(m);

  document.getElementById('playerTitle').textContent = m.title;

  // ── EPISODES: trigger for ALL multi-episode content, not just anime/series/cartoon ──
  if (isMultiEpisode) {
    // Ensure upcoming-episode fallback renders quickly for anime
    if (catLower === 'anime') {
      try { ensureUpcomingEpisodeFallback(m); } catch (e) {}
    }
    loadEpisodes(m._id);
    // Re-check after episodes load; if the grid is still empty, force the upcoming card for anime
    if (catLower === 'anime') {
      try { setTimeout(() => ensureUpcomingEpisodeFallback(m), 1200); } catch (e) {}
    }
  }

  // ULTRA-AGGRESSIVE: Unconditional grid fill for anime after delay
  if (catLower === 'anime') {
    setTimeout(() => {
      const grid = document.getElementById('episodesGrid');
      if (!grid) return;
      const hasEpisodeCards = Array.from(grid.children || []).some(c =>
        c.classList && (c.classList.contains('episode-card') || c.classList.contains('tmdb-ep-row'))
      );
      if (hasEpisodeCards) return;
      const html = grid.innerHTML || '';
      if (html.includes('episode-card') || html.includes('tmdb-ep-row') || (html.trim() !== '' && !html.includes('spinner'))) return;
      const ep = (m.nextAiringEpisode?.episode || m.totalEpisodes || 1);
      const season = m.seasonNumber || 1;
      grid.innerHTML = '<div class="episode-card" style="cursor:pointer;">' +
        '<div style="padding:20px;text-align:center;background:rgba(255,255,255,0.05);border-radius:8px;">' +
          '<div style="font-size:18px;font-weight:600;margin-bottom:10px;">Season ' + season + ' · Episode ' + ep + '</div>' +
          '<div style="color:var(--text-muted);font-size:14px;">' + escapeHtml((m.title || 'Anime').substring(0, 40)) + '</div>' +
          '<div style="margin-top:15px;padding:8px 16px;background:rgba(52,211,153,0.2);border-radius:6px;color:#34d399;font-size:12px;">Upcoming Episode</div>' +
        '</div>' +
      '</div>';
    }, 2500);
    try {
      injectAnimeFallbackCSS();
      var fallbackGrid = document.getElementById('episodesGrid');
      if (fallbackGrid) fallbackGrid.setAttribute('data-anime-fallback', '1');
    } catch (e) {}
  }

  setupCommentSection();
  loadComments();
  loadRecommendations(m._id, m.title);
  loadOtherSeasons(m._id, m.title);
  showState('content');
}

// ─────────────────────────────────────────────────────────────────────────
// ANIME FALLBACK CSS — injected once to prevent empty episode grid
// Must be defined OUTSIDE renderMovie (was accidentally nested before)
// ─────────────────────────────────────────────────────────────────────────
function injectAnimeFallbackCSS() {
  if (document.getElementById('anime-episodes-fallback')) return;
  var css =
    '#episodesGrid[data-anime-fallback="1"] .spinner-container { display: none !important; }' +
    '#episodesGrid[data-anime-fallback="1"] .empty-state { display: none !important; }' +
    '#episodesGrid[data-anime-fallback="1"]:empty::before {' +
      'content: "Upcoming episode coming soon";' +
      'display: block; grid-column: 1 / -1; padding: 18px; margin: 8px 0;' +
      'background: rgba(255,255,255,0.02); color: var(--text-muted, #9aa);' +
      'border-radius: 8px; text-align: center; font-weight: 600;' +
    '}\n' +
    '/* ── Anime Chunking UI ── */\n' +
    '.anime-episode-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 10px; margin-top: 15px; }\n' +
    '.ep-btn { background: rgba(255,255,255,0.05); color: #fff; border: 1px solid rgba(255,255,255,0.1); border-radius: 6px; padding: 10px 0; cursor: pointer; transition: all 0.2s; font-weight: 600; text-align: center; }\n' +
    '.ep-btn:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.3); }\n' +
    '.ep-btn.active { background: rgba(52,211,153,0.2); color: #34d399; border-color: #34d399; }\n' +
    '.chunk-dropdown { padding: 10px; border-radius: 6px; background: rgba(0,0,0,0.5); color: #fff; border: 1px solid rgba(255,255,255,0.1); margin-bottom: 10px; width: 100%; max-width: 300px; cursor: pointer; }';
  var s = document.createElement('style');
  s.id = 'anime-episodes-fallback';
  s.appendChild(document.createTextNode(css));
  document.head.appendChild(s);
}

window.drawAnimeChunk = function(startEp, endEp, seasonNumber) {
  const container = document.getElementById('animeEpContainer');
  if (!container) return;
  
  let html = '';
  for (let i = startEp; i <= endEp; i++) {
    const isActive = (window.currentPlayingSeason == seasonNumber && window.currentPlayingEpisode == i);
    html += `<div class="ep-btn ${isActive ? 'active' : ''}" data-anime-season="${seasonNumber}" data-anime-ep="${i}">EP ${i}</div>`;
  }
  container.innerHTML = html;
};

window.renderAnimeEpisodes = function(totalEpisodes, seasonNumber) {
  const grid = document.getElementById('episodesGrid');
  const chunks = Math.ceil(totalEpisodes / 50);
  
  let dropdownHtml = '<select id="animeChunkSelect" class="chunk-dropdown">';
  for (let i = 0; i < chunks; i++) {
    const start = i * 50 + 1;
    const end = Math.min((i + 1) * 50, totalEpisodes);
    dropdownHtml += `<option value="${start}-${end}">Episodes ${start} - ${end}</option>`;
  }
  dropdownHtml += '</select>';
  
  const containerHtml = '<div id="animeEpContainer" class="anime-episode-grid"></div>';
  grid.innerHTML = dropdownHtml + containerHtml;
  
  const select = document.getElementById('animeChunkSelect');
  select.addEventListener('change', (e) => {
    const [start, end] = e.target.value.split('-').map(Number);
    window.drawAnimeChunk(start, end, seasonNumber);
  });
  
  window.drawAnimeChunk(1, Math.min(50, totalEpisodes), seasonNumber);
  
  grid.addEventListener('click', (e) => {
    const btn = e.target.closest('.ep-btn');
    if (!btn) return;
    
    // UI Update handled mostly inside playEpisodeInPlace, but we can do a quick active set
    document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    const s = parseInt(btn.dataset.animeSeason) || 1;
    const ep = parseInt(btn.dataset.animeEp) || 1;
    window.playEpisodeInPlace(s, ep);
  });
};

function injectMovieJsonLd(movie) {
  // ─────────────────────────────────────────────────────────────────────
  // PROGRAMMATIC SEO — Schema.org JSON-LD injection
  //
  // Called from renderMovie() every time movie data loads or changes.
  // Removes any previously injected script first so re-renders are safe.
  //
  // Schema type mapping:
  //   anime | series | cartoon | tv  → TVSeries
  //   movie | documentary | short    → Movie
  //
  // Fields mapped from MongoDB API response:
  //   title, description, releaseYear, genre, language, thumbnailUrl,
  //   bannerUrl, director, cast, rating (contentRating), averageRating,
  //   numRatings, totalEpisodes, trailerUrl, tmdbId, anilistId, _id
  // ─────────────────────────────────────────────────────────────────────

  // 1. Remove any existing JSON-LD tag (idempotent — safe to call multiple times)
  const existing = document.getElementById('movie-jsonld');
  if (existing) existing.remove();

  if (!movie) return;

  // 2. Resolve canonical page URL
  //    Prefer the clean /watch/<category>/<id> path so Google indexes
  //    the pretty URL, not the raw ?id= query string.
  const movieDbId   = String(movie._id || movie.id || '');
  const category    = String(movie.category || 'movie').toLowerCase();
  const origin      = window.location.origin;

  // Map category → clean URL segment
  const categorySlug = {
    movie:        'movie',
    series:       'series',
    anime:        'anime',
    cartoon:      'cartoon',
    documentary:  'documentary',
    short:        'movie',
    tv:           'tv',
  }[category] || 'movie';

  const canonicalUrl = movieDbId
    ? `${origin}/watch/${categorySlug}/${movieDbId}`
    : window.location.href;

  // 3. Determine Schema.org @type
  const isTvLike = ['series', 'anime', 'cartoon', 'tv'].includes(category);
  const schemaType = isTvLike ? 'TVSeries' : 'Movie';

  // 4. Resolve image URL (reuse the same mediaUrl helper already in scope)
  const imageUrl = movie.thumbnailUrl
    ? mediaUrl(movie.thumbnailUrl, 'w500')
    : (movie.bannerUrl ? mediaUrl(movie.bannerUrl, 'original') : undefined);

  // 5. Build sameAs array — links to authoritative external sources
  const sameAs = [];
  const tmdbId = Number(movie.tmdbId || movie.tmdb_id || 0);
  const anilistId = Number(movie.anilistId || movie.anilist_id || 0);
  if (tmdbId > 0) {
    sameAs.push(
      isTvLike
        ? `https://www.themoviedb.org/tv/${tmdbId}`
        : `https://www.themoviedb.org/movie/${tmdbId}`
    );
  }
  if (anilistId > 0) {
    sameAs.push(`https://anilist.co/anime/${anilistId}`);
  }
  if (Number(movie.idMal || 0) > 0) {
    sameAs.push(`https://myanimelist.net/anime/${movie.idMal}`);
  }

  // 6. Build director node (Schema.org Person)
  const directorNode = movie.director
    ? { '@type': 'Person', name: String(movie.director).trim() }
    : undefined;

  // 7. Build actor nodes (Schema.org Person[])
  const actorNodes = Array.isArray(movie.cast) && movie.cast.length
    ? movie.cast.slice(0, 10).map((name) => ({
        '@type': 'Person',
        name: String(name || '').trim(),
      })).filter((p) => p.name)
    : undefined;

  // 8. Build trailer node (Schema.org VideoObject)
  const trailerNode = movie.trailerUrl
    ? {
        '@type':        'VideoObject',
        name:           `${movie.title || ''} — Official Trailer`,
        embedUrl:       String(movie.trailerUrl).trim(),
        thumbnailUrl:   imageUrl,
        description:    `Official trailer for ${movie.title || ''}`,
        uploadDate:     movie.releaseYear ? `${movie.releaseYear}-01-01` : undefined,
      }
    : undefined;

  // 9. Build aggregateRating node
  const ratingNode = (movie.averageRating > 0)
    ? {
        '@type':       'AggregateRating',
        ratingValue:   Number(movie.averageRating).toFixed(1),
        bestRating:    '10',
        worstRating:   '1',
        ratingCount:   Math.max(1, Number(movie.numRatings || 1)),
      }
    : undefined;

  // 10. Build WatchAction potentialAction — tells Google this page streams the content
  const watchActionNode = {
    '@type':  'WatchAction',
    target:   canonicalUrl,
  };

  // 11. Assemble the schema object — omit undefined keys cleanly
  const schema = {
    '@context':    'https://schema.org',
    '@type':       schemaType,
    '@id':         canonicalUrl,
    name:          String(movie.title || '').trim(),
    url:           canonicalUrl,
    description:   String(movie.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 500) || undefined,
    datePublished: movie.releaseYear ? `${movie.releaseYear}-01-01` : undefined,
    genre:         Array.isArray(movie.genre) && movie.genre.length ? movie.genre : undefined,
    inLanguage:    String(movie.language || movie.original_language || 'en').trim() || undefined,
    contentRating: movie.rating ? String(movie.rating).trim() : undefined,
    image:         imageUrl,
    ...(directorNode  ? { director:         directorNode  } : {}),
    ...(actorNodes    ? { actor:             actorNodes    } : {}),
    ...(trailerNode   ? { trailer:           trailerNode   } : {}),
    ...(ratingNode    ? { aggregateRating:   ratingNode    } : {}),
    ...(sameAs.length ? { sameAs }                          : {}),
    potentialAction: watchActionNode,
    // TVSeries-specific fields
    ...(isTvLike && movie.totalEpisodes > 0
      ? { numberOfEpisodes: Number(movie.totalEpisodes) }
      : {}),
    ...(isTvLike && movie.status
      ? {
          // Map internal status → Schema.org status
          creativeWorkStatus: {
            Ongoing:    'Active',
            Completed:  'Completed',
            Upcoming:   'Upcoming',
            Cancelled:  'Discontinued',
          }[movie.status] || movie.status,
        }
      : {}),
    // Movie-specific: duration in ISO 8601 (PT2H30M)
    ...(!isTvLike && movie.duration > 0
      ? {
          duration: (() => {
            const totalMins = Math.round(Number(movie.duration));
            const h = Math.floor(totalMins / 60);
            const m = totalMins % 60;
            return h > 0 ? `PT${h}H${m > 0 ? `${m}M` : ''}` : `PT${m}M`;
          })(),
        }
      : {}),
  };

  // 12. Inject the <script> tag into <head>
  const scriptEl = document.createElement('script');
  scriptEl.type = 'application/ld+json';
  scriptEl.id   = 'movie-jsonld';
  scriptEl.text = JSON.stringify(schema, null, 0);
  document.head.appendChild(scriptEl);

  // 13. Also update Open Graph + Twitter Card meta tags in the same pass
  //     so social shares and crawlers get consistent data.
  _upsertMeta('property', 'og:type',        isTvLike ? 'video.tv_show' : 'video.movie');
  _upsertMeta('property', 'og:title',       movie.title || '');
  _upsertMeta('property', 'og:description', schema.description || '');
  _upsertMeta('property', 'og:url',         canonicalUrl);
  _upsertMeta('property', 'og:image',       imageUrl || '');
  _upsertMeta('property', 'og:site_name',   'CineStream');
  _upsertMeta('name',     'twitter:card',   'summary_large_image');
  _upsertMeta('name',     'twitter:title',  movie.title || '');
  _upsertMeta('name',     'twitter:description', schema.description || '');
  _upsertMeta('name',     'twitter:image',  imageUrl || '');

  // 14. Inject / update <link rel="canonical"> so Google uses the clean URL
  let canonicalLink = document.querySelector('link[rel="canonical"]');
  if (!canonicalLink) {
    canonicalLink = document.createElement('link');
    canonicalLink.rel = 'canonical';
    document.head.appendChild(canonicalLink);
  }
  canonicalLink.href = canonicalUrl;
}

// ─────────────────────────────────────────────────────────────────────────
// _upsertMeta — create-or-update a <meta> tag by attribute selector
// Used by injectMovieJsonLd to keep OG/Twitter tags in sync.
// ─────────────────────────────────────────────────────────────────────────
function _upsertMeta(attrName, attrValue, content) {
  if (!content) return;
  let el = document.querySelector(`meta[${attrName}="${attrValue}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attrName, attrValue);
    document.head.appendChild(el);
  }
  el.setAttribute('content', String(content));
}

// ─────────────────────────────────────────────────────────────────────────
// RATING STARS
// ─────────────────────────────────────────────────────────────────────────
function renderRatingStars() {
  const container = document.getElementById('ratingStars');
  container.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.innerHTML    = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
    btn.title          = `Rate ${i}/10`;
    btn.dataset.rating = i;
    btn.addEventListener('mouseenter', () => highlightStars(i));
    btn.addEventListener('mouseleave', () => highlightStars(0));
    btn.addEventListener('click',      () => submitRating(i));
    container.appendChild(btn);
  }
}

function highlightStars(n) {
  document.querySelectorAll('#ratingStars button').forEach((s, i) => {
    s.style.color = i < n ? 'var(--gold)' : 'var(--text-muted)';
  });
}

async function submitRating(rating) {
  if (!userLoggedIn) { toast('Login to rate', 'error'); return; }
  const token = localStorage.getItem('token');
  try {
    const res  = await apiFetch(`/movies/${currentMovieId}/rate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ rating }),
    });
    const data = await readJsonResponse(res);
    if (res.ok) {
      highlightStars(rating);
      document.getElementById('movieRating').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="var(--gold, #fbbf24)" style="vertical-align:text-bottom;margin-right:4px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${data.averageRating} (${data.numRatings} ratings)`;
      toast(`Rated ${rating}/10`, 'success');
    } else {
      toast(data.message || 'Already rated', 'error');
    }
  } catch(e) { toast('Failed to rate', 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────
// PROGRESS TRACKING
// ─────────────────────────────────────────────────────────────────────────
function setupProgressTracking() {
  const video = document.getElementById('videoPlayer');
  if (!video || !userLoggedIn) return;

  const doSave = (ct, td) => apiSaveProgress(ct, td);

  video.addEventListener('timeupdate', function() {
    if (!this.paused) {
      clearTimeout(progressTimer);
      progressTimer = setTimeout(() => doSave(this.currentTime, this.duration), 15000);
    }
  });

  video.addEventListener('pause', function() { doSave(this.currentTime, this.duration); });
  video.addEventListener('ended', function() { doSave(this.duration, this.duration); });
}

async function apiSaveProgress(ct, td) {
  const token = localStorage.getItem('token');
  if (!token || !currentMovieId || !td || !isFinite(td)) return;
  try {
    saveContinueWatchingLocal({
      movieId: currentMovieId,
      title: currentMovie?.title || '',
      thumbnailUrl: currentMovie?.thumbnailUrl || '',
      progress: Math.floor(ct),
      totalDuration: Math.floor(td),
      href: `/pages/movie-details.html?id=${currentMovieId}&t=${Math.floor(ct)}`,
    });

    await apiFetch('/watch/progress', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({
        movieId:       currentMovieId,
        progress:      Math.floor(ct),
        totalDuration: Math.floor(td),
      }),
    });
  } catch(e) {}
}

// ─────────────────────────────────────────────────────────────────────────
// TRAILER & WATCHLIST
// ─────────────────────────────────────────────────────────────────────────
function openTrailer() {
  const url = currentMovie?.trailerUrl;
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function deleteMovie() {
  if (!currentMovieId || !window.confirm(`Delete "${currentMovie?.title || 'this movie'}"? This action cannot be undone.`)) {
    return;
  }

  const token = localStorage.getItem('token');
  if (!token) {
    toast('You must be logged in as an admin to delete movies.', 'error');
    return;
  }

  try {
    const res = await apiFetch(`/movies/${currentMovieId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const payload = await readJsonResponse(res);
    if (res.ok && payload.success) {
      toast('Movie deleted successfully.', 'success');
      window.location.href = '/';
    } else {
      toast(payload.message || 'Delete failed', 'error');
    }
  } catch (error) {
    toast(error.message || 'Delete failed', 'error');
  }
}

async function toggleWatchlist() {
  if (!userLoggedIn) { toast('Login to add to your list', 'error'); return; }
  const token = localStorage.getItem('token');
  try {
    const res  = await apiFetch(`/auth/watchlist/${currentMovieId}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    });
    const data = await readJsonResponse(res);
    const btn  = document.getElementById('watchlistBtn');
    if (data.inWatchlist) {
      btn.innerHTML        = '<i class="ri-check-line"></i> In My List';
      btn.style.background = 'var(--accent)';
      btn.style.border     = 'none';
    } else {
      btn.innerHTML        = '<i class="ri-add-line"></i> My List';
      btn.style.background = '';
      btn.style.border     = '';
    }
    toast(data.message, 'success');
  } catch(e) { toast('Failed', 'error'); }
}

// ─────────────────────────────────────────────────────────────────────────
// EPISODES
// ─────────────────────────────────────────────────────────────────────────
async function loadEpisodes(seriesId) {
  const section = document.getElementById('episodesSection');
  const grid    = document.getElementById('episodesGrid');
  const tabs    = document.getElementById('episodeSeasonTabs');
  section.style.display = 'block';

  // isTvLike: covers all multi-episode content types
  const cat = String(currentMovie?.category || '').toLowerCase();
  const isTvLike = ['series', 'anime', 'cartoon', 'tv', 'k-drama', 'asian-drama', 'asian_drama', 'kdrama', 'chinese-drama', 'cdrama', 'c-drama'].includes(cat);
  const tmdbId = Number(currentMovie?.tmdbId || currentMovie?.tmdb_id || 0);

  // ── TMDB Path: for all series/dramas with a tmdbId, fetch rich metadata ──
  // NOTE: readJsonResponse() in app.js calls parseApiPayload() which unwraps
  // payload.data into the top-level object. So the response shape is:
  //   { details: {...}, success: true, message: '...' }
  // NOT { data: { details: {...} } } — that level is already flattened.
  if (isTvLike && tmdbId) {
    grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';
    try {
      const detailsRes = await apiFetch('/tmdb/details/' + tmdbId + '?type=tv');
      if (detailsRes.ok) {
        const detailsPayload = await detailsRes.json().catch(() => ({}));
        // Safely navigate: backend sends { success, data: { details: {...} } }
        // but readJsonResponse flattens .data, so try both paths
        const fullDetails = detailsPayload?.data?.details || detailsPayload?.details || detailsPayload?.data;
        if (fullDetails && Array.isArray(fullDetails.seasons) && fullDetails.seasons.length > 0) {
          let seasonsList = fullDetails.seasons.filter(s => s.season_number > 0);
          if (seasonsList.length === 0) seasonsList = fullDetails.seasons;

          tabs.innerHTML = seasonsList.map((s, i) =>
            '<button class="filter-tab ' + (i === 0 ? 'active' : '') + '" data-season-number="' + s.season_number + '">Season ' + s.season_number + '</button>'
          ).join('');

          window.tmdbSeasonsCache = {};
          await loadTmdbSeasonCards(tmdbId, seasonsList[0].season_number);
          return;
        }
      }
    } catch(e) {
      console.error('[Episodes] TMDB season fetch failed, falling back to local DB:', e.message);
    }
  }

  try {
    const res  = await apiFetch(`/episodes/series/${seriesId}`, { silent: true });
    const data = await readJsonResponse(res);
    const { seasons } = data;
    const nums = Object.keys(seasons || {}).sort((a, b) => +a - +b);

    if (nums.length === 0) {
      if (String(currentMovie?.provider || '').toLowerCase() === 'anilist' || currentMovie?.category === 'anime') {
        let movieMeta = currentMovie;
        let nextAiringEpisode = Number(movieMeta?.nextAiringEpisode?.episode || 0);
        let nextAiringAt = movieMeta?.nextAiringEpisode?.airingAt ? new Date(movieMeta.nextAiringEpisode.airingAt) : null;

        if ((!nextAiringEpisode || !nextAiringAt) && currentMovieId) {
          try {
            const movieRes = await apiFetch(`/movies/${currentMovieId}`, { silent: true });
            if (movieRes.ok) {
              const payload = await readJsonResponse(movieRes);
              movieMeta = payload?.data || payload || movieMeta;
              nextAiringEpisode = Number(movieMeta?.nextAiringEpisode?.episode || nextAiringEpisode || 0);
              nextAiringAt = movieMeta?.nextAiringEpisode?.airingAt ? new Date(movieMeta.nextAiringEpisode.airingAt) : nextAiringAt;
            }
          } catch {}
        }

        const animeSeasonNumber = getAnimeSeasonNumber(movieMeta);
        const nextAiringLabel = nextAiringAt && !Number.isNaN(nextAiringAt.getTime())
          ? `Airs ${nextAiringAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
          : 'Airing soon';
        const tmdbId = Number(movieMeta?.tmdbId || movieMeta?.tmdb_id || 0);

        if (nextAiringEpisode > 0) {
          const embedUrl = tmdbId ? buildAnimeEpisodeEmbedUrl(tmdbId, animeSeasonNumber, nextAiringEpisode) : '';
          const metaLabel = tmdbId ? nextAiringLabel : 'TMDB mapping pending';
          grid.innerHTML = `
            <div class="episode-card" data-anime-season="${animeSeasonNumber}" data-anime-ep="${nextAiringEpisode}" data-anime-embed-url="${escapeHtml(embedUrl)}">
              <img class="ep-card-thumb" src="${mediaUrl(currentMovie?.thumbnailUrl) || THUMB_PH}"
                alt="${escapeHtml(currentMovie?.title || 'Anime Episode')}"
                loading="lazy"
                referrerpolicy="no-referrer"
                onerror="this.src='${THUMB_PH}'">
              <div style="flex:1;min-width:0;">
                <div class="ep-card-num">Season ${animeSeasonNumber} · Episode ${nextAiringEpisode}</div>
                <div class="ep-card-title">${escapeHtml(currentMovie?.title || 'Anime')}</div>
                <div class="ep-card-meta">
                  <span><i class="ri-time-line"></i> ${escapeHtml(metaLabel)}</span>
                </div>
              </div>
              <div class="ep-play-btn"><i class="ri-play-fill" style="color:#fff;"></i></div>
            </div>`;
          return;
        }

        if (Number(currentMovie?.totalEpisodes || 0) > 1) {
          // If totalEpisodes is > 1, we can render the chunk grid regardless of TMDB ID.
          // Native source lookup will handle falling back if TMDB is absent.
          const totalEpisodes = Math.min(1500, Number(currentMovie.totalEpisodes || 0)); // Cap to 1500
          window.renderAnimeEpisodes(totalEpisodes, animeSeasonNumber);
          return;
        }
      }
      // Prefer rendering an Upcoming Episode card for anime when possible
      try { ensureUpcomingEpisodeFallback(currentMovie); } catch (e) {}
      // If fallback didn't create a card, show the default empty state
      const hasCards = Array.from(grid.children).some(c => c.classList && c.classList.contains('episode-card'));
      if (hasCards) return;
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon">🎬</div>
          <h3>No episodes yet</h3>
          <p style="color:var(--text-muted);">Upload episodes from the admin panel</p>
        </div>`;
      return;
    }

    seasonsData = seasons;
    tabs.innerHTML = nums.map((s, i) =>
      `<button class="filter-tab ${i === 0 ? 'active' : ''}" data-season="${s}">Season ${s}</button>`
    ).join('');

    renderEpisodeCards(seasons[nums[0]]);
  } catch(e) {
    // API failed; try to show upcoming episode card for anime
    try { ensureUpcomingEpisodeFallback(currentMovie); } catch (err) {}
    // If fallback didn't create a card, show error
    const hasCards = Array.from(grid.children).some(c => c.classList && c.classList.contains('episode-card'));
    if (!hasCards) {
      grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;">Failed to load episodes</p>';
    }
  }
}

function renderEpisodeCards(episodes) {
  const grid = document.getElementById('episodesGrid');
  if (!episodes || episodes.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;">No episodes found</p>';
    return;
  }

  grid.innerHTML = episodes.map(ep => `
    <div class="episode-card" data-ep-id="${ep._id}">
      <img class="ep-card-thumb" src="${ep.thumbnailUrl ? mediaUrl(ep.thumbnailUrl) : THUMB_PH}"
         alt="${escapeHtml(ep.title)}"
         loading="lazy"
         referrerpolicy="no-referrer"
         onerror="this.src='${THUMB_PH}'">
      <div style="flex:1;min-width:0;">
        <div class="ep-card-num">Episode ${ep.episodeNumber}</div>
        <div class="ep-card-title">${escapeHtml(ep.title)}</div>
        <div class="ep-card-meta">
          <span><i class="ri-time-line"></i> ${ep.duration || 0} min</span>
          <span><i class="ri-eye-line"></i> ${(ep.views || 0).toLocaleString()}</span>
        </div>
      </div>
      <div class="ep-play-btn"><i class="ri-play-fill" style="color:#fff;"></i></div>
    </div>`).join('');
}


async function loadTmdbSeasonCards(tmdbId, seasonNumber) {
  const grid = document.getElementById('episodesGrid');
  grid.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  if (window.tmdbSeasonsCache && window.tmdbSeasonsCache[seasonNumber]) {
    renderTmdbEpisodeCards(window.tmdbSeasonsCache[seasonNumber], seasonNumber);
    return;
  }

  try {
    const res = await apiFetch('/tmdb/tv/' + tmdbId + '/season/' + seasonNumber);
    if (res.ok) {
      // Use raw .json() to avoid parseApiPayload() stripping nested data
      const raw = await res.json().catch(() => ({}));
      // Backend: { success, data: { details: <tmdb_season> } }
      const seasonDetails = raw?.data?.details || raw?.details || raw?.data;
      if (seasonDetails && Array.isArray(seasonDetails.episodes) && seasonDetails.episodes.length > 0) {
        if (!window.tmdbSeasonsCache) window.tmdbSeasonsCache = {};
        window.tmdbSeasonsCache[seasonNumber] = seasonDetails.episodes;
        renderTmdbEpisodeCards(seasonDetails.episodes, seasonNumber);
        return;
      }
    }
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">No episodes found for this season.</p>';
  } catch (e) {
    console.error('[TMDB Season Load]', e);
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">Failed to load season details. Please try again.</p>';
  }
}

function renderTmdbEpisodeCards(episodes, seasonNumber) {
  const grid = document.getElementById('episodesGrid');
  if (!episodes || episodes.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;text-align:center;">No episodes found.</p>';
    return;
  }

  // Netflix-style: single column list, NOT a multi-column grid
  grid.style.display = 'flex';
  grid.style.flexDirection = 'column';
  grid.style.gap = '0';
  grid.removeAttribute('data-anime-fallback');

  var htmlParts = [];
  var TMDB_STILL = 'https://image.tmdb.org/t/p/w500';
  var fallbackThumb = mediaUrl(currentMovie?.thumbnailUrl) || THUMB_PH;

  // Season header with episode count
  htmlParts.push(
    '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.06);">' +
      '<span style="font-size:14px;color:var(--text-muted);">' + episodes.length + ' Episodes</span>' +
      '<span style="font-size:12px;color:var(--text-muted);letter-spacing:0.5px;">SEASON ' + seasonNumber + '</span>' +
    '</div>'
  );

  for (var i = 0; i < episodes.length; i++) {
    var ep = episodes[i];
    var stillUrl = ep.still_path ? (TMDB_STILL + ep.still_path) : fallbackThumb;
    var airDate = 'Unknown';
    if (ep.air_date) {
      try {
        airDate = new Date(ep.air_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      } catch(e) { airDate = ep.air_date; }
    }
    var description = ep.overview
      ? (ep.overview.length > 150 ? ep.overview.substring(0, 150) + '...' : ep.overview)
      : 'No description available.';
    var title = ep.name || ('Episode ' + ep.episode_number);
    var runtime = ep.runtime ? (ep.runtime + ' min') : '';
    var epNum = ep.episode_number;
    var isPlaying = (currentPlayingSeason == seasonNumber && currentPlayingEpisode == epNum);

    htmlParts.push(
      '<div class="episode-card tmdb-ep-row' + (isPlaying ? ' tmdb-ep-playing' : '') + '"' +
        ' data-anime-season="' + seasonNumber + '"' +
        ' data-anime-ep="' + epNum + '">' +

        // Episode number column
        '<div class="tmdb-ep-num">' + epNum + '</div>' +

        // Thumbnail column with play overlay
        '<div class="tmdb-ep-thumb-wrap">' +
          '<img class="tmdb-ep-thumb" src="' + escapeHtml(stillUrl) + '"' +
            ' alt="' + escapeHtml(title) + '"' +
            ' loading="lazy" referrerpolicy="no-referrer"' +
            ' onerror="this.src=\'' + THUMB_PH + '\'">' +
          '<div class="tmdb-ep-play-icon"><i class="ri-play-fill"></i></div>' +
        '</div>' +

        // Info column
        '<div class="tmdb-ep-info">' +
          '<div class="tmdb-ep-title-row">' +
            '<span class="tmdb-ep-title">' + escapeHtml(title) + '</span>' +
            (runtime ? '<span class="tmdb-ep-runtime">' + runtime + '</span>' : '') +
          '</div>' +
          '<p class="tmdb-ep-desc">' + escapeHtml(description) + '</p>' +
          '<div class="tmdb-ep-meta">' +
            '<span>' + airDate + '</span>' +
            (ep.vote_average ? '<span>⭐ ' + Number(ep.vote_average).toFixed(1) + '</span>' : '') +
          '</div>' +
        '</div>' +

      '</div>'
    );
  }

  grid.innerHTML = htmlParts.join('');

  // Inject premium styles once
  if (!document.getElementById('tmdb-ep-styles')) {
    var style = document.createElement('style');
    style.id = 'tmdb-ep-styles';
    style.textContent =
      /* Row layout — Netflix horizontal style */
      '.tmdb-ep-row {' +
        'display:flex;align-items:center;gap:16px;' +
        'padding:16px 0;cursor:pointer;' +
        'border-bottom:1px solid rgba(255,255,255,0.06);' +
        'transition:background 0.2s ease;' +
      '}' +
      '.tmdb-ep-row:last-child { border-bottom:none; }' +
      '.tmdb-ep-row:hover { background:rgba(255,255,255,0.04);border-radius:8px;padding-left:8px;padding-right:8px; }' +

      /* Now playing indicator */
      '.tmdb-ep-playing { background:rgba(229,9,20,0.08) !important;border-radius:8px;padding-left:8px;padding-right:8px; }' +
      '.tmdb-ep-playing .tmdb-ep-num { color:var(--accent);font-weight:700; }' +
      '.tmdb-ep-playing .tmdb-ep-title { color:var(--accent); }' +

      /* Episode number */
      '.tmdb-ep-num {' +
        'min-width:32px;font-size:24px;font-weight:500;' +
        'color:var(--text-muted);text-align:center;flex-shrink:0;' +
      '}' +

      /* Thumbnail */
      '.tmdb-ep-thumb-wrap {' +
        'position:relative;width:175px;min-width:175px;aspect-ratio:16/9;' +
        'border-radius:6px;overflow:hidden;flex-shrink:0;' +
        'background:rgba(255,255,255,0.04);' +
      '}' +
      '.tmdb-ep-thumb {' +
        'width:100%;height:100%;object-fit:cover;display:block;' +
        'transition:transform 0.3s ease;' +
      '}' +
      '.tmdb-ep-row:hover .tmdb-ep-thumb { transform:scale(1.05); }' +
      '.tmdb-ep-play-icon {' +
        'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
        'background:rgba(0,0,0,0.45);opacity:0;transition:opacity 0.2s ease;' +
      '}' +
      '.tmdb-ep-play-icon i { font-size:32px;color:#fff; }' +
      '.tmdb-ep-row:hover .tmdb-ep-play-icon { opacity:1; }' +

      /* Info section */
      '.tmdb-ep-info { flex:1;min-width:0; }' +
      '.tmdb-ep-title-row {' +
        'display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:6px;' +
      '}' +
      '.tmdb-ep-title {' +
        'font-size:15px;font-weight:600;color:var(--text-primary);' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' +
      '}' +
      '.tmdb-ep-runtime {' +
        'font-size:12px;color:var(--text-muted);white-space:nowrap;flex-shrink:0;' +
      '}' +
      '.tmdb-ep-desc {' +
        'font-size:13px;color:var(--text-secondary);line-height:1.5;' +
        'margin:0 0 6px 0;display:-webkit-box;-webkit-line-clamp:2;' +
        '-webkit-box-orient:vertical;overflow:hidden;' +
      '}' +
      '.tmdb-ep-meta {' +
        'display:flex;gap:12px;font-size:11px;color:var(--text-muted);' +
        'text-transform:uppercase;letter-spacing:0.5px;' +
      '}' +

      /* Mobile: compact horizontal card */
      '@media (max-width:768px) {' +
        '.tmdb-ep-num { min-width:24px;font-size:16px; }' +
        '.tmdb-ep-thumb-wrap { width:120px;min-width:120px; }' +
        '.tmdb-ep-title { font-size:13px; }' +
        '.tmdb-ep-desc { display:none; }' +
        '.tmdb-ep-meta { font-size:10px; }' +
      '}';

    document.head.appendChild(style);
  }
}


// ─────────────────────────────────────────────────────────────────────────
// RECOMMENDATIONS
// ─────────────────────────────────────────────────────────────────────────
async function loadRecommendations(id, title) {
  const section = document.getElementById('recommendationsSection');
  const grid    = document.getElementById('recGrid');

  try {
    const res  = await apiFetch(`/movies/${id}/more-like-this?limit=14`, { silent: true });
    if (!res.ok) return;
    const data = await readJsonResponse(res);
    const recs = data.recommendations || [];
    if (recs.length === 0) return;

    const subtitle = document.getElementById('recSubtitle');
    const parts = [];
    if (data.basedOn?.genre?.length > 0) parts.push(data.basedOn.genre.slice(0, 3).join(', '));
    if (data.basedOn?.language) parts.push(data.basedOn.language.toUpperCase());
    subtitle.textContent = parts.length
      ? `More Like This · ${parts.join(' · ')}`
      : `More Like This · Based on "${title}"`;

    grid.innerHTML = recs.map(m => {
      const h   = Math.floor((m.duration || 0) / 60);
      const min = (m.duration || 0) % 60;
      const dur = h > 0 ? `${h}h ${min}m` : `${min}m`;
      const img = mediaUrl(m.thumbnailUrl) || POSTER_PH;
      return `
        <div class="rec-card" data-movie-id="${m._id}">
          <div style="position:relative;">
            <img class="rec-card-thumb"
     src="${img}"
     alt="${escapeHtml(m.title)}"
     loading="lazy"
     referrerpolicy="no-referrer"
     onerror="this.src='${POSTER_PH}'">
            <div class="rec-match-badge">${escapeHtml(m.category)}</div>
          </div>
          <div class="rec-card-info">
            <div class="rec-card-title">${escapeHtml(m.title)}</div>
            <div class="rec-card-meta">
              <span>${m.releaseYear || ''}</span> <span>&middot;</span> <span>${dur}</span>
              <span class="rec-card-rating">${m.averageRating > 0 ? `<svg width="12" height="12" viewBox="0 0 24 24" fill="var(--gold, #fbbf24)" style="vertical-align:middle;margin-right:2px;margin-bottom:2px;"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>${m.averageRating}` : ''}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    section.style.display = 'block';
  } catch(e) {}
}

async function loadOtherSeasons(id, title) {
  const section = document.getElementById('otherSeasonsSection');
  const grid = document.getElementById('otherSeasonsGrid');
  const subtitle = document.getElementById('otherSeasonsSubtitle');
  if (!section || !grid || !subtitle) return;

  const isAnime = String(currentMovie?.category || '').toLowerCase() === 'anime';
  if (!isAnime) {
    section.style.display = 'none';
    return;
  }

  try {
    const res = await apiFetch(`/movies/${id}/other-seasons?limit=12`, { silent: true });
    if (!res.ok) return;
    const payload = await readJsonResponse(res);
    const rows = Array.isArray(payload.seasons) ? payload.seasons : [];
    if (!rows.length) {
      section.style.display = 'none';
      return;
    }

    subtitle.textContent = `Other seasons connected to "${title}"`;
    grid.innerHTML = rows.map((m) => {
      const img = mediaUrl(m.thumbnailUrl) || POSTER_PH;
      const seasonLabel = Number(m.animeSeasonNumber || 0) > 0 ? `Season ${m.animeSeasonNumber}` : '';
      return `
        <div class="rec-card" data-movie-id="${m._id}">
          <div style="position:relative;">
            <img class="rec-card-thumb"
              src="${img}"
              alt="${escapeHtml(m.title)}"
              loading="lazy"
              referrerpolicy="no-referrer"
              onerror="this.src='${POSTER_PH}'">
            <div class="rec-match-badge">${escapeHtml(seasonLabel || m.category || 'anime')}</div>
          </div>
          <div class="rec-card-info">
            <div class="rec-card-title">${escapeHtml(m.title)}</div>
            <div class="rec-card-meta">
              <span>${m.releaseYear || ''}</span>
              <span>·</span>
              <span>${m.averageRating > 0 ? `⭐ ${m.averageRating}` : 'Anime'}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    section.style.display = 'block';
  } catch {
    section.style.display = 'none';
  }
}

function setupShareUnlockHandlers() {
  const whatsappBtn = document.getElementById('shareWhatsappBtn');
  const telegramBtn = document.getElementById('shareTelegramBtn');
  const hint = document.getElementById('unlockHint');
  if (!whatsappBtn || !telegramBtn || !hint) return;

  const updateHint = () => {
    if (isHighSpeedServerUnlocked(currentMovieId)) {
      hint.textContent = 'High-Speed Server 1 unlocked';
      hint.style.color = '#34d399';
    } else {
      hint.textContent = 'Share to unlock High-Speed Server 1';
      hint.style.color = '';
    }
  };

  const shareText = () => encodeURIComponent(`Watching ${currentMovie?.title || 'CinePulse'} on CinePulse: ${window.location.href}`);

  const unlock = () => {
    unlockHighSpeedServer(currentMovieId);
    renderServerSelector();
    updateHint();
    toast('High-Speed Server 1 unlocked for this title.', 'success');
  };

  whatsappBtn.addEventListener('click', () => {
    window.open(`https://wa.me/?text=${shareText()}`, '_blank', 'noopener,noreferrer');
    unlock();
  });

  telegramBtn.addEventListener('click', () => {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.href)}&text=${encodeURIComponent(`Watching ${currentMovie?.title || 'CinePulse'} on CinePulse`)}`, '_blank', 'noopener,noreferrer');
    unlock();
  });

  updateHint();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMMENTS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function setupCommentSection() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  if (user) {
    document.getElementById('commentUserAvatar').textContent = (user.username || 'U')[0].toUpperCase();
    document.getElementById('commentUserName').textContent   = user.username || 'User';
  } else {
    document.getElementById('commentInput').placeholder = 'Login to post a review...';
    document.getElementById('commentInput').disabled    = true;
    document.getElementById('commentSubmitBtn').disabled = true;
  }

  const container = document.getElementById('commentRatingStars');
  container.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('button');
    star.textContent    = 'â˜…';
    star.dataset.rating = i;
    star.style.cssText  = 'background:none;border:none;cursor:pointer;font-size:22px;color:var(--text-muted);transition:color 0.15s,transform 0.1s;padding:2px;';
    star.addEventListener('mouseenter', () => highlightCommentStars(i));
    star.addEventListener('mouseleave', () => highlightCommentStars(selectedRating));
    star.addEventListener('click', () => {
      selectedRating = i;
      highlightCommentStars(i);
      const rv = document.getElementById('commentRatingValue');
      rv.textContent   = `${i}/5`;
      rv.style.display = 'inline';
    });
    container.appendChild(star);
  }
}

function highlightCommentStars(n) {
  document.querySelectorAll('#commentRatingStars button').forEach((s, i) => {
    s.style.color     = i < n ? 'var(--gold)' : 'var(--text-muted)';
    s.style.transform = i < n ? 'scale(1.1)'  : 'scale(1)';
  });
}

async function loadComments() {
  const container = document.getElementById('commentsList');
  if (!currentMovieId) { container.innerHTML = ''; return; }
  container.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    const res      = await apiFetch(`/comments/movie/${currentMovieId}`, { silent: true });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data     = await readJsonResponse(res);
    const comments = data.comments || [];

    const me = JSON.parse(localStorage.getItem('user') || 'null');
    const myId = me?._id || me?.id || null;

    document.getElementById('commentCount').textContent = comments.length > 0 ? `(${comments.length})` : '';

    if (comments.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
          <div style="font-size:48px;margin-bottom:12px;">ðŸ’¬</div>
          <p style="font-size:15px;">No reviews yet â€” be the first!</p>
        </div>`;
      return;
    }

    container.innerHTML = comments.map(c => {
      const filled = c.rating ? 'â˜…'.repeat(c.rating) : '';
      const empty  = c.rating ? `<span style="color:var(--text-muted);">${'â˜…'.repeat(5 - c.rating)}</span>` : '';
      const commentUserId = c.user?._id || c.user?.id || null;
      const isOwn = myId && commentUserId && commentUserId.toString() === myId.toString();
      const date  = new Date(c.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });

      return `
        <div class="comment-item" data-comment-id="${c._id}">
          <div class="comment-item-header">
            <div class="comment-item-avatar">${(c.user?.username || '?')[0].toUpperCase()}</div>
            <div style="flex:1;">
              <div class="comment-item-name">${escapeHtml(c.user?.username || 'Anonymous')}</div>
              ${c.rating ? `<div style="font-size:15px;color:var(--gold);">${filled}${empty}<span style="font-size:12px;color:var(--text-muted);">${c.rating}/5</span></div>` : ''}
              <div class="comment-item-date">${date}</div>
            </div>
            ${isOwn ? `<button class="comment-delete-btn" data-id="${c._id}"><i class="ri-delete-bin-line"></i></button>` : ''}
          </div>
          <p class="comment-item-text">${escapeHtml(c.text)}</p>
          <div class="comment-likes">
            <button class="like-btn" data-id="${c._id}"><i class="ri-heart-line"></i><span>${c.likes || 0}</span></button>
            <span style="font-size:12px;color:var(--text-muted);">Helpful?</span>
          </div>
        </div>`;
    }).join('');

  } catch(e) {
    container.innerHTML = `
      <div style="text-align:center;padding:30px;color:var(--text-muted);">
        <p>Could not load reviews.
          <button id="retryComments" style="background:none;border:none;color:var(--accent);cursor:pointer;text-decoration:underline;font-family:var(--font-body);">Retry</button>
        </p>
      </div>`;
    document.getElementById('retryComments')?.addEventListener('click', loadComments);
  }
}

async function submitComment() {
  if (!userLoggedIn) { toast('Please login first', 'error'); return; }
  if (!currentMovieId) { toast('Page still loading...', 'error'); return; }

  const text = document.getElementById('commentInput').value.trim();
  if (!text)           { toast('Please write something', 'error');  return; }
  if (text.length < 3) { toast('Review too short', 'error');        return; }

  const token = localStorage.getItem('token');
  const btn   = document.getElementById('commentSubmitBtn');
  btn.innerHTML = '<i class="ri-loader-4-line"></i> Posting...';
  btn.disabled  = true;

  try {
    const res  = await apiFetch(`/comments/movie/${currentMovieId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ text, rating: selectedRating || null }),
    });
    const data = await readJsonResponse(res);

    if (res.ok) {
      document.getElementById('commentInput').value           = '';
      document.getElementById('commentCharCount').textContent = '0 / 500';
      selectedRating = 0;
      highlightCommentStars(0);
      document.getElementById('commentRatingValue').style.display = 'none';
      toast('Review posted! âœ…', 'success');
      await loadComments();
    } else {
      toast(data.message || 'Failed to post', 'error');
    }
  } catch(e) { toast('Cannot connect to server', 'error'); }

  btn.innerHTML = '<i class="ri-send-plane-fill"></i> Post Review';
  btn.disabled  = false;
}

async function deleteComment(commentId) {
  if (!confirm('Delete your review?')) return;
  const token = localStorage.getItem('token');
  try {
    const res = await apiFetch(`/comments/movie/${currentMovieId}/${commentId}`, { 
      method:'DELETE', headers:{ 'Authorization':`Bearer ${token}` } 
    });
    if (res.ok) { toast('Review deleted', 'success'); await loadComments(); }
    else { const data = await readJsonResponse(res); toast(data.message || 'Failed', 'error'); }
  } catch(e) { toast('Failed to delete', 'error'); }
}

async function likeComment(commentId, btn) {
  if (!userLoggedIn) { toast('Login to like', 'error'); return; }
  const token = localStorage.getItem('token');
  try {
    const res  = await apiFetch(`/comments/movie/${currentMovieId}/${commentId}/like`, { 
      method:'PUT', headers:{ 'Authorization':`Bearer ${token}` } 
    });
    const data = await readJsonResponse(res);
    if (res.ok) {
      btn.querySelector('span').textContent = data.likes;
      btn.classList.toggle('liked', data.liked);
      btn.querySelector('i').className = data.liked ? 'ri-heart-fill' : 'ri-heart-line';
    }
  } catch(e) {}
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function shareMovie() {
  if (navigator.share) {
    navigator.share({ title: currentMovie?.title, url: window.location.href });
  } else {
    navigator.clipboard.writeText(window.location.href)
      .then(()  => toast('Link copied! ðŸ”—', 'success'))
      .catch(() => toast('Could not copy link', 'error'));
  }
}

async function loadMaskedPlaybackSources(movieId) {
  try {
    const response = await apiFetch(`/watch/movie/${movieId}/sources`, { silent: true });
    if (!response.ok) return [];

    const payload = await readJsonResponse(response);
    const maskedSources = Array.isArray(payload?.sources) ? payload.sources : [];
    return (window.VideoEngine?.buildMovieSources?.({ sources: maskedSources }) || []).map((source) => ({
      ...source,
      isMasked: true,
    }));
  } catch (error) {
    console.warn('Masked playback source load failed:', error.message);
    return [];
  }
}

async function loadProviderSubtitleTracks(source) {
  try {
    if (!source?.url || source.server === 'upload' || source.isMasked) return;

    const response = await apiFetch(`/subtitles?url=${encodeURIComponent(source.url)}&sourceType=${encodeURIComponent(source.sourceType || source.server)}&langs=en,hi,ja`, { silent: true });
    const payload = await readJsonResponse(response);
    const tracks = Array.isArray(payload?.tracks) ? payload.tracks : [];
    if (!tracks.length) return;

    const video = getVideoElement();
    if (video && getNativeShell()?.classList.contains('is-active')) {
      revokeProviderSubtitleUrls();
      video.querySelectorAll('track[data-provider-track="true"]').forEach((track) => track.remove());

      tracks.forEach((track, index) => {
        try {
          const blobUrl = URL.createObjectURL(new Blob([track.vtt], { type: 'text/vtt' }));
          providerSubtitleBlobUrls.push(blobUrl);
          const element = document.createElement('track');
          element.kind = 'subtitles';
          element.label = track.label || track.language || `Subtitle ${index + 1}`;
          element.srclang = track.language || 'en';
          element.src = blobUrl;
          element.default = index === 0;
          element.dataset.providerTrack = 'true';
          video.appendChild(element);
        } catch {}
      });
    } else {
      showPlayerMessage(`Captions available: ${tracks.map((track) => track.language?.toUpperCase()).filter(Boolean).join(', ')}`);
    }
  } catch (error) {
    console.warn('Provider subtitle load failed:', error.message);
  }
}

function wireNativeFallback() {
  const video = getVideoElement();
  if (!video || video.dataset.multiSourceBound === 'true') return;

  video.dataset.multiSourceBound = 'true';
  video.addEventListener('error', () => {
    if (activeSourceIndex < playbackSources.length - 1) {
      showPlayerMessage('Switching source...');
      setPlayerStatus('Current source failed. Trying the next source...', 'switching');
      switchPlaybackSource(activeSourceIndex + 1, { auto: true }).catch(() => {});
    } else {
      showPlayerLoader(false);
      setPlayerStatus('Playback failed for all available sources.', 'error');
      showPlayerMessage('No working source is available right now.', 3200);
    }
  });
}

async function switchPlaybackSource(index, options = {}) {
  if (!playbackSources[index]) return;

  // ── HARD RESET: Cancel any previous static trust timer ──
  clearTimeout(switchPlaybackSource._staticTrustTimer);
  clearTimeout(switchPlaybackSource.embedTimer);

  restoreNativeShellMarkup();
  wireNativeFallback();
  getVideoElement()?.pause();

  activeSourceIndex = index;
  renderServerSelector();
  const source = playbackSources[index];
  const switchToken = ++activePlayerSwitchToken;
  const shortcutsBtn = document.getElementById('shortcutsBtn');
  const serverNum = index + 1;
  showPlayerLoader(true, `Loading Server ${serverNum}...`);
  setPlayerStatus(`Now playing • Server ${serverNum} • ${source.serverName || source.label}`, options.auto ? 'switching' : '');
  if (shortcutsBtn) {
    shortcutsBtn.style.opacity = source.server === 'upload' ? '1' : '0.55';
  }

  if (source.server === 'upload') {
    revokeProviderSubtitleUrls();
    stopEmbedPlayback();
    activatePlaybackSurface('native');
    const video = getVideoElement();
    if (!video) return;

    ensureNativePlayer(currentMovie);
    video.poster = mediaUrl(currentMovie?.thumbnailUrl) || '';
    video.src = mediaUrl(source.playUrl || source.url);
    video.currentTime = 0;
    video.load();

    const onCanPlay = () => {
      if (switchToken !== activePlayerSwitchToken) return;
      clearTimeout(switchPlaybackSource._staticTrustTimer);
      showPlayerLoader(false);
      setPlayerStatus(`Now playing • ${source.statusLabel || source.label}`);
      if (startTime > 0 && video.currentTime < startTime) {
        video.currentTime = startTime;
      }
      video.play().catch(() => {});
      video.removeEventListener('canplay', onCanPlay);
    };

    video.addEventListener('canplay', onCanPlay);
    return;
  }

  const frame = getEmbedFrame();
  activatePlaybackSurface('embed');
  if (!frame) return;
  const sourceUrlForValidation = source.url || source.embedUrl || '';
  if (!source.embedUrl || window.isOfflinePlaybackSource?.(sourceUrlForValidation, source.sourceType || source.server)) {
    renderSourceOffline(source, 'Content currently unavailable. Please try another server.');
    return;
  }
  const video = getVideoElement();
  if (video) {
    video.removeAttribute('src');
    video.load();
  }

  // ── SANDBOX REMOVAL FIRST — before src is set, so the provider never
  //    sees a sandboxed parent when its scripts execute.
  //    All our providers explicitly reject sandbox restrictions.
  frame.removeAttribute('sandbox');

  // ── iframe attributes ──
  frame.referrerPolicy = 'no-referrer';
  frame.allow = 'autoplay; fullscreen; encrypted-media; picture-in-picture; gyroscope; accelerometer';
  frame.allowFullscreen = true;
  frame.setAttribute('allowfullscreen', 'true');
  frame.setAttribute('webkitallowfullscreen', 'true');
  frame.setAttribute('mozallowfullscreen', 'true');
  frame.removeAttribute('srcdoc');

  // ── onload handler (fires if the server responds quickly) ──
  frame.onload = () => {
    if (switchToken !== activePlayerSwitchToken) return;
    initProviderPlayer(source);
    // Do NOT hide loader here — let the static trust timer handle it
  };

  // ── Assign src last — after all attributes are in place ──
  frame.src = source.embedUrl;
  loadProviderSubtitleTracks(source).catch(() => {});

  // ═══════════════════════════════════════════════════════════════════════════
  // STATIC TRUST TIMER — 3.5 second guaranteed spinner dismiss
  // After 3.5s, unconditionally hide the spinner and reveal the iframe.
  // No automatic server rotation. User controls server switching manually.
  // ═══════════════════════════════════════════════════════════════════════════
  switchPlaybackSource._staticTrustTimer = setTimeout(() => {
    if (switchToken !== activePlayerSwitchToken) return;
    showPlayerLoader(false);
    source.status = 'ready';
    setPlayerStatus(`Now playing • Server ${serverNum} • ${source.serverName || source.label}`);
    renderServerSelector();
  }, 3500);
}

async function setupPlayback(movie) {
  try {
    // ── Global Master Hydra: build sources from EmbedServers first ──
    let hydraSources = [];
    if (typeof EmbedServers !== 'undefined' && typeof EmbedServers.buildHydraSources === 'function') {
      try {
        hydraSources = EmbedServers.buildHydraSources(
          movie,
          currentPlayingSeason || movie.season || 1,
          currentPlayingEpisode || movie.episode || 1
        );
      } catch (hydrErr) {
        console.warn('[Hydra] buildHydraSources failed:', hydrErr.message);
      }
    }

    // Also try masked/uploaded sources as primary (direct video uploads)
    playbackSources = await loadMaskedPlaybackSources(movie._id);

    // Merge: uploaded sources first, then hydra embed servers, then VideoEngine fallback
    if (hydraSources.length) {
      const existingUrls = new Set(playbackSources.map(s => s.url || s.embedUrl || ''));
      const freshHydra = hydraSources.filter(s => !existingUrls.has(s.url || s.embedUrl || ''));
      playbackSources = [...playbackSources, ...freshHydra];
    }

    // Final fallback: VideoEngine if still empty
    if (!playbackSources.length) {
      playbackSources = (window.VideoEngine?.buildMovieSources?.(movie) || []);
    }

    playbackSources = reorderSourcesBySessionHealth(playbackSources);
    activeSourceIndex = playbackSources.length ? 0 : -1;
    renderServerSelector();

    document.getElementById('loginGate').style.display = 'none';
    document.getElementById('videoContainer').style.display = 'block';
    if (userLoggedIn) {
      document.getElementById('ratingWrapper').style.display = 'flex';
    } else {
      document.getElementById('ratingWrapper').style.display = 'none';
    }

    if (!playbackSources.length) {
      renderNoPlaybackState();
      renderRatingStars();
      return;
    }

    restoreNativeShellMarkup();
    wireNativeFallback();
    await switchPlaybackSource(activeSourceIndex);
    renderRatingStars();
  } catch (error) {
    console.warn('Playback setup failed:', error.message);
    renderNoPlaybackState();
    renderRatingStars();
  }
}

function scrollToPlayer() {
  document.getElementById('playerSection').scrollIntoView({ behavior:'smooth' });
  if (userLoggedIn) {
    setTimeout(() => {
      const activeSource = playbackSources[activeSourceIndex];
      if (activeSource?.server === 'upload') {
        document.getElementById('videoPlayer')?.play().catch(() => {});
      } else if (activeSource) {
        showPlayerMessage(`Streaming from ${activeSource.statusLabel || activeSource.label}`);
      }
    }, 700);
  }
}

function setupNavbar() {
  // Stateless Public Site: no auth buttons on public pages
  const sec = document.getElementById('userSection');
  if (sec) sec.innerHTML = '';
}

// Open embed in popup window (bypasses all iframe/X-Frame-Options restrictions)
function openPopupPlayer(url) {
  const width = Math.min(screen.availWidth - 40, 1280);
  const height = Math.min(screen.availHeight - 40, 720);
  const left = (screen.availWidth - width) / 2;
  const top = (screen.availHeight - height) / 2;
  const features = `width=${width},height=${height},left=${left},top=${top},scrollbars=yes,resizable=yes,status=yes,toolbar=no,menubar=no,location=no`;
  const popup = window.open(url, 'CineStreamPlayer', features);

  if (!popup || popup.closed || typeof popup.closed === 'undefined') {
    alert('Popup blocked! Please allow popups for this site.');
  }
}



})();
