// ══════════════════════════════════════════════════════════════════════════
// CINE STREAM — Browse Page Module
// Spec: cinepulse-platform-overhaul, Task 13.2
// Requirements: 13.1–13.5
//
// Powers all six /browse/:category routes from a single shared template
// (public/pages/browse.html). Reads the active category from the URL path
// at runtime, renders the breadcrumb, hero banner and search placeholder,
// and loads the initial 24 items via GET /api/browse/:category.
//
// Tasks 13.3 (infinite scroll), 13.4 (filter sidebar), 13.5 (subbed/dubbed
// + in-category search) extend this module via the window.BrowsePage
// surface exposed at the bottom of the IIFE.
//
// Depends on (loaded earlier in browse.html):
//   - public/js/app.js   → createMovieCard(), escapeHtml()
//   - public/js/api.js   → apiRequest()
// ══════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Constants ────────────────────────────────────────────────────────────
  const VALID_CATEGORIES = ['movies', 'anime', 'series', 'kdrama', 'chinese', 'hindi'];
  const PAGE_LIMIT = 24;

  // Display metadata per category. Hero gradients use the existing CinePulse
  // accent palette so each browse page feels distinct without needing
  // remote artwork.
  const CATEGORY_META = {
    movies: {
      name: 'Movies',
      subtitle: 'Hand-picked films from across the globe.',
      heroGradient: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%)',
    },
    anime: {
      name: 'Anime',
      subtitle: 'Japanese animation, donghua, and global anime hits.',
      heroGradient: 'linear-gradient(135deg, #1a1a2e 0%, #2d1b4e 60%, #4a1d6e 100%)',
    },
    series: {
      name: 'Series',
      subtitle: 'Binge-worthy TV series from major networks.',
      heroGradient: 'linear-gradient(135deg, #1a1a2e 0%, #1e3c72 60%, #2a5298 100%)',
    },
    kdrama: {
      name: 'K-Drama',
      subtitle: 'Korean dramas — romance, thrillers, slice-of-life.',
      heroGradient: 'linear-gradient(135deg, #1a1a2e 0%, #4a1942 60%, #7a1c5a 100%)',
    },
    chinese: {
      name: 'Chinese (Donghua)',
      subtitle: 'Animated epics and live-action favourites from China.',
      heroGradient: 'linear-gradient(135deg, #1a1a2e 0%, #5e1620 60%, #8b1a1a 100%)',
    },
    hindi: {
      name: 'Hindi Dubbed',
      subtitle: 'Bollywood and global hits with Hindi audio.',
      heroGradient: 'linear-gradient(135deg, #1a1a2e 0%, #3a2a0f 60%, #6e4a1c 100%)',
    },
  };

  // ── State ────────────────────────────────────────────────────────────────
  // Module-private mutable state. Tasks 13.3–13.5 read & mutate via the
  // window.BrowsePage._internal surface at the bottom of the file.
  let _category = '';
  let _currentPage = 1;
  let _hasMore = true;
  let _isLoading = false;
  let _items = [];
  // IntersectionObserver instance for infinite scroll (Task 13.3 / Req 13.6).
  // Held on the module so loadInitialPage() can tear it down and rebuild on
  // filter changes (Task 13.4) without leaking listeners.
  let _observer = null;
  const _filters = {
    genre: [],
    yearMin: null,
    yearMax: null,
    ratingMin: null,
    ratingMax: null,
    language: [],
    status: [],
    sortBy: 'newest',
    q: '',
    subDub: '',
  };

  // ── Init ─────────────────────────────────────────────────────────────────
  function init() {
    _category = detectCategoryFromPath();
    if (!VALID_CATEGORIES.includes(_category)) {
      // Default to 'movies' when the URL is /browse, /browse/, or /browse/<unknown>.
      _category = 'movies';
    }

    renderBreadcrumb();
    renderHero();
    setupCategorySpecificUI();

    // Filter sidebar wiring (Task 13.4 / Requirements 14.1–14.8). These run
    // synchronously before the first fetch so the form is populated and the
    // sidebar toggle is responsive even while the grid is still loading.
    populateGenreCheckboxes();
    setupSidebarToggle();
    setupFilterEvents();

    // In-category search + Subbed/Dubbed toggle (Task 13.5 / Requirements
    // 16.1–16.5, 17.1–17.5). Wired before the first fetch so user input
    // during the initial load is buffered by the debounce wrapper instead
    // of being lost.
    setupInCategorySearch();
    setupSubDubToggle();

    // Kick off the initial fetch — Requirement 13.4 (load 24 items on entry).
    loadInitialPage();
  }

  // Reads the active category from the URL path (Requirement 13.1). Vercel
  // rewrites map all /browse/:category URLs to /pages/browse.html, so the
  // path still contains the original category segment.
  function detectCategoryFromPath() {
    const path = window.location.pathname || '';
    const match = path.match(/^\/browse\/([a-z]+)/i);
    return match ? match[1].toLowerCase() : '';
  }

  function renderBreadcrumb() {
    const meta = CATEGORY_META[_category] || CATEGORY_META.movies;
    const el = document.getElementById('breadcrumbCategory');
    if (el) el.textContent = meta.name;

    document.title = `Browse ${meta.name} · CINE STREAM`;
  }

  function renderHero() {
    const meta = CATEGORY_META[_category] || CATEGORY_META.movies;
    const titleEl = document.getElementById('browseHeroTitle');
    const subtitleEl = document.getElementById('browseHeroSubtitle');
    const bgEl = document.getElementById('browseHeroBg');

    if (titleEl) titleEl.textContent = meta.name;
    if (subtitleEl) subtitleEl.textContent = meta.subtitle;
    // The browse-hero-bg element already sits behind a gradient overlay
    // (see browse.html). Setting `background` here gives each category a
    // distinct base layer without requiring artwork.
    if (bgEl) bgEl.style.background = meta.heroGradient;

    const searchEl = document.getElementById('browseSearch');
    if (searchEl) searchEl.placeholder = `Search within ${meta.name}…`;
  }

  // The Subbed/Dubbed toggle is anime-only (Requirement 16.1). The template
  // ships it hidden so we just reveal it for the anime category.
  function setupCategorySpecificUI() {
    const toggle = document.getElementById('browseSubDubToggle');
    if (toggle) {
      toggle.style.display = _category === 'anime' ? 'inline-flex' : 'none';
    }
  }

  // ── Fetch ────────────────────────────────────────────────────────────────
  async function loadInitialPage() {
    _currentPage = 1;
    _hasMore = true;
    _items = [];

    const grid = document.getElementById('browseGrid');
    if (grid) grid.innerHTML = '';

    // Hide the end message and remove any leftover retry button from a
    // previous filter set — they'd otherwise persist across re-fetches.
    const endEl = document.getElementById('browseEnd');
    if (endEl) endEl.style.display = 'none';
    const oldRetry = document.getElementById('browseRetryBtn');
    if (oldRetry) oldRetry.remove();

    // Tear down any existing observer so the upcoming setupInfiniteScroll()
    // call wires up against a fresh sentinel and the new state. Task 13.4
    // re-uses this entry point on every filter change.
    teardownInfiniteScroll();

    await fetchPage();

    // Set up the IntersectionObserver after the first page renders so the
    // sentinel sits at its real position in the layout (Req 13.6).
    setupInfiniteScroll();
  }

  // Build the query string that mirrors the `/api/browse/:category` schema
  // (see backend/routes/browse.js). All filter keys are dropped when empty
  // to keep request URLs short.
  function buildQueryString() {
    const params = new URLSearchParams();
    params.set('page', String(_currentPage));
    params.set('limit', String(PAGE_LIMIT));
    if (_filters.genre.length) params.set('genre', _filters.genre.join(','));
    if (_filters.yearMin !== null) params.set('yearMin', String(_filters.yearMin));
    if (_filters.yearMax !== null) params.set('yearMax', String(_filters.yearMax));
    if (_filters.ratingMin !== null) params.set('ratingMin', String(_filters.ratingMin));
    if (_filters.ratingMax !== null) params.set('ratingMax', String(_filters.ratingMax));
    if (_filters.language.length) params.set('language', _filters.language.join(','));
    if (_filters.status.length) params.set('status', _filters.status.join(','));
    if (_filters.sortBy) params.set('sortBy', _filters.sortBy);
    if (_filters.q) params.set('q', _filters.q);
    if (_filters.subDub) params.set('subDub', _filters.subDub);
    return params.toString();
  }

  async function fetchPage() {
    if (_isLoading || !_hasMore) return;
    _isLoading = true;

    // Any outstanding retry button is stale once a new fetch starts; it'll
    // be re-added by showRetryButton() if this attempt also fails.
    const existingRetry = document.getElementById('browseRetryBtn');
    if (existingRetry) existingRetry.remove();

    showLoading();

    try {
      const qs = buildQueryString();
      // `silent: true` — apiRequest swallows the toast on failure so we can
      // render an inline error in the grid instead of stacking a global
      // toast on top of it.
      const payload = await apiRequest(`/browse/${_category}?${qs}`, { silent: true });

      const items = Array.isArray(payload && payload.items) ? payload.items : [];
      _hasMore = !!(payload && payload.hasMore);
      _items = _items.concat(items);

      renderItems(items, _currentPage > 1);

      // Keep the active-filter pill row in sync after every page-1 load.
      // This covers the case where filters were restored from sessionStorage
      // or the URL before the form was wired up (Requirements 14.3, 14.5).
      if (_currentPage === 1) {
        renderActivePills();
      }

      if (!_hasMore) {
        // Req 13.7 — show "You've reached the end" and stop observing.
        showEnd();
        teardownInfiniteScroll();
      }

      _currentPage += 1;
    } catch (error) {
      // Log for ops; the inline error message is the user-visible signal.
      console.error('[Browse] fetchPage failed:', error);
      const grid = document.getElementById('browseGrid');
      if (grid && _items.length === 0) {
        // Initial page failed — replace the grid with a simple error block.
        grid.innerHTML = '<div class="browse-error">Failed to load content. Please refresh.</div>';
      } else if (_items.length > 0) {
        // Mid-pagination failure — show a tap-to-retry button below the
        // grid (Req 13.x infinite-scroll error handling).
        showRetryButton();
      }
    } finally {
      _isLoading = false;
      hideLoading();
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  function renderItems(items, append) {
    const grid = document.getElementById('browseGrid');
    if (!grid) return;

    // Match the home-page rail behaviour: only show items the player can
    // actually load (Requirement 11.8 / 13.x). When the upstream feed is
    // sparse we keep whatever came back so the page never looks empty
    // mid-pagination.
    const list = items.filter((item) => _isPlayableItem(item) && _hasPoster(item));

    if (!list.length) {
      if (!append && _items.length === 0) {
        // Req 17.5 — when an in-category search is active and yields zero
        // results, show the search-specific empty message instead of the
        // generic category empty state.
        const meta = CATEGORY_META[_category] || CATEGORY_META.movies;
        const message = _filters.q
          ? `No results found for "${escapeHtml(_filters.q)}".`
          : `No titles found in ${escapeHtml(meta.name)}.`;
        grid.innerHTML = `<div class="browse-empty">${message}</div>`;
      }
      return;
    }

    const html = list.map((item) => createMovieCard(item)).join('');
    if (append) {
      grid.insertAdjacentHTML('beforeend', html);
    } else {
      grid.innerHTML = html;
    }

    // app.js wires up a global click delegate (`handleCardClick`) on
    // `document` for `.movie-card[data-id]`, so cards already navigate.
    // We attach a scoped delegate as a defensive fallback for cases where
    // app.js hasn't loaded yet (e.g., very slow network).
    if (!grid._cpDelegated) {
      grid._cpDelegated = true;
      grid.addEventListener('click', (e) => {
        const card = e.target.closest('.movie-card[data-id]');
        if (card) {
          window.location.href = `/pages/movie-details.html?id=${card.dataset.id}`;
        }
      });
    }
  }

  // Mirrors `canPlay()` from embedServers.js without taking a hard runtime
  // dependency on it (browse.js loads before embedServers.js on this page).
  function _isPlayableItem(item) {
    if (!item) return false;
    return !!(
      item.tmdbId ||
      item.tmdb_id ||
      item.anilistId ||
      item.anilist_id ||
      (item.videoUrl && String(item.videoUrl).trim())
    );
  }

  function _hasPoster(item) {
    const poster = String(item?.thumbnailUrl || '').trim();
    return !!poster && !/placeholder|undefined|null/i.test(poster);
  }

  function showLoading() {
    const el = document.getElementById('browseLoading');
    if (el) el.style.display = 'flex';
    const endEl = document.getElementById('browseEnd');
    if (endEl) endEl.style.display = 'none';
  }

  function hideLoading() {
    const el = document.getElementById('browseLoading');
    if (el) el.style.display = 'none';
  }

  function showEnd() {
    const el = document.getElementById('browseEnd');
    if (el) el.style.display = 'block';
  }

  // ── Infinite Scroll ──────────────────────────────────────────────────────
  // Req 13.6 / 13.7 / 13.8 — observe the sentinel at the bottom of the grid
  // and trigger fetchPage() whenever it enters the viewport (with a 200px
  // pre-load buffer). The observer is torn down when there's no more data
  // to fetch, when filters reset the grid, or on page unload.
  function setupInfiniteScroll() {
    const sentinel = document.getElementById('browseGridSentinel');
    if (!sentinel || _observer) return;

    // Browsers without IntersectionObserver fall back to no-op infinite
    // scroll — the user can still load page 1 and tap retry/filter changes
    // re-fetch normally.
    if (typeof IntersectionObserver === 'undefined') return;

    _observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && _hasMore && !_isLoading) {
          fetchPage();
        }
      }
    }, {
      // 200px pre-load buffer above and below — Req 13.6 specifies "within
      // 200px of the bottom of the card grid".
      rootMargin: '200px 0px 200px 0px',
      threshold: 0,
    });

    _observer.observe(sentinel);
  }

  function teardownInfiniteScroll() {
    if (_observer) {
      _observer.disconnect();
      _observer = null;
    }
  }

  // Render an inline retry button below the grid when a mid-pagination
  // fetch fails. Tapping it removes the button and retries the same page.
  // We keep the styling inline (rather than in the page <style>) so the
  // button works even if the consuming page omits the .browse-retry-btn
  // styles.
  function showRetryButton() {
    const grid = document.getElementById('browseGrid');
    const sentinel = document.getElementById('browseGridSentinel');
    if (!grid || !sentinel || !sentinel.parentNode) return;

    // Avoid stacking — only one retry button at a time.
    const existing = document.getElementById('browseRetryBtn');
    if (existing) existing.remove();

    const btn = document.createElement('button');
    btn.id = 'browseRetryBtn';
    btn.type = 'button';
    btn.className = 'browse-retry-btn';
    btn.style.cssText = [
      'display:block',
      'margin:30px auto',
      'padding:14px 28px',
      'background:var(--accent, #e50914)',
      'color:#fff',
      'border:none',
      'border-radius:8px',
      'cursor:pointer',
      'font-size:14px',
      'font-weight:600',
    ].join(';');
    btn.textContent = 'Failed to load more. Tap to retry.';
    btn.addEventListener('click', () => {
      btn.remove();
      fetchPage();
    });

    // Insert just before the sentinel so the retry CTA sits visually below
    // the last card but above the loading/end markers.
    sentinel.parentNode.insertBefore(btn, sentinel);
  }

  // ── Filter Sidebar ───────────────────────────────────────────────────────
  // Task 13.4 / Requirements 14.1–14.8. The browse.html template ships with
  // empty containers (#filterGenreCheckboxes, #filterLanguageCheckboxes,
  // #filterStatusCheckboxes) and pre-defined inputs for Year, Rating, and
  // Sort By. This section populates the dynamic options, wires up apply /
  // clear buttons, mirrors the active filter set as removable pills, and
  // toggles the mobile drawer.

  // Common genre vocabulary surfaced as Genre checkboxes. Kept short and
  // human-friendly; any genre value that exists in the catalog but isn't
  // listed here is still reachable via the in-category search.
  const COMMON_GENRES = [
    'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Drama',
    'Family', 'Fantasy', 'Horror', 'Mystery', 'Romance', 'Sci-Fi',
    'Thriller', 'War', 'Western', 'Documentary', 'Music',
    'Slice of Life', 'Sports', 'Supernatural',
  ];

  // sessionStorage key for the mobile sidebar open/closed state. Scoped to
  // the browse page so it doesn't pollute other pages' storage namespace.
  const SIDEBAR_OPEN_KEY = 'cs_browse_sidebar_open';

  function populateGenreCheckboxes() {
    const container = document.getElementById('filterGenreCheckboxes');
    if (!container) return;
    container.innerHTML = COMMON_GENRES.map((g) => {
      const safe = escapeHtml(g);
      return `<label><input type="checkbox" value="${safe}"> ${safe}</label>`;
    }).join('');
  }

  // Pull all filter values from the form back into _filters. Search query
  // (`q`) and the subbed/dubbed toggle (`subDub`) are owned by Task 13.5,
  // so we preserve them rather than re-reading from this form.
  function readFiltersFromForm() {
    const next = {
      genre: [],
      yearMin: null,
      yearMax: null,
      ratingMin: null,
      ratingMax: null,
      language: [],
      status: [],
      sortBy: 'newest',
      q: _filters.q,
      subDub: _filters.subDub,
    };

    document
      .querySelectorAll('#filterGenreCheckboxes input[type="checkbox"]:checked')
      .forEach((cb) => next.genre.push(cb.value));

    const yMin = document.getElementById('filterYearMin')?.value;
    const yMax = document.getElementById('filterYearMax')?.value;
    if (yMin) next.yearMin = parseInt(yMin, 10);
    if (yMax) next.yearMax = parseInt(yMax, 10);

    const rMin = document.getElementById('filterRatingMin')?.value;
    const rMax = document.getElementById('filterRatingMax')?.value;
    if (rMin) next.ratingMin = parseFloat(rMin);
    if (rMax) next.ratingMax = parseFloat(rMax);

    document
      .querySelectorAll('#filterLanguageCheckboxes input[type="checkbox"]:checked')
      .forEach((cb) => next.language.push(cb.value));

    document
      .querySelectorAll('#filterStatusCheckboxes input[type="checkbox"]:checked')
      .forEach((cb) => next.status.push(cb.value));

    const sortBy = document.getElementById('filterSortBy')?.value;
    if (sortBy) next.sortBy = sortBy;

    Object.assign(_filters, next);
  }

  // Read form → re-fetch from page 1 → render pills. Closing the mobile
  // drawer afterwards keeps the result grid visible without an extra tap
  // (Requirement 14.6).
  function applyFilters() {
    readFiltersFromForm();
    renderActivePills();
    loadInitialPage();
    if (window.innerWidth < 1024) closeMobileSidebar();
  }

  // Reset every form control AND the underlying _filters state. We keep
  // `q` and `subDub` because they live in their own UI elements outside
  // the sidebar (Task 13.5 owns them).
  function clearAllFilters() {
    document
      .querySelectorAll('#filterGenreCheckboxes input[type="checkbox"]')
      .forEach((cb) => { cb.checked = false; });
    document
      .querySelectorAll('#filterLanguageCheckboxes input[type="checkbox"]')
      .forEach((cb) => { cb.checked = false; });
    document
      .querySelectorAll('#filterStatusCheckboxes input[type="checkbox"]')
      .forEach((cb) => { cb.checked = false; });

    const yMin = document.getElementById('filterYearMin');
    const yMax = document.getElementById('filterYearMax');
    const rMin = document.getElementById('filterRatingMin');
    const rMax = document.getElementById('filterRatingMax');
    const sortBy = document.getElementById('filterSortBy');
    if (yMin) yMin.value = '';
    if (yMax) yMax.value = '';
    if (rMin) rMin.value = '';
    if (rMax) rMax.value = '';
    if (sortBy) sortBy.value = 'newest';

    _filters.genre = [];
    _filters.yearMin = null;
    _filters.yearMax = null;
    _filters.ratingMin = null;
    _filters.ratingMax = null;
    _filters.language = [];
    _filters.status = [];
    _filters.sortBy = 'newest';

    renderActivePills();
    loadInitialPage();
  }

  // Build the active filter pill row above the grid. One pill per active
  // value plus a "Clear All" button on the right (Requirements 14.3–14.5).
  // Pills carry `data-key` and `data-value` attributes so removeFilter()
  // can identify which slice of state to update.
  function renderActivePills() {
    const container = document.getElementById('browseActivePills');
    if (!container) return;

    const pills = [];
    _filters.genre.forEach((g) => pills.push({ key: 'genre', value: g, label: `Genre: ${g}` }));
    if (_filters.yearMin !== null) pills.push({ key: 'yearMin', value: _filters.yearMin, label: `Year ≥ ${_filters.yearMin}` });
    if (_filters.yearMax !== null) pills.push({ key: 'yearMax', value: _filters.yearMax, label: `Year ≤ ${_filters.yearMax}` });
    if (_filters.ratingMin !== null) pills.push({ key: 'ratingMin', value: _filters.ratingMin, label: `Rating ≥ ${_filters.ratingMin}` });
    if (_filters.ratingMax !== null) pills.push({ key: 'ratingMax', value: _filters.ratingMax, label: `Rating ≤ ${_filters.ratingMax}` });
    _filters.language.forEach((l) => pills.push({ key: 'language', value: l, label: `Lang: ${l}` }));
    _filters.status.forEach((s) => pills.push({ key: 'status', value: s, label: `Status: ${s}` }));
    if (_filters.sortBy && _filters.sortBy !== 'newest') {
      pills.push({ key: 'sortBy', value: _filters.sortBy, label: `Sort: ${_filters.sortBy}` });
    }
    if (_filters.q) pills.push({ key: 'q', value: _filters.q, label: `Searching for: ${_filters.q}` });
    if (_filters.subDub) {
      pills.push({
        key: 'subDub',
        value: _filters.subDub,
        label: _filters.subDub === 'subbed' ? 'Subbed' : 'Dubbed',
      });
    }

    if (pills.length === 0) {
      container.innerHTML = '';
      return;
    }

    const pillsHtml = pills.map((p) => `
      <span class="pill" data-key="${escapeHtml(p.key)}" data-value="${escapeHtml(String(p.value))}">
        ${escapeHtml(p.label)}
        <button type="button" aria-label="Remove ${escapeHtml(p.label)}">×</button>
      </span>
    `).join('');

    container.innerHTML = `${pillsHtml}<button type="button" class="clear-all-btn">Clear All</button>`;

    container.querySelectorAll('.pill button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const pill = e.target.closest('.pill');
        if (!pill) return;
        removeFilter(pill.dataset.key, pill.dataset.value);
      });
    });
    container.querySelector('.clear-all-btn')?.addEventListener('click', clearAllFilters);
  }

  // Remove one filter slice (by key + value). For multi-value filters we
  // also uncheck the matching form input so the pill row and the sidebar
  // stay in sync. After mutating state we re-render pills and re-fetch.
  function removeFilter(key, value) {
    if (key === 'genre') {
      _filters.genre = _filters.genre.filter((g) => g !== value);
      const cb = document.querySelector(
        `#filterGenreCheckboxes input[value="${cssEscape(value)}"]`,
      );
      if (cb) cb.checked = false;
    } else if (key === 'language') {
      _filters.language = _filters.language.filter((l) => l !== value);
      const cb = document.querySelector(
        `#filterLanguageCheckboxes input[value="${cssEscape(value)}"]`,
      );
      if (cb) cb.checked = false;
    } else if (key === 'status') {
      _filters.status = _filters.status.filter((s) => s !== value);
      const cb = document.querySelector(
        `#filterStatusCheckboxes input[value="${cssEscape(value)}"]`,
      );
      if (cb) cb.checked = false;
    } else if (key === 'yearMin') {
      _filters.yearMin = null;
      const el = document.getElementById('filterYearMin');
      if (el) el.value = '';
    } else if (key === 'yearMax') {
      _filters.yearMax = null;
      const el = document.getElementById('filterYearMax');
      if (el) el.value = '';
    } else if (key === 'ratingMin') {
      _filters.ratingMin = null;
      const el = document.getElementById('filterRatingMin');
      if (el) el.value = '';
    } else if (key === 'ratingMax') {
      _filters.ratingMax = null;
      const el = document.getElementById('filterRatingMax');
      if (el) el.value = '';
    } else if (key === 'sortBy') {
      _filters.sortBy = 'newest';
      const el = document.getElementById('filterSortBy');
      if (el) el.value = 'newest';
    } else if (key === 'q') {
      _filters.q = '';
      const el = document.getElementById('browseSearch');
      if (el) el.value = '';
    } else if (key === 'subDub') {
      _filters.subDub = '';
      document
        .querySelectorAll('#browseSubDubToggle .subdub-btn')
        .forEach((b) => b.classList.remove('active'));
    }

    renderActivePills();
    loadInitialPage();
  }

  // Tiny attribute-selector escape so values containing quotes, spaces, or
  // special characters (e.g. "Sci-Fi") work as a CSS selector lookup. We
  // can't rely on CSS.escape across all target browsers without a fallback.
  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return String(value).replace(/(["\\])/g, '\\$1');
  }

  // ── Mobile sidebar drawer ────────────────────────────────────────────────
  // Below 1024px the sidebar is fixed and slides in from the right; it's
  // toggled by the "Filters" button in the search row. Open/closed state
  // is mirrored in sessionStorage so navigating back restores it
  // (Requirement 14.8).
  function openMobileSidebar() {
    const sidebar = document.getElementById('browseSidebar');
    const backdrop = document.getElementById('browseSidebarBackdrop');
    const toggle = document.getElementById('browseFiltersToggle');
    if (sidebar) sidebar.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
    try { sessionStorage.setItem(SIDEBAR_OPEN_KEY, '1'); } catch (_) { /* ignore */ }
  }

  function closeMobileSidebar() {
    const sidebar = document.getElementById('browseSidebar');
    const backdrop = document.getElementById('browseSidebarBackdrop');
    const toggle = document.getElementById('browseFiltersToggle');
    if (sidebar) sidebar.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
    try { sessionStorage.setItem(SIDEBAR_OPEN_KEY, '0'); } catch (_) { /* ignore */ }
  }

  function setupSidebarToggle() {
    const toggle = document.getElementById('browseFiltersToggle');
    const closeBtn = document.getElementById('sidebarClose');
    const backdrop = document.getElementById('browseSidebarBackdrop');

    toggle?.addEventListener('click', openMobileSidebar);
    closeBtn?.addEventListener('click', closeMobileSidebar);
    backdrop?.addEventListener('click', closeMobileSidebar);

    // Restore drawer state on mobile only — on desktop the sidebar is
    // permanently visible via CSS, so we don't need (or want) to re-open
    // anything.
    if (window.innerWidth < 1024) {
      try {
        if (sessionStorage.getItem(SIDEBAR_OPEN_KEY) === '1') openMobileSidebar();
      } catch (_) { /* ignore */ }
    }
  }

  function setupFilterEvents() {
    document.getElementById('applyFiltersBtn')?.addEventListener('click', applyFilters);
    document.getElementById('clearFiltersBtn')?.addEventListener('click', clearAllFilters);
  }

  // ── In-category search + Subbed/Dubbed toggle ────────────────────────────
  // Task 13.5 / Requirements 16.1–16.5, 17.1–17.5. Both surfaces share the
  // same flow: mutate `_filters`, refresh the active-pill row, and re-fetch
  // from page 1 via loadInitialPage(). The pill row picks up `q` and
  // `subDub` automatically because renderActivePills() already iterates
  // over them.

  // Req 17.2 specifies a 2-character minimum before searching. We reuse
  // the global `debounce()` helper from app.js (300 ms per the spec).
  // Falling back to a local implementation keeps browse.js usable if app.js
  // hasn't loaded yet (e.g. in tests).
  const SEARCH_MIN_CHARS = 2;
  const SEARCH_DEBOUNCE_MS = 300;

  const _debounce = (typeof window !== 'undefined' && typeof window.debounce === 'function')
    ? window.debounce
    : (typeof debounce === 'function' ? debounce : function _localDebounce(fn, ms) {
        let timer = null;
        return function debounced(...args) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => fn.apply(this, args), ms);
        };
      });

  function setupInCategorySearch() {
    const input = document.getElementById('browseSearch');
    if (!input) return;

    // Apply or clear the search filter and re-fetch. Centralised so the
    // debounced `input` handler and the synchronous Escape/clear paths
    // stay consistent.
    function applySearch(rawValue) {
      // Per Req 17.2 we treat fewer than 2 characters as "no search". A
      // viewer pressing one key shouldn't fire a request, but clearing the
      // box back to empty must still drop the existing query (Req 17.3).
      const trimmed = (rawValue || '').trim();
      const next = trimmed.length >= SEARCH_MIN_CHARS ? trimmed : '';

      if (next === _filters.q) return; // no-op when nothing changed

      _filters.q = next;
      renderActivePills();
      loadInitialPage();
    }

    const handleSearch = _debounce(() => {
      applySearch(input.value);
    }, SEARCH_DEBOUNCE_MS);

    input.addEventListener('input', handleSearch);

    // Escape clears the field and the active search filter immediately —
    // skipping the debounce so the grid snaps back to the previously
    // active filter set without a 300 ms delay (Req 17.3).
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && input.value) {
        input.value = '';
        if (_filters.q) {
          _filters.q = '';
          renderActivePills();
          loadInitialPage();
        }
      }
    });
  }

  function setupSubDubToggle() {
    const container = document.getElementById('browseSubDubToggle');
    if (!container) return;

    // The container is hidden by setupCategorySpecificUI() on non-anime
    // categories, so even though the click delegate is registered for
    // every browse page it can only fire on /browse/anime in practice
    // (Req 16.1).
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('.subdub-btn');
      if (!btn || !container.contains(btn)) return;

      const value = btn.dataset.subdub;
      if (!value) return;

      // Toggle behaviour: clicking the active button clears the filter
      // (so the viewer sees the unfiltered category again — matches the
      // "subDubTag is null/undefined" branch of Req 16.2). Clicking the
      // inactive button switches selection.
      if (_filters.subDub === value) {
        _filters.subDub = '';
        container.querySelectorAll('.subdub-btn').forEach((b) => b.classList.remove('active'));
      } else {
        _filters.subDub = value;
        container.querySelectorAll('.subdub-btn').forEach((b) => {
          b.classList.toggle('active', b.dataset.subdub === value);
        });
      }

      // Req 16.4 — re-fetch from page 1 with the updated filter; the pill
      // row reflects the new state (Req 16.5).
      renderActivePills();
      loadInitialPage();
    });
  }

  // ── Bootstrap ────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ── Public surface for tasks 13.3, 13.4, 13.5 ────────────────────────────
  // Subsequent browse-page tasks layer infinite scroll, the filter sidebar,
  // and in-category search on top of this module. They drive new fetches
  // by mutating `_filters` via setFilters() and calling loadInitialPage().
  window.BrowsePage = {
    _internal: {
      get state() {
        return {
          category: _category,
          // _currentPage is incremented after a successful fetch, so the
          // value reported here is the page that will be requested next.
          currentPage: _currentPage,
          hasMore: _hasMore,
          isLoading: _isLoading,
          items: _items,
          filters: _filters,
        };
      },
      get filters() {
        return _filters;
      },
      setFilters(updates) {
        if (updates && typeof updates === 'object') {
          Object.assign(_filters, updates);
        }
      },
      fetchPage,
      loadInitialPage,
      detectCategoryFromPath,
      setupInfiniteScroll,
      teardownInfiniteScroll,
      // Filter sidebar surface (Task 13.4) — exposed so Task 13.5
      // (in-category search + subbed/dubbed) can keep the pill row in
      // sync without re-implementing the rendering logic.
      renderActivePills,
      removeFilter,
      applyFilters,
      clearAllFilters,
      openMobileSidebar,
      closeMobileSidebar,
      // In-category search + Subbed/Dubbed toggle (Task 13.5).
      setupInCategorySearch,
      setupSubDubToggle,
    },
  };
})();
