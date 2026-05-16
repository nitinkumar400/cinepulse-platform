// ══════════════════════════════════════════
// CINE STREAM — Main App JavaScript
// Loaded on every page via <script src="../js/app.js">
// Depends on: config.js (must load before this)
// ══════════════════════════════════════════

// ══════════════════════════════════════════
// TOAST NOTIFICATIONS
// FIX: Auto-create container if page forgot it
// FIX: escapeHtml on message — prevents XSS via toast
// FIX: Replaced inline onclick with addEventListener (CSP safe)
// ══════════════════════════════════════════
function showToast(message, type = 'success', duration = 3500) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id        = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = {
    success: 'ri-checkbox-circle-line',
    error:   'ri-error-warning-line',
    warning: 'ri-alert-line',
    info:    'ri-information-line',
  };

  toast.innerHTML = `
    <i class="${icons[type] || icons.info}"></i>
    <span>${escapeHtml(String(message))}</span>
    <button class="toast-close" aria-label="Dismiss">
      <i class="ri-close-line"></i>
    </button>`;

  // FIX: addEventListener instead of inline onclick
  toast.querySelector('.toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    clearTimeout(autoTimer);
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  });

  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));

  const autoTimer = setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, duration);
}

// ══════════════════════════════════════════
// AUTH HELPERS
// FIX: getUser wrapped in try/catch —
//      corrupted localStorage JSON crashes the entire page
// FIX: logout accepts redirect param — old code always redirected
// FIX: Added saveAuth helper
// ══════════════════════════════════════════
function getToken() {
  return localStorage.getItem('token') || null;
}

const originalFetch = window.fetch.bind(window);
window.fetch = function fetchWithApiAuth(url, options = {}) {
  if (typeof url === 'string' && url.includes('/api/')) {
    const token = getToken();
    const headers = new Headers(options.headers || {});
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    return originalFetch(url, { ...options, headers });
  }

  return originalFetch(url, options);
};

const YOUTUBE_ID_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;
const DAILYMOTION_ID_REGEX = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([A-Za-z0-9]+)/i;
const VIMEO_ID_REGEX = /(?:vimeo\.com\/(?:video\/)?)(\d+)/i;
const CINESTREAM_ELITE_AVATARS = [
  { id: 'ayanokoji', name: 'Kiyotaka Ayanokoji', series: 'Classroom of the Elite', accent: '#ef4444', shadow: '#020617', glow: '#b91c1c' },
  { id: 'gojo', name: 'Satoru Gojo', series: 'Jujutsu Kaisen', accent: '#7dd3fc', shadow: '#111827', glow: '#38bdf8' },
  { id: 'eren', name: 'Eren Yeager', series: 'Attack on Titan', accent: '#f97316', shadow: '#111111', glow: '#dc2626' },
  { id: 'jinwoo', name: 'Sung Jin-Woo', series: 'Solo Leveling', accent: '#6366f1', shadow: '#020617', glow: '#4338ca' },
  { id: 'zoro', name: 'Roronoa Zoro', series: 'One Piece', accent: '#10b981', shadow: '#052e16', glow: '#059669' },
  { id: 'lelouch', name: 'Lelouch Lamperouge', series: 'Code Geass', accent: '#a855f7', shadow: '#1e1b4b', glow: '#7c3aed' },
  { id: 'itachi', name: 'Itachi Uchiha', series: 'Naruto', accent: '#f43f5e', shadow: '#111827', glow: '#b91c1c' },
  { id: 'kaneki', name: 'Ken Kaneki', series: 'Tokyo Ghoul', accent: '#e5e7eb', shadow: '#111111', glow: '#ef4444' },
  { id: 'alucard', name: 'Alucard', series: 'Hellsing Ultimate', accent: '#f87171', shadow: '#0f172a', glow: '#991b1b' },
  { id: 'madara', name: 'Madara Uchiha', series: 'Naruto', accent: '#fb7185', shadow: '#1f2937', glow: '#be123c' },
  { id: 'mikasa', name: 'Mikasa Ackerman', series: 'Attack on Titan', accent: '#fca5a5', shadow: '#111827', glow: '#ef4444' },
  { id: 'makima', name: 'Makima', series: 'Chainsaw Man', accent: '#f43f5e', shadow: '#1f2937', glow: '#9f1239' },
  { id: 'yor', name: 'Yor Forger', series: 'Spy x Family', accent: '#fb7185', shadow: '#1f2937', glow: '#e11d48' },
  { id: 'esdeath', name: 'Esdeath', series: 'Akame ga Kill', accent: '#93c5fd', shadow: '#172554', glow: '#2563eb' },
  { id: 'robin', name: 'Nico Robin', series: 'One Piece', accent: '#c084fc', shadow: '#1e1b4b', glow: '#8b5cf6' },
  { id: 'saber', name: 'Saber', series: 'Fate Series', accent: '#fde68a', shadow: '#1f2937', glow: '#f59e0b' },
  { id: 'power', name: 'Power', series: 'Chainsaw Man', accent: '#fbbf24', shadow: '#111827', glow: '#f97316' },
  { id: 'nobara', name: 'Nobara Kugisaki', series: 'Jujutsu Kaisen', accent: '#fda4af', shadow: '#1f2937', glow: '#fb7185' },
  { id: '2b', name: '2B', series: 'NieR:Automata', accent: '#e5e7eb', shadow: '#111827', glow: '#9ca3af' },
  { id: 'nezuko', name: 'Nezuko Kamado', series: 'Demon Slayer', accent: '#f9a8d4', shadow: '#1f2937', glow: '#ec4899' },
];

function getUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || 'null');
  } catch {
    localStorage.removeItem('user');
    return null;
  }
}

function isLoggedIn() { return !!getToken(); }
function isAdmin()    { return getUser()?.role === 'admin'; }

function saveAuth(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function parseApiPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) {
    return {
      ...payload.data,
      success: payload.success,
      message: payload.message,
      error: payload.error,
    };
  }

  return payload;
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  return parseApiPayload(payload);
}

function setQueryParam(key, value, options = {}) {
  try {
    const url = new URL(window.location.href);
    if (value === null || value === undefined || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }

    if (options.replace) {
      window.history.replaceState({}, '', url);
    } else {
      window.history.pushState({}, '', url);
    }
  } catch (error) {
    console.warn('Failed to update query param:', error.message);
  }
}

function isEliteAvatarId(value = '') {
  return String(value).startsWith('elite:');
}

function getEliteAvatarById(value = '') {
  const normalizedId = String(value).replace(/^elite:/, '').trim().toLowerCase();
  return CINESTREAM_ELITE_AVATARS.find((avatar) => avatar.id === normalizedId) || null;
}

function createEliteAvatarSvg(avatar) {
  const initials = avatar.name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] || '')
    .join('')
    .toUpperCase();

  return `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" role="img" aria-label="${avatar.name}">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${avatar.shadow}" />
          <stop offset="100%" stop-color="#030712" />
        </linearGradient>
        <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${avatar.accent}" />
          <stop offset="100%" stop-color="${avatar.glow}" />
        </linearGradient>
        <filter id="softGlow" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="12" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect width="320" height="320" rx="38" fill="url(#bg)"/>
      <circle cx="250" cy="72" r="72" fill="${avatar.glow}" opacity="0.28" filter="url(#softGlow)"/>
      <circle cx="76" cy="256" r="86" fill="${avatar.accent}" opacity="0.14"/>
      <path d="M38 225 L160 54 L282 225 L160 282 Z" fill="none" stroke="url(#accent)" stroke-width="6" opacity="0.85"/>
      <text x="34" y="68" fill="${avatar.accent}" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="4">CINESTREAM ELITE</text>
      <text x="36" y="178" fill="#f8fafc" font-family="Arial, sans-serif" font-size="98" font-weight="800" letter-spacing="2">${initials}</text>
      <text x="38" y="226" fill="#ffffff" font-family="Arial, sans-serif" font-size="22" font-weight="700">${avatar.name}</text>
      <text x="38" y="254" fill="#94a3b8" font-family="Arial, sans-serif" font-size="16">${avatar.series}</text>
    </svg>
  `.trim();
}

function getEliteAvatarDataUrl(value = '') {
  const avatar = getEliteAvatarById(value);
  if (!avatar) return '';

  const svg = createEliteAvatarSvg(avatar);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function resolveAvatarImage(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (isEliteAvatarId(raw)) return getEliteAvatarDataUrl(raw);
  if (raw.startsWith('http') || raw.startsWith('/') || raw.startsWith('data:image')) return getImageUrl(raw);
  return '';
}

function getSourceType(url = '', fallbackType = '') {
  const explicit = String(fallbackType || '').trim().toLowerCase();
  if (explicit) return explicit;

  const raw = String(url || '').trim();
  if (!raw) return 'offline';
  if (YOUTUBE_ID_REGEX.test(raw)) return 'youtube';
  if (DAILYMOTION_ID_REGEX.test(raw)) return 'dailymotion';
  if (VIMEO_ID_REGEX.test(raw)) return 'vimeo';
  return 'local';
}

function getCleanEmbedUrl(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';

  const youtubeEmbedUrl = buildYouTubeEmbed(raw);
  if (youtubeEmbedUrl) {
    return youtubeEmbedUrl;
  }

  const dailymotionMatch = raw.match(DAILYMOTION_ID_REGEX);
  if (dailymotionMatch?.[1]) {
    const params = new URLSearchParams({
      autoplay: '1',
    });
    return `https://www.dailymotion.com/embed/video/${dailymotionMatch[1]}?${params.toString()}`;
  }

  const vimeoMatch = raw.match(VIMEO_ID_REGEX);
  if (vimeoMatch?.[1]) {
    const params = new URLSearchParams({
      autoplay: '1',
    });
    return `https://player.vimeo.com/video/${vimeoMatch[1]}?${params.toString()}`;
  }

  return '';
}

function buildYouTubeEmbed(url = '') {
  const match = String(url || '').match(YOUTUBE_ID_REGEX);

  if (!match?.[1]) return null;

  const id = match[1];
  const params = new URLSearchParams({
    autoplay: '1',
    rel: '0',
    modestbranding: '1',
    controls: '1',
    fs: '1',
    cc_load_policy: '1',
    enablejsapi: '1',
    origin: window.location.origin,
    playsinline: '1',
  });

  return `https://www.youtube.com/embed/${id}?${params.toString()}`;
}

function getProviderIframeAttributes() {
  return {
    allow: 'autoplay; fullscreen; picture-in-picture; encrypted-media; gyroscope; accelerometer; clipboard-write;',
    referrerPolicy: 'strict-origin-when-cross-origin',
  };
}

function isOfflinePlaybackSource(url = '', sourceType = '') {
  const raw = String(url || '').trim();
  if (!raw) return true;

  const resolvedType = getSourceType(raw, sourceType);
  if (resolvedType === 'youtube' || resolvedType === 'dailymotion' || resolvedType === 'vimeo') {
    return !getCleanEmbedUrl(raw);
  }

  return false;
}

window.parseApiPayload = parseApiPayload;
window.readJsonResponse = readJsonResponse;
window.setQueryParam = setQueryParam;
window.getSourceType = getSourceType;
window.buildYouTubeEmbed = buildYouTubeEmbed;
window.getCleanEmbedUrl = getCleanEmbedUrl;
window.isOfflinePlaybackSource = isOfflinePlaybackSource;
window.getProviderIframeAttributes = getProviderIframeAttributes;
window.CINESTREAM_ELITE_AVATARS = CINESTREAM_ELITE_AVATARS;
window.isEliteAvatarId = isEliteAvatarId;
window.getEliteAvatarById = getEliteAvatarById;
window.getEliteAvatarDataUrl = getEliteAvatarDataUrl;
window.resolveAvatarImage = resolveAvatarImage;

function logout(redirect = true) {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  // FIX: Old code hardcoded 'login.html' (relative) — breaks from root pages
  if (redirect) window.location.href = '/login';
}

// ══════════════════════════════════════════
// MEDIA URL HELPER — Bulletproof Sanitizer
// Strategy:
// - null/empty → placeholder
// - AniList URLs (anilist.co) → pass through
// - Already-correct TMDB CDN URLs (image.tmdb.org) → pass through
// - Cloudinary URLs (cloudinary.com) → pass through
// - data: URIs → pass through
// - Everything else (local /uploads paths, localhost URLs, etc.) → extract
//   the TMDB ID from the filename pattern and rebuild via TMDB CDN.
//   If no TMDB ID can be extracted, use the raw filename as a TMDB hash.
// ══════════════════════════════════════════
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/';
const POSTER_PLACEHOLDER_URL = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTI0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjMzMzIj7wn46YIDM8L3RleHQ+PC9zdmc+';

function getImageUrl(path, size) {
  if (!path) return POSTER_PLACEHOLDER_URL;
  // Already-good URLs — pass through untouched
  if (path.includes('anilist.co')) return path;
  if (path.includes('image.tmdb.org')) return path;
  if (path.includes('cloudinary.com')) return path;
  if (path.startsWith('data:')) return path;
  // Everything else: extract filename and route through TMDB CDN
  const filename = String(path).split('/').pop().split('?')[0];
  if (!filename) return POSTER_PLACEHOLDER_URL;
  return `${TMDB_IMAGE_BASE}${size || 'w500'}/${filename}`;
}

function getBackdropUrl(path) {
  return getImageUrl(path, 'original');
}

const mediaUrl = getImageUrl;

// ══════════════════════════════════════════
// ESCAPE HTML — prevent XSS
// ══════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

// ══════════════════════════════════════════
// MOVIE CARD BUILDER
// FIX: thumbnailUrl fallback was empty string — broken image icon showed
// FIX: mediaUrl() used so Cloudinary + local both work
// FIX: category escaped to prevent XSS
// FIX: Added optional progress bar for "Continue Watching" cards
// ══════════════════════════════════════════
const CARD_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjMWExYTI0Ii8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtc2l6ZT0iNDAiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGR5PSIuM2VtIiBmaWxsPSIjMzMzIj7wn46YIDM8L3RleHQ+PC9zdmc+';

// ── Badge helpers ──────────────────────────────────────────────
// Reads the `qualities` object from MongoDB data to decide whether
// to show an HD badge.  A movie is considered HD if it has any
// non-empty quality URL at 720p or 1080p, OR if its videoUrl is
// non-empty (external embeds are assumed HD by default).
function _hasHdQuality(movie) {
  const q = movie.qualities;
  if (q && typeof q === 'object') {
    if (String(q['1080p'] || '').trim()) return true;
    if (String(q['720p']  || '').trim()) return true;
  }
  // External embed sources (YouTube, VidSrc, etc.) are HD by default
  if (String(movie.videoUrl || '').trim()) return true;
  // Check sources array for any non-upload server (embed = HD)
  if (Array.isArray(movie.sources) && movie.sources.length) {
    return movie.sources.some((s) => s.server && s.server !== 'upload');
  }
  return false;
}

// Returns 'Subbed', 'Dubbed', or '' based on subDubTag field.
// Only shown for anime/cartoon categories.
function _getSubDubBadge(movie) {
  const cat = String(movie.category || '').toLowerCase();
  if (cat !== 'anime' && cat !== 'cartoon') return '';
  const tag = String(movie.subDubTag || '').trim();
  if (tag === 'Dubbed') return 'Dubbed';
  if (tag === 'Subbed') return 'Subbed';
  // Default anime to Subbed when tag is absent
  if (cat === 'anime') return 'Subbed';
  return '';
}

function createMovieCard(movie, opts = {}) {
  if (!movie) return '';

  const thumb    = getImageUrl(movie.thumbnailUrl) || CARD_PLACEHOLDER;
  const badgeMap = {
    anime:'badge-anime', movie:'badge-movie',
    series:'badge-series', cartoon:'badge-cartoon',
    documentary:'badge-documentary', short:'badge-movie',
  };
  const badgeCls = badgeMap[movie.category] || 'badge-movie';
  const rating   = movie.averageRating > 0 ? movie.averageRating : '—';
  const spokenLanguages = Array.isArray(movie.spoken_languages) ? movie.spoken_languages : [];
  const normalizedLanguageSet = new Set(spokenLanguages.map((lang) => String(lang || '').trim().toLowerCase()));
  const languageTags = [
    normalizedLanguageSet.has('en') || normalizedLanguageSet.has('english') ? 'English' : '',
    normalizedLanguageSet.has('hi') || normalizedLanguageSet.has('hindi') ? 'Hindi' : '',
    normalizedLanguageSet.has('ko') || normalizedLanguageSet.has('korean') ? 'Korean' : '',
  ].filter(Boolean);
  const subDubTag = String(movie.subDubTag || '').trim() || (String(movie.category || '').toLowerCase() === 'anime' ? 'Subbed' : '');
  const nextAiringAt = movie?.nextAiringEpisode?.airingAt ? new Date(movie.nextAiringEpisode.airingAt) : null;
  const isOngoingAnime = String(movie?.status || '').toLowerCase() === 'ongoing' && String(movie?.category || '').toLowerCase() === 'anime';
  const countdownMarkup = isOngoingAnime && nextAiringAt && !Number.isNaN(nextAiringAt.getTime())
    ? `<div class="card-next-episode" data-airing-at="${nextAiringAt.toISOString()}">Next Ep in --</div>`
    : '';

  // Optional progress bar (for Continue Watching)
  const progressBar = opts.progress > 0 ? `
    <div class="card-progress-bar">
      <div class="card-progress-fill"
           style="width:${Math.min(100, Math.round(opts.progress))}%">
      </div>
    </div>` : '';

  // ── Poster overlay badges ──────────────────────────────────
  // HD badge: shown when the movie has 720p/1080p quality data
  //           or any external embed source (reads `qualities` + `sources`
  //           fields directly from the MongoDB document).
  const showHd      = _hasHdQuality(movie);
  const subDubBadge = _getSubDubBadge(movie);   // 'Subbed' | 'Dubbed' | ''

  const hdBadgeHtml = showHd
    ? `<span class="cp-badge cp-badge--hd" aria-label="HD quality">HD</span>`
    : '';
  const subDubBadgeHtml = subDubBadge === 'Dubbed'
    ? `<span class="cp-badge cp-badge--dub" aria-label="Dubbed">DUB</span>`
    : subDubBadge === 'Subbed'
      ? `<span class="cp-badge cp-badge--sub" aria-label="Subbed">SUB</span>`
      : '';

  return `
    <div class="movie-card" data-id="${movie._id}">
      <div class="card-thumbnail">
        <img src="${thumb}"
             alt="${escapeHtml(movie.title)}"
             loading="lazy"
             referrerpolicy="no-referrer"
             onerror="this.src='${CARD_PLACEHOLDER}'">
        <div class="card-overlay">
          <div class="card-play-btn"><i class="ri-play-fill"></i></div>
        </div>
        <span class="card-badge ${badgeCls}">${escapeHtml(movie.category)}</span>
        <div class="card-rating">
          <i class="ri-star-fill"></i> ${rating}
        </div>
        ${hdBadgeHtml}
        ${subDubBadgeHtml}
        ${progressBar}
      </div>
      <div class="card-info">
        <div class="card-title">${escapeHtml(movie.title)}</div>
        <div class="card-meta">
          <span>${movie.releaseYear || ''}</span>
          ${movie.duration
            ? `<span>·</span><span>${formatDuration(movie.duration)}</span>`
            : ''}
          ${movie.views > 0
            ? `<span>·</span><span>${formatNumber(movie.views)} views</span>`
            : ''}
        </div>
        ${languageTags.length
          ? `<div class="card-language-tags">${languageTags.map((lang) => `<span class="card-language-tag">${escapeHtml(lang)}</span>`).join('')}</div>`
          : ''}
        ${subDubTag ? `<div class="card-language-tags"><span class="card-language-tag">${escapeHtml(subDubTag)}</span></div>` : ''}
        ${countdownMarkup}
      </div>
    </div>`;
}

// Event delegation card click handler
function handleCardClick(e) {
  const card = e.target.closest('.movie-card[data-id]');
  if (card) {
    // FIX: Absolute path — old code used relative 'movie-details.html'
    window.location.href = `/pages/movie-details.html?id=${card.dataset.id}`;
  }
}

// ══════════════════════════════════════════
// NAVBAR SETUP
// FIX: All hrefs use absolute /pages/... paths
//      Old code used relative paths that break on root-level routes
// FIX: Notification bell now has a click handler
// FIX: Avatar bg color escaped to prevent attribute injection
// ══════════════════════════════════════════
function initNavbar() {
  const sec  = document.getElementById('userSection');
  if (!sec) return;

  // Stateless Public Site: navbar only shows search icon, no auth buttons
  sec.innerHTML = `
    <div class="nav-user-wrap">
      <a href="/pages/search.html" class="nav-icon-btn" title="Search">
        <i class="ri-search-line"></i>
      </a>
    </div>`;

  // Scroll effect
  const navbar = document.getElementById('navbar');
  if (navbar) {
    window.addEventListener('scroll', () => {
      navbar.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });
  }
}

function applyCinePulseBranding() {
  document.querySelectorAll('.nav-logo').forEach((logo) => {
    logo.innerHTML = '<span>Cine</span><span class="logo-accent">Pulse</span><span class="logo-pulse" aria-hidden="true"></span>';
  });
}

// ══════════════════════════════════════════
// API FETCH HELPER
// FIX: FormData must NOT have Content-Type set manually
//      Old code always set it — broke every file upload
//      Browser needs to set it automatically with the multipart boundary
// FIX: Network error caught and shown as toast
// FIX: 401 checks code field not fragile message string matching
// ══════════════════════════════════════════
async function apiFetch(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  // FIX: Remove Content-Type for FormData uploads
  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  let res;
  try {
    res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
  } catch (err) {
    showToast('Cannot connect to server', 'error');
    throw err;
  }

  if (res.status === 401) {
    const data = await readJsonResponse(res);
    console.error('[AUTH] 401 Unauthorized — logout triggered by endpoint:', `${API_BASE}${endpoint}`);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    showToast('Session expired — please login again', 'warning');
    setTimeout(() => { window.location.href = '/pages/admin.html'; }, 300);
    throw new Error(data.message || 'Unauthorized');
  }

  return res;
}

const API_MAX_RETRIES = 2;
const API_RETRY_BASE_DELAY_MS = 300;

function buildApiUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${API_BASE}${endpoint}`;
}

function getRetryDelayMs(attempt, response) {
  const retryAfterHeader = response?.headers?.get?.('retry-after');
  const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  return API_RETRY_BASE_DELAY_MS * (2 ** attempt);
}

function shouldRetryRequest(method, error, response, attempt, maxRetries) {
  if (attempt >= maxRetries) return false;

  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalizedMethod)) return false;
  if (response?.status === 429) return true;
  if (error) return true;
  return response?.status >= 500;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clearAuthSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function redirectToAdminLogin() {
  const path = window.location.pathname.replace(/\.html$/, '');
  if (path === '/pages/admin' || path.endsWith('/admin')) {
    return;
  }

  window.location.href = '/pages/admin.html';
}

async function performApiFetchWithRetry(endpoint, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };

  if (options.body instanceof FormData) {
    delete headers['Content-Type'];
  }

  const requestOptions = { ...options, headers };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : API_MAX_RETRIES;
  let attempt = 0;
  let lastError = null;
  let lastResponse = null;

  while (attempt <= maxRetries) {
    try {
      const response = await fetch(buildApiUrl(endpoint), requestOptions);

      if (response.status === 401 || response.status === 403) {
        if (options.silent) {
          return response;
        }
        const data = await readJsonResponse(response.clone());
        console.error('[AUTH]', response.status, '— logout triggered by endpoint:', buildApiUrl(endpoint));
        clearAuthSession();
        const fallbackMessage = response.status === 403
          ? 'Admin access required. Please sign in with an admin account.'
          : 'Session expired. Please sign in again.';
        showToast(fallbackMessage, 'warning');
        setTimeout(() => { redirectToAdminLogin(); }, 300);
        throw new Error(data.message || fallbackMessage);
      }

      if (!shouldRetryRequest(method, null, response, attempt, maxRetries)) {
        return response;
      }

      lastResponse = response;
      await delay(getRetryDelayMs(attempt, response));
    } catch (error) {
      lastError = error;
      if (!shouldRetryRequest(method, error, null, attempt, maxRetries)) {
        break;
      }

      await delay(getRetryDelayMs(attempt));
    }

    attempt += 1;
  }

  if (lastError) {
    showToast('Cannot connect to server', 'error');
    throw lastError;
  }

  return lastResponse;
}

apiFetch = async function apiFetchWithMemoization(endpoint, options = {}) {
  return performApiFetchWithRetry(endpoint, options);
};

window.apiFetch = apiFetch;

// ══════════════════════════════════════════
// WATCHLIST TOGGLE
// ══════════════════════════════════════════
async function toggleWatchlist(movieId, btn) {
  if (!isLoggedIn()) {
    showToast('Please login to use watchlist', 'error');
    return;
  }
  try {
    const res  = await apiFetch(`/auth/watchlist/${movieId}`, { method: 'PUT' });
    const data = await readJsonResponse(res);
    if (res.ok) {
      if (btn) {
        btn.innerHTML = data.inWatchlist
          ? '<i class="ri-bookmark-fill"></i>'
          : '<i class="ri-bookmark-line"></i>';
        btn.classList.toggle('active', data.inWatchlist);
      }
      showToast(data.message, 'success');
    }
  } catch (e) {
    showToast('Failed to update watchlist', 'error');
  }
}

// ══════════════════════════════════════════
// FORMAT HELPERS
// FIX: timeAgo was missing weeks + months —
//      jumped from "29d ago" straight to a full date
// FIX: Added formatTime (seconds → "m:ss" or "h:mm:ss")
// FIX: Added formatCount as alias for formatNumber
// ══════════════════════════════════════════
function formatDuration(minutes) {
  if (!minutes) return '—';
  const h   = Math.floor(minutes / 60);
  const min = minutes % 60;
  return h > 0 ? `${h}h ${min}m` : `${min}m`;
}

function formatNumber(n) {
  if (!n || isNaN(n)) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}
const formatCount = formatNumber;

function formatTime(seconds) {
  if (!isFinite(seconds) || isNaN(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0)
    return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff   = Date.now() - new Date(dateStr).getTime();
  const mins   = Math.floor(diff / 60_000);
  const hours  = Math.floor(diff / 3_600_000);
  const days   = Math.floor(diff / 86_400_000);
  const weeks  = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years  = Math.floor(days / 365);

  if (mins   <  1) return 'just now';
  if (mins   < 60) return `${mins}m ago`;
  if (hours  < 24) return `${hours}h ago`;
  if (days   <  7) return `${days}d ago`;
  // FIX: These two lines were missing — jumped from "29d ago" to a full date
  if (weeks  <  5) return `${weeks}w ago`;
  if (months < 12) return `${months}mo ago`;
  return `${years}y ago`;
}

// ══════════════════════════════════════════
// SPINNER / EMPTY STATE HELPERS
// FIX: Added showEmpty — was only showError before
//      Both kept for backwards compat
// ══════════════════════════════════════════
function showSpinner(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML =
    '<div class="spinner-container"><div class="spinner"></div></div>';
}

function showEmpty(containerId, msg = 'Nothing here yet', icon = '🎬') {
  const el = document.getElementById(containerId);
  if (el) el.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">${icon}</div>
      <p>${escapeHtml(msg)}</p>
    </div>`;
}

function showError(containerId, msg = 'Failed to load') {
  showEmpty(containerId, msg, '😕');
}

// ══════════════════════════════════════════
// DEBOUNCE
// FIX: Was missing — search inputs likely fired API on every keystroke
// ══════════════════════════════════════════
function debounce(fn, delay = 400) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ══════════════════════════════════════════
// INFINITE SCROLL
// FIX: Was missing — dashboard/search needed this
// ══════════════════════════════════════════
function setupInfiniteScroll({ loader, threshold = 300 }) {
  let loading = false;
  const handler = async () => {
    if (loading) return;
    const scrolled  = window.scrollY + window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    if (scrolled >= docHeight - threshold) {
      loading = true;
      await loader();
      loading = false;
    }
  };
  window.addEventListener('scroll', handler, { passive: true });
  return () => window.removeEventListener('scroll', handler);
}

// ══════════════════════════════════════════
// NOTIFICATION SYSTEM
// FIX: endpoint is relative — apiFetch prepends API_BASE
//      Old code called /notifications which was the full path
// FIX: Badge clears text when count = 0 (was just hidden)
// FIX: Added polling every 2 minutes
// ══════════════════════════════════════════
const NotificationSystem = {
  count: 0,

  async init() {
    if (!isLoggedIn()) return;
    try {
      await this.loadCount();
      setInterval(() => this.loadCount(), 2 * 60 * 1000);
    } catch (e) { /* Silent */ }
  },

  async loadCount() {
    try {
      const res  = await apiFetch('/notifications?limit=1&unreadOnly=true');
      const data = await readJsonResponse(res);
      this.count = data.unreadCount || 0;
      this.updateBadge();
    } catch (e) { /* Silent */ }
  },

  updateBadge() {
    const badge = document.getElementById('notifBadge');
    if (!badge) return;
    if (this.count > 0) {
      badge.textContent   = this.count > 99 ? '99+' : this.count;
      badge.style.display = 'flex';
    } else {
      badge.textContent   = ''; // FIX: clear stale number
      badge.style.display = 'none';
    }
  },
};

function isPublicRoute(pathname = window.location.pathname) {
  // Stateless Public Site: all public-facing pages are accessible without auth
  // Admin page has its own inline login gate, so it's also "public" from the router's perspective
  const normalizedPath = pathname.replace(/\.html$/, '');
  const publicPaths = [
    '/', '/index', '/pages/index',
    '/browse', '/pages/browse',
    '/pages/movie-details', '/pages/search',
    '/pages/episode', '/pages/player',
    '/pages/admin',
    '/login', '/pages/login',
    '/offline', '/pages/offline',
  ];
  if (normalizedPath.startsWith('/browse/')) return true;
  return publicPaths.some(p => normalizedPath === p || normalizedPath.endsWith(p));
}

function enforceAdminPageAccess() {
  // Stateless Public Site: public routes never redirect to login
  if (isPublicRoute()) {
    return true;
  }

  // Nuclear Auth Guard: admin-only pages just check token presence.
  // Backend validates role on every API call; 401/403 triggers the apiFetch
  // interceptor which handles the logout redirect safely.
  if (!getToken()) {
    redirectToAdminLogin();
    return false;
  }

  return true;
}

// ══════════════════════════════════════════
// AUTO INIT
// ══════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  applyCinePulseBranding();
  if (!enforceAdminPageAccess()) return;
  initNavbar();
  if (isLoggedIn()) NotificationSystem.init();
  document.addEventListener('click', handleCardClick);
});

function getCountdownLabel(targetIsoDate = '') {
  const target = new Date(targetIsoDate);
  if (Number.isNaN(target.getTime())) return 'Next Ep soon';

  const diffMs = target.getTime() - Date.now();
  if (diffMs <= 0) return 'Next Ep airing now';

  const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return `Next Ep in ${days}d ${hours}h`;
}

function refreshAnimeCountdowns() {
  document.querySelectorAll('.card-next-episode[data-airing-at]').forEach((node) => {
    node.textContent = getCountdownLabel(node.dataset.airingAt || '');
  });
}

setInterval(refreshAnimeCountdowns, 60000);
document.addEventListener('DOMContentLoaded', refreshAnimeCountdowns);
// ══════════════════════════════════════════
// GLOBAL IMAGE REFERRER FIX
// Patches ALL images on every page automatically
// Fixes AniList/TMDB/external CDN hotlink blocking
// ══════════════════════════════════════════
(function () {
  function patchImg(img) {
    img.referrerPolicy = 'no-referrer';
    if (img.src && img.src !== window.location.href) {
      const src = img.src;
      img.src   = '';
      img.src   = src;
    }
  }

  function patchAll() {
    document.querySelectorAll('img').forEach(patchImg);
  }

  // Patch images already in DOM
  document.addEventListener('DOMContentLoaded', patchAll);

  // Patch every new image added dynamically (cards, grids, etc.)
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (!node || node.nodeType !== 1) return;
        if (node.tagName === 'IMG') {
          patchImg(node);
        } else {
          node.querySelectorAll('img').forEach(patchImg);
        }
      });
    });
  });

  // Start observing as soon as body exists
  const startObserver = () => {
    if (document.body) {
      observer.observe(document.body, { childList: true, subtree: true });
    } else {
      setTimeout(startObserver, 10);
    }
  };
  startObserver();
})();

// ══════════════════════════════════════════
// TELEGRAM WIDGET
// ══════════════════════════════════════════
function initTelegramWidget() {
  if (document.getElementById('telegramWidget')) return;
  
  // Hide on admin page
  if (window.location.pathname.includes('/admin')) return;

  const widget = document.createElement('div');
  widget.id = 'telegramWidget';
  widget.className = 'telegram-floating-widget';
  widget.innerHTML = `
    <button class="close-btn" aria-label="Close" onclick="this.parentElement.classList.add('hidden')">&times;</button>
    <div class="telegram-icon">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 24C18.6274 24 24 18.6274 24 12C24 5.37258 18.6274 0 12 0C5.37258 0 0 5.37258 0 12C0 18.6274 5.37258 24 12 24Z" fill="#0088CC"/>
        <path d="M5.44025 11.6601L16.2625 7.48785C16.7645 7.30235 17.2036 7.60805 17.027 8.23938L14.9757 17.8863C14.8315 18.5283 14.4443 18.6946 13.9118 18.397L10.9723 16.2307L9.55404 17.595C9.39712 17.7519 9.26767 17.8814 8.95383 17.8814L9.16568 14.8872L14.6148 9.96781C14.8517 9.75677 14.5637 9.63914 14.2483 9.85159L7.51862 14.0887L4.61907 13.1812C3.98901 12.9842 3.97825 12.5511 4.75051 12.2497L5.44025 11.6601Z" fill="white"/>
      </svg>
    </div>
    <div class="telegram-text">t.me/cinepulse_platform</div>
    <a href="https://t.me/cinepulse_platform" target="_blank" class="join-btn">Join our Telegram.</a>
  `;
  document.body.appendChild(widget);
}

document.addEventListener('DOMContentLoaded', initTelegramWidget);
