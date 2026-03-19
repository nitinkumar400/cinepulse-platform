(function () {

// Search and auto-load subtitles for a movie
async function loadOpenSubtitles(movieTitle, movieId) {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    // 1. Search
    const res  = await fetch(
      `${API_BASE}/subtitles/search/${encodeURIComponent(movieTitle)}?langs=en,hi`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const data = await readJsonResponse(res);
    if (!data.results?.length) return;

    // 2. Take best result (most downloaded)
    const best = data.results.sort((a,b) => b.download_count - a.download_count)[0];

    // 3. Download + convert (or use cached URL)
    let vttUrl = best.subtitle_url;
    if (!vttUrl) {
      const dlRes  = await fetch(
        `${API_BASE}/subtitles/download/${best.file_id}?lang=${best.language}&movieId=${movieId}`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const dlData = await readJsonResponse(dlRes);
      vttUrl = dlData.url;
    }

    // 4. Load into VideoPlayer
    if (vttUrl && typeof VideoPlayer !== 'undefined') {
      VideoPlayer.loadSubtitles([{
        language: best.language,
        label:    best.language_name || best.language,
        url:      vttUrl,
        default:  best.language === 'en',
      }]);
    }

  } catch(e) {
    console.warn('Subtitle auto-load failed:', e.message);
  }
}
// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
let currentMovieId  = null;
let currentMovie    = null;
let selectedRating  = 0;
let seasonsData     = {};
let progressTimer   = null;
let userLoggedIn    = false;
let playbackSources = [];
let activeSourceIndex = -1;
let nativePlayerInitialized = false;
let progressTrackingReady = false;
let activePlayerSwitchToken = 0;
let providerSubtitleBlobUrls = [];

const urlParams = new URLSearchParams(window.location.search);
const movieId   = urlParams.get('id');
const startTime = parseInt(urlParams.get('t') || '0');

// Placeholder images
const POSTER_PH = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQwIiBoZWlnaHQ9IjM2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTI0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjMzMzIj7wn46YIDM8L3RleHQ+PC9zdmc+';
const THUMB_PH  = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjY4IiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxYTFhMjQiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1zaXplPSIyMCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM0NDQiPuKWkDwvdGV4dD48L3N2Zz4=';

function mediaUrl(url) {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  const base = (typeof MEDIA_BASE !== 'undefined') ? MEDIA_BASE : '';
  return base + url;
}

function toast(msg, type = 'success') {
  if (typeof showToast === 'function') showToast(msg, type);
}

function escapeHtml(text) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(text || ''));
  return d.innerHTML;
}

// ══════════════════════════════════════════
// INIT & EVENT DELEGATION
// ══════════════════════════════════════════
window.addEventListener('DOMContentLoaded', async () => {
  setupNavbar();

  const token  = localStorage.getItem('token');
userLoggedIn = !!token;

  if (!movieId) { showState('error'); return; }

  try {
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${API_BASE}/movies/${movieId}`, { headers });
    if (!res.ok) throw new Error('Not found');

    const movie  = await readJsonResponse(res);
    currentMovie   = movie;
    currentMovieId = movie._id;
    renderMovie(movie);

  } catch(e) {
    console.error('Movie load error:', e);
    showState('error');
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
  document.getElementById('serverSelector').addEventListener('change', (e) => {
    const nextIndex = parseInt(e.target.value, 10);
    if (Number.isInteger(nextIndex)) {
      switchPlaybackSource(nextIndex);
    }
  });

  // Track comments input chars
  document.getElementById('commentInput').addEventListener('input', function() {
    document.getElementById('commentCharCount').textContent = `${this.value.length} / 500`;
  });

  // ── OPTIMIZED EVENT DELEGATION ──
  // Bound globally ONCE to prevent listener stacking
  
  // 1. Season Tabs Delegation
  document.getElementById('episodeSeasonTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-tab');
    if (!btn) return;
    document.querySelectorAll('#episodeSeasonTabs .filter-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderEpisodeCards(seasonsData[btn.dataset.season]);
  });

  // 2. Episodes Grid Delegation
  document.getElementById('episodesGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.episode-card');
    if (card) window.location.href = `episode.html?id=${card.dataset.epId}`;
  });

  // 3. Recommendations Grid Delegation
  document.getElementById('recGrid').addEventListener('click', (e) => {
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

// ══════════════════════════════════════════
// SHOW STATE
// ══════════════════════════════════════════
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

function showPlayerLoader(show, text = 'Loading stream…') {
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

function getNativeShell() {
  return document.getElementById('nativePlayerShell');
}

function activatePlaybackSurface(mode) {
  const nativeShell = getNativeShell();
  const embedFrame = getEmbedFrame();
  nativeShell?.classList.toggle('is-active', mode === 'native');
  embedFrame?.classList.toggle('is-active', mode === 'embed');
}

function stopEmbedPlayback() {
  const frame = getEmbedFrame();
  if (frame) {
    frame.removeAttribute('srcdoc');
    frame.removeAttribute('src');
  }
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

    const response = await fetch(`${API_BASE}/subtitles?url=${encodeURIComponent(source.url)}&sourceType=${encodeURIComponent(source.sourceType || source.server)}&langs=en,hi,ja`);
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

function renderSourceOffline(source, reason = 'Source Offline') {
  stopEmbedPlayback();
  activatePlaybackSurface('embed');
  showPlayerLoader(false);
  setPlayerStatus(reason, 'error');

  const frame = getEmbedFrame();
  if (!frame) return;

  const title = escapeHtml(source?.label || 'Source Offline');
  const detail = escapeHtml(reason);
  frame.srcdoc = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          gap: 10px;
          background: radial-gradient(circle at center, rgba(26,26,36,0.95), rgba(0,0,0,1));
          color: #fff;
          font-family: "Segoe UI", sans-serif;
          text-align: center;
          padding: 24px;
        }
        h2 { margin: 0; font-size: 28px; }
        p { margin: 0; color: rgba(255,255,255,0.72); }
        .badge {
          padding: 6px 12px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(229,9,20,0.12);
          color: #ff8b94;
          font-size: 12px;
          letter-spacing: 0.8px;
          text-transform: uppercase;
        }
      </style>
    </head>
    <body>
      <div class="badge">${title}</div>
      <h2>Source Offline</h2>
      <p>${detail}</p>
    </body>
    </html>`;
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
      showPlayerMessage('Switching server…');
      setPlayerStatus('Current source failed. Trying another server…', 'switching');
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
  const select = document.getElementById('serverSelector');
  if (!switcher || !select) return;

  if (!playbackSources.length) {
    switcher.style.display = 'none';
    select.innerHTML = '';
    return;
  }

  switcher.style.display = playbackSources.length > 1 ? 'flex' : 'none';
  select.innerHTML = playbackSources.map((source, index) => `
    <option value="${index}">${escapeHtml(source.label)}</option>
  `).join('');
  select.value = activeSourceIndex >= 0 ? String(activeSourceIndex) : '0';
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
      <div style="height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;padding:40px 20px;color:var(--text-muted);text-align:center;">
        <div style="font-size:56px;margin-bottom:14px;">🎬</div>
        <p style="font-size:18px;color:#fff;margin-bottom:8px;">Video not available yet</p>
        <p style="font-size:13px;">Check back soon</p>
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
  showPlayerLoader(true, options.auto ? 'Switching server…' : 'Loading stream…');
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
      setPlayerStatus(`Now playing • ${source.quality || 'HD'}`);
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
  if (!source.embedUrl || window.isOfflinePlaybackSource?.(source.url, source.sourceType || source.server)) {
    renderSourceOffline(source, 'This external source is malformed or unavailable.');
    return;
  }
  const video = getVideoElement();
  if (video) {
    video.removeAttribute('src');
    video.load();
  }

  frame.onload = () => {
    if (switchToken !== activePlayerSwitchToken) return;
    clearTimeout(switchPlaybackSource.embedTimer);
    showPlayerLoader(false);
    setPlayerStatus(`Now playing • ${source.label}`);
  };

  frame.removeAttribute('srcdoc');
  frame.src = source.embedUrl;
  loadProviderSubtitleTracks(source).catch(() => {});

  clearTimeout(switchPlaybackSource.embedTimer);
  switchPlaybackSource.embedTimer = setTimeout(() => {
    if (switchToken !== activePlayerSwitchToken) return;
    if (index < playbackSources.length - 1) {
      showPlayerMessage('Switching server…');
      setPlayerStatus('Embedded player is slow. Trying another server…', 'switching');
      switchPlaybackSource(index + 1, { auto: true });
    } else {
      renderSourceOffline(source, 'Embedded playback is unavailable right now.');
    }
  }, 7000);
}

function setupPlayback(movie) {
  playbackSources = (window.VideoEngine?.buildMovieSources?.(movie) || []);
  activeSourceIndex = playbackSources.length ? 0 : -1;
  renderServerSelector();

  if (!userLoggedIn) {
    document.getElementById('videoContainer').style.display = 'none';
    document.getElementById('ratingWrapper').style.display  = 'none';
    document.getElementById('loginGate').style.display      = 'block';
    return;
  }

  document.getElementById('loginGate').style.display = 'none';
  document.getElementById('videoContainer').style.display = 'block';
  document.getElementById('ratingWrapper').style.display = 'flex';

  if (!playbackSources.length) {
    renderNoPlaybackState();
    renderRatingStars();
    return;
  }

  restoreNativeShellMarkup();
  wireNativeFallback();
  switchPlaybackSource(activeSourceIndex);
  renderRatingStars();
}

// ══════════════════════════════════════════
// RENDER MOVIE
// ══════════════════════════════════════════
function renderMovie(m) {
  document.title = `${m.title} - CINE STREAM`;

  const bgUrl = m.bannerUrl || m.thumbnailUrl || '';
  document.getElementById('detailsBg').style.backgroundImage = bgUrl ? `url('${mediaUrl(bgUrl)}')` : '';

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

  document.getElementById('movieRating').textContent = `⭐ ${m.averageRating || 'N/A'} (${m.numRatings || 0} ratings)`;

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

  if (m.category === 'anime' || m.category === 'series' || m.category === 'cartoon') {
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
      `<span style="background:var(--bg-card);padding:6px 16px;border-radius:20px; font-size:13px;color:var(--text-secondary);border:1px solid var(--border);">${escapeHtml(n)}</span>`
    ).join('');
  }

  if (m.trailerUrl) {
    document.getElementById('trailerBtn').style.display = 'inline-flex';
  }

  setupPlayback(m);

  document.getElementById('playerTitle').textContent = m.title;

  if (m.category === 'anime' || m.category === 'series' || m.category === 'cartoon') {
    loadEpisodes(m._id);
  }

  setupCommentSection();
  loadComments();
  loadRecommendations(m._id, m.title);
  showState('content');
}

// ══════════════════════════════════════════
// RATING STARS
// ══════════════════════════════════════════
function renderRatingStars() {
  const container = document.getElementById('ratingStars');
  container.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.textContent    = '★';
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
    const res  = await fetch(`${API_BASE}/movies/${currentMovieId}/rate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ rating }),
    });
    const data = await readJsonResponse(res);
    if (res.ok) {
      highlightStars(rating);
      document.getElementById('movieRating').textContent = `⭐ ${data.averageRating} (${data.numRatings} ratings)`;
      toast(`Rated ${rating}/10 ⭐`, 'success');
    } else {
      toast(data.message || 'Already rated', 'error');
    }
  } catch(e) { toast('Failed to rate', 'error'); }
}

// ══════════════════════════════════════════
// PROGRESS TRACKING
// ══════════════════════════════════════════
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
    await fetch(`${API_BASE}/watch/progress`, {
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

// ══════════════════════════════════════════
// TRAILER & WATCHLIST
// ══════════════════════════════════════════
function openTrailer() {
  const url = currentMovie?.trailerUrl;
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function toggleWatchlist() {
  if (!userLoggedIn) { toast('Login to add to your list', 'error'); return; }
  const token = localStorage.getItem('token');
  try {
    const res  = await fetch(`${API_BASE}/auth/watchlist/${currentMovieId}`, {
      method:  'PUT',
      headers: { 'Authorization': `Bearer ${token}` },
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

// ══════════════════════════════════════════
// EPISODES
// ══════════════════════════════════════════
async function loadEpisodes(seriesId) {
  const section = document.getElementById('episodesSection');
  const grid    = document.getElementById('episodesGrid');
  const tabs    = document.getElementById('episodeSeasonTabs');
  section.style.display = 'block';

  try {
    const res  = await fetch(`${API_BASE}/episodes/series/${seriesId}`);
    const data = await readJsonResponse(res);
    const { seasons } = data;
    const nums = Object.keys(seasons || {}).sort((a, b) => +a - +b);

    if (nums.length === 0) {
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
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;">Failed to load episodes</p>';
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

// ══════════════════════════════════════════
// RECOMMENDATIONS
// ══════════════════════════════════════════
async function loadRecommendations(id, title) {
  const section = document.getElementById('recommendationsSection');
  const grid    = document.getElementById('recGrid');

  try {
    const res  = await fetch(`${API_BASE}/movies/${id}/recommendations`);
    if (!res.ok) return;
    const data = await readJsonResponse(res);
    const recs = data.recommendations || [];
    if (recs.length === 0) return;

    const subtitle = document.getElementById('recSubtitle');
    if (data.basedOn?.genre?.length > 0) {
      subtitle.textContent = `Because you're watching "${title}" · ${data.basedOn.genre.slice(0,3).join(', ')}`;
    }

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
              <span>${m.releaseYear || ''}</span> <span>·</span> <span>${dur}</span>
              <span class="rec-card-rating">${m.averageRating > 0 ? `⭐ ${m.averageRating}` : ''}</span>
            </div>
          </div>
        </div>`;
    }).join('');

    section.style.display = 'block';
  } catch(e) {}
}

// ══════════════════════════════════════════
// COMMENTS
// ══════════════════════════════════════════
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
    star.textContent    = '★';
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
    const res      = await fetch(`${API_BASE}/comments/movie/${currentMovieId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data     = await readJsonResponse(res);
    const comments = data.comments || [];

    const me = JSON.parse(localStorage.getItem('user') || 'null');
    const myId = me?._id || me?.id || null;

    document.getElementById('commentCount').textContent = comments.length > 0 ? `(${comments.length})` : '';

    if (comments.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
          <div style="font-size:48px;margin-bottom:12px;">💬</div>
          <p style="font-size:15px;">No reviews yet — be the first!</p>
        </div>`;
      return;
    }

    container.innerHTML = comments.map(c => {
      const filled = c.rating ? '★'.repeat(c.rating) : '';
      const empty  = c.rating ? `<span style="color:var(--text-muted);">${'★'.repeat(5 - c.rating)}</span>` : '';
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
    const res  = await fetch(`${API_BASE}/comments/movie/${currentMovieId}`, {
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
      toast('Review posted! ✅', 'success');
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
    const res = await fetch(`${API_BASE}/comments/movie/${currentMovieId}/${commentId}`, { 
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
    const res  = await fetch(`${API_BASE}/comments/movie/${currentMovieId}/${commentId}/like`, { 
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

// ══════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════
function shareMovie() {
  if (navigator.share) {
    navigator.share({ title: currentMovie?.title, url: window.location.href });
  } else {
    navigator.clipboard.writeText(window.location.href)
      .then(()  => toast('Link copied! 🔗', 'success'))
      .catch(() => toast('Could not copy link', 'error'));
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
        showPlayerMessage(`Streaming from ${activeSource.label}`);
      }
    }, 700);
  }
}

function setupNavbar() {
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  const sec  = document.getElementById('userSection');
  if (!sec) return;

  if (user) {
    sec.innerHTML = `
      <span style="font-size:13px;color:var(--text-secondary);">Hi, ${escapeHtml(user.username || 'User')}</span>
      ${user.role === 'admin' ? `<a href="admin.html"><button class="btn-nav" style="margin-left:10px;"><i class="ri-upload-cloud-line"></i> Upload</button></a>` : ''}
      <button id="logoutNavBtn" class="btn-nav" style="background:var(--bg-card);color:var(--text-secondary);margin-left:10px;">Logout</button>`;
    document.getElementById('logoutNavBtn')?.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = 'login.html';
    });
  } else {
    sec.innerHTML = `<a href="login.html"><button class="btn-nav">Sign In</button></a>`;
  }
}



})();
