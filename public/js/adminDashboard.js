(function () {

function unwrapResponse(payload) {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    return payload.data ?? null;
  }
  return payload;
}

function getResponseMessage(payload, fallback = 'Request failed') {
  if (payload && typeof payload === 'object') {
    return payload.error || payload.message || fallback;
  }
  return fallback;
}

function formatDurationSeconds(seconds) {
  try {
    const total = Math.max(0, parseInt(seconds, 10) || 0);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  } catch {
    return '00:00';
  }
}

function inferCategoryFromTitle(title = '') {
  try {
    const normalized = String(title).toLowerCase();
    if (!normalized) return '';
    if (/\b(episode|ep\.?|e\d{1,3}|s\d{1,2}e\d{1,3})\b/i.test(normalized)) {
      if (/\b(anime|ova|ona)\b/i.test(normalized)) return 'anime';
      return 'series';
    }
    return '';
  } catch {
    return '';
  }
}

const YOUTUBE_ID_REGEX = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|shorts\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i;

function extractYouTubeId(url = '') {
  const match = String(url || '').trim().match(YOUTUBE_ID_REGEX);
  return match ? match[1] : null;
}

function extractVimeoId(url = '') {
  const match = String(url || '').trim().match(/vimeo\.com\/(\d+)/i);
  return match ? match[1] : null;
}

function extractDailymotionId(url = '') {
  const match = String(url || '').trim().match(/(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([^_?&/]+)/i);
  return match ? match[1] : null;
}

function extractTmdbId(url = '') {
  const raw = String(url || '').trim();
  if (!raw) return null;

  const patterns = [
    /themoviedb\.org\/(?:movie|tv)\/(\d+)/i,
    /tmdb\.org\/(?:movie|tv)\/(\d+)/i,
    /(?:vidsrc|2embed|autoembed)[^?]*[\/=](\d{3,})/i,
    /(?:[?&](?:tmdb|id|tmdbId)=)(\d{3,})/i,
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

function buildProviderWatchUrl(type, id) {
  if (!id) return '';
  if (type === 'youtube') return `https://youtu.be/${id}`;
  if (type === 'dailymotion') return `https://dai.ly/${id}`;
  if (type === 'vimeo') return `https://vimeo.com/${id}`;
  return '';
}

function buildMovieExternalSources() {
  const youtubeInputValue = document.getElementById('youtubeUrl')?.value.trim() || '';
  const dailymotionInputValue = document.getElementById('dailymotionUrl')?.value.trim() || '';
  const vimeoInputValue = document.getElementById('vimeoUrl')?.value.trim() || '';
  const tmdbMetadataUrl = [youtubeInputValue, dailymotionInputValue, vimeoInputValue]
    .find((value) => extractTmdbId(value)) || '';

  const yt = extractYouTubeId(youtubeInputValue);
  const dm = extractDailymotionId(dailymotionInputValue);
  const vm = extractVimeoId(vimeoInputValue);

  const errors = [];
  if (!yt && youtubeInputValue && !extractTmdbId(youtubeInputValue)) errors.push('Invalid YouTube URL');
  if (!dm && dailymotionInputValue && !extractTmdbId(dailymotionInputValue)) errors.push('Invalid Dailymotion URL');
  if (!vm && vimeoInputValue && !extractTmdbId(vimeoInputValue)) errors.push('Invalid Vimeo URL');

  const seen = new Set();
  const sources = [];
  const appendSource = (type, id) => {
    const normalizedId = String(id || '').trim();
    if (!normalizedId) return;

    const dedupeKey = `${type}:${normalizedId}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    sources.push({
      type,
      id: normalizedId,
      path: '',
      url: buildProviderWatchUrl(type, normalizedId),
      server: type,
      sourceType: type,
      quality: 'HD',
    });
  };

  appendSource('dailymotion', dm);
  appendSource('youtube', yt);
  appendSource('vimeo', vm);

  return { sources, errors, metadataUrl: tmdbMetadataUrl };
}

function syncMovieExternalSourceState() {
  const hiddenUrlInput = document.getElementById('videoUrlInput');
  const sourceTypeInput = document.getElementById('movieSourceType');
  const hint = document.getElementById('movieMetadataHint');
  const { sources, errors, metadataUrl } = buildMovieExternalSources();
  const primary = sources[0] || null;

  if (hiddenUrlInput) hiddenUrlInput.value = primary?.url || metadataUrl || '';
  if (sourceTypeInput) sourceTypeInput.value = primary?.sourceType || 'local';

  if (hint && !primary && !errors.length) {
    hint.textContent = 'Paste provider URLs to build fallback sources and auto-fill available metadata.';
  }

  return { sources, errors, primary };
}

function getVideoIdFromUrl(url = '', sourceType = '') {
  try {
    const type = window.getSourceType?.(url, sourceType) || sourceType || 'local';
    if (type === 'youtube') return extractYouTubeId(url) || '';
    if (type === 'dailymotion') return extractDailymotionId(url) || '';
    if (type === 'vimeo') return extractVimeoId(url) || '';
    return '';
  } catch {
    return '';
  }
}

function setPosterPreview(kind, thumbnailUrl = '', label = 'Poster preview ready') {
  try {
    const wrap = document.getElementById(`${kind}PosterPreview`);
    const img = document.getElementById(`${kind}PosterPreviewImg`);
    const text = document.getElementById(`${kind}PosterPreviewLabel`);
    if (!wrap || !img || !text) return;

    if (!thumbnailUrl) {
      wrap.style.display = 'none';
      img.removeAttribute('src');
      return;
    }

    img.src = thumbnailUrl;
    text.textContent = label;
    wrap.style.display = 'flex';
  } catch (error) {
    console.warn('Poster preview failed:', error.message);
  }
}

async function fetchMediaMetadata(url) {
  try {
    const sourceType = window.getSourceType?.(url) || 'local';
    const videoId = getVideoIdFromUrl(url, sourceType);
    const tmdbId = extractTmdbId(url);

    if (tmdbId) {
      const response = await apiFetch(`/tmdb/details/${tmdbId}?type=movie`, { silent: true });
      const payload = await readJsonResponse(response);
      const details = payload?.details;
      if (!details?.id) {
        return null;
      }

      return {
        sourceType: 'tmdb',
        videoId: String(details.id),
        title: details.title || details.name || '',
        description: details.overview || '',
        durationSeconds: (parseInt(details.runtime, 10) || 0) * 60,
        durationLabel: formatDurationSeconds((parseInt(details.runtime, 10) || 0) * 60),
        thumbnailUrl: details.poster_path ? `https://image.tmdb.org/t/p/w500${details.poster_path}` : '',
        thumbnailFallbackUrl: details.backdrop_path ? `https://image.tmdb.org/t/p/w780${details.backdrop_path}` : '',
      };
    }

    if (!videoId || (sourceType !== 'youtube' && sourceType !== 'dailymotion')) {
      return null;
    }

    if (sourceType === 'youtube') {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(oembedUrl);
      if (!response.ok) throw new Error('Metadata unavailable');
      const payload = await response.json();
      const maxres = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;
      const fallback = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

      return {
        sourceType,
        videoId,
        title: payload.title || '',
        durationSeconds: 0,
        durationLabel: '00:00',
        thumbnailUrl: maxres,
        thumbnailFallbackUrl: fallback,
      };
    }

    if (sourceType === 'dailymotion') {
      const response = await fetch(`https://api.dailymotion.com/video/${videoId}?fields=title,duration,thumbnail_720_url`);
      if (!response.ok) throw new Error('Metadata unavailable');
      const payload = await response.json();

      return {
        sourceType,
        videoId,
        title: payload.title || '',
        durationSeconds: parseInt(payload.duration, 10) || 0,
        durationLabel: formatDurationSeconds(payload.duration),
        thumbnailUrl: payload.thumbnail_720_url || '',
        thumbnailFallbackUrl: payload.thumbnail_720_url || '',
      };
    }

    return null;
  } catch (error) {
    console.warn('fetchMediaMetadata failed:', error.message);
    throw error;
  }
}

async function handleMetadataIngestion(kind) {
  try {
    const input = document.getElementById(kind === 'movie' ? 'videoUrlInput' : 'episodeUrlInput');
    const spinner = document.getElementById(kind === 'movie' ? 'movieMetadataSpinner' : 'episodeMetadataSpinner');
    const hint = document.getElementById(kind === 'movie' ? 'movieMetadataHint' : 'episodeMetadataHint');
    const sourceTypeInput = document.getElementById(kind === 'movie' ? 'movieSourceType' : 'episodeSourceType');
    const thumbnailInput = document.getElementById(kind === 'movie' ? 'movieThumbnailUrl' : 'episodeThumbnailUrl');
    if (!input || !spinner || !hint || !sourceTypeInput || !thumbnailInput) return;

    const url = input.value.trim();
    if (!url) {
      sourceTypeInput.value = 'local';
      thumbnailInput.value = '';
      setPosterPreview(kind, '');
      hint.textContent = kind === 'movie'
        ? 'Paste provider URLs to build fallback sources and auto-fill available metadata.'
        : 'Paste a provider URL to auto-fill episode metadata and thumbnail.';
      return;
    }

    spinner.style.display = 'block';
    hint.textContent = 'Fetching metadata...';

    const metadata = await fetchMediaMetadata(url);
    if (!metadata) {
      sourceTypeInput.value = 'local';
      thumbnailInput.value = '';
      setPosterPreview(kind, '');
      hint.textContent = 'Metadata unavailable. You can still fill the form manually.';
      showToast('Metadata unavailable', 'warning');
      return;
    }

    sourceTypeInput.value = metadata.sourceType;
    thumbnailInput.value = metadata.thumbnailUrl || metadata.thumbnailFallbackUrl || '';

    const form = input.closest('form');
    const titleInput = form?.querySelector('input[name="title"]');
    const descriptionInput = form?.querySelector('textarea[name="description"]');
    const durationInput = form?.querySelector('input[name="duration"]');
    const categorySelect = form?.querySelector('select[name="category"]');

    if (titleInput && !titleInput.value.trim() && metadata.title) {
      titleInput.value = metadata.title;
    }

    if (durationInput && metadata.durationSeconds > 0) {
      durationInput.value = Math.max(1, Math.ceil(metadata.durationSeconds / 60));
    }

    if (descriptionInput && !descriptionInput.value.trim() && metadata.description) {
      descriptionInput.value = metadata.description;
    }

    if (categorySelect && !categorySelect.value) {
      const smartCategory = inferCategoryFromTitle(metadata.title);
      if (smartCategory) categorySelect.value = smartCategory;
    }

    setPosterPreview(kind, metadata.thumbnailUrl || metadata.thumbnailFallbackUrl, `${metadata.sourceType.toUpperCase()} preview ready`);
    hint.textContent = metadata.durationSeconds > 0
      ? `Detected ${metadata.sourceType.toUpperCase()} source - ${metadata.durationLabel}`
      : `Detected ${metadata.sourceType.toUpperCase()} source - duration unavailable`;
  } catch (error) {
    const hint = document.getElementById(kind === 'movie' ? 'movieMetadataHint' : 'episodeMetadataHint');
    if (hint) hint.textContent = 'Metadata unavailable. You can still fill the form manually.';
    showToast('Metadata unavailable', 'warning');
  } finally {
    const spinner = document.getElementById(kind === 'movie' ? 'movieMetadataSpinner' : 'episodeMetadataSpinner');
    if (spinner) spinner.style.display = 'none';
  }
}

function bindMetadataInput(kind) {
  try {
    const input = document.getElementById(kind === 'movie' ? 'videoUrlInput' : 'episodeUrlInput');
    if (!input) return;

    const debounced = debounce(() => {
      handleMetadataIngestion(kind).catch(() => {});
    }, 450);

    input.addEventListener('input', debounced);
    input.addEventListener('paste', () => {
      setTimeout(() => {
        handleMetadataIngestion(kind).catch(() => {});
      }, 0);
    });
    input.addEventListener('blur', () => {
      handleMetadataIngestion(kind).catch(() => {});
    });
  } catch (error) {
    console.warn('bindMetadataInput failed:', error.message);
  }
}

function bindMovieSourceInputs() {
  try {
    const inputIds = ['youtubeUrl', 'dailymotionUrl', 'vimeoUrl'];
    const debounced = debounce(() => {
      syncMovieExternalSourceState();
      handleMetadataIngestion('movie').catch(() => {});
    }, 450);

    inputIds.forEach((id) => {
      const input = document.getElementById(id);
      if (!input) return;
      input.addEventListener('input', debounced);
      input.addEventListener('paste', () => {
        setTimeout(() => {
          syncMovieExternalSourceState();
          handleMetadataIngestion('movie').catch(() => {});
        }, 0);
      });
      input.addEventListener('blur', () => {
        syncMovieExternalSourceState();
        handleMetadataIngestion('movie').catch(() => {});
      });
    });

    syncMovieExternalSourceState();
  } catch (error) {
    console.warn('bindMovieSourceInputs failed:', error.message);
  }
}

  async function uploadQuality(quality) {
  const inputMap = { '360p': 'q360Input', '720p': 'q720Input', '1080p': 'q1080Input' };
  const file   = document.getElementById(inputMap[quality])?.files[0];
  const movieId= document.getElementById('editMovieId')?.value;
  const status = document.getElementById('qualityUploadStatus');

  if (!file)    { showToast('Select a file first', 'error'); return; }
  if (!movieId) { showToast('Save the movie first', 'error'); return; }

  status.textContent = `Uploading ${quality}...`;
  const formData = new FormData();
  formData.append('video',   file);
  formData.append('quality', quality);

  try {
    const res  = await apiFetch(`/movies/${movieId}/quality`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
      body:    formData,
    });
    const data = await readJsonResponse(res);
    if (res.ok) {
      status.textContent = `âœ… ${quality} uploaded successfully!`;
      status.style.color = '#34d399';
      showToast(`${quality} quality uploaded!`, 'success');
    } else {
      status.textContent = `âŒ ${data.message}`;
      status.style.color = 'var(--accent)';
    }
  } catch (e) {
    status.textContent = 'âŒ Upload failed';
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// INIT
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
window.addEventListener('DOMContentLoaded', () => { initAdminDashboard(); });
window.addEventListener('admin-authenticated', () => { initAdminDashboard(); });

async function initAdminDashboard() {
  const token = localStorage.getItem('token');
  let user = JSON.parse(localStorage.getItem('user') || 'null');

  // If no token, do nothing — the admin login gate in admin.html handles this
  if (!token) return;

  if (!user || user.role !== 'admin') {
    try {
      const res = await apiFetch('/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await res.json();
      const me = unwrapResponse(payload)?.user || payload?.user || unwrapResponse(payload);
      if (!res.ok || !payload.success || !me || me.role !== 'admin') {
        throw new Error('ADMIN_SESSION_INVALID');
      }
      user = me;
      localStorage.setItem('user', JSON.stringify(user));
    } catch {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      return;
    }
  }

  // All event listeners in one place
  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.reload();
  });

  document.getElementById('resetMovieBtn').addEventListener('click', resetMovieForm);
  document.getElementById('resetEpisodeBtn').addEventListener('click', resetEpisodeForm);
  document.getElementById('videoInput').addEventListener('change', onVideoChange);
  document.getElementById('thumbnailInput').addEventListener('change', onThumbnailChange);
  document.getElementById('epVideoInput').addEventListener('change', onEpVideoChange);
  document.getElementById('uploadForm').addEventListener('submit', submitMovie);
  document.getElementById('episodeForm').addEventListener('submit', submitEpisode);
  bindMetadataInput('movie');
  bindMetadataInput('episode');
  bindMovieSourceInputs();

  // Subtitle events
  document.getElementById('subtitleMovieSelect').addEventListener('change', loadExistingSubtitles);
  document.getElementById('uploadSubBtn').addEventListener('click', uploadSubtitle);

  // Edit modal events
  document.getElementById('closeEditModal').addEventListener('click',  () => toggleEditModal(false));
  document.getElementById('closeEditModal2').addEventListener('click', () => toggleEditModal(false));
  document.getElementById('editForm').addEventListener('submit', saveEdit);
  document.getElementById('closeSourceModal')?.addEventListener('click', () => toggleSourceModal(false));
  document.getElementById('closeSourceModal2')?.addEventListener('click', () => toggleSourceModal(false));
  document.getElementById('sourceForm')?.addEventListener('submit', submitSourceForm);
  document.querySelectorAll('[data-admin-panel-btn]').forEach((button) => {
    button.addEventListener('click', () => toggleAdminPanel(button.dataset.adminPanelBtn));
  });
  document.querySelectorAll('.quality-upload-btn').forEach((button) => {
    button.addEventListener('click', () => uploadQuality(button.dataset.quality));
  });

  // Event delegation on document â€” prevents listener stacking every time list reloads
  document.addEventListener('click', (e) => {
    const delBtn  = e.target.closest('.delete-movie-btn');
    const editBtn = e.target.closest('.edit-movie-btn');
    const sourceBtn = e.target.closest('.manage-sources-btn');
    const deleteModalSourceBtn = e.target.closest('.delete-modal-source-btn');
    if (delBtn)  deleteMovie(delBtn.dataset.id, delBtn.dataset.title);
    if (editBtn) openEditModal(editBtn.dataset.id);
    if (sourceBtn) openSourceModal(sourceBtn.dataset.id, sourceBtn.dataset.title);
    if (deleteModalSourceBtn) handleDeleteModalSource(deleteModalSourceBtn);
  });
  document.getElementById('brokenSourcesList')?.addEventListener('click', onBrokenSourceAction);

  // Drag-and-drop for file drops
  setupFileDrop('videoDrop',     'videoInput');
  setupFileDrop('thumbnailDrop', 'thumbnailInput');
  setupFileDrop('bannerDrop',    'bannerInput');
  setupFileDrop('epVideoDrop',   'epVideoInput');
  setupFileDrop('epThumbDrop',   'epThumbInput');
  setupFileDrop('subFileDrop',   'subFile');

  loadStats();
  loadMoviesList();
  loadSeriesList();
  toggleAdminPanel('contentOps');
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DRAG AND DROP
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function setupFileDrop(dropId, inputId) {
  const drop  = document.getElementById(dropId);
  const input = document.getElementById(inputId);
  if (!drop || !input) return;

  ['dragenter','dragover'].forEach(evt => {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.style.borderColor = 'var(--accent)';
      drop.style.background  = 'rgba(229,9,20,0.05)';
    });
  });

  ['dragleave','drop'].forEach(evt => {
    drop.addEventListener(evt, (e) => {
      e.preventDefault();
      drop.style.borderColor = '';
      drop.style.background  = '';
    });
  });

  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  });
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// STATS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadStats() {
  try {
    const [allPayload, animePayload, seriesPayload] = await Promise.all([
      apiFetch('/movies?limit=1000', { silent: true }).then(readJsonResponse),
      apiFetch('/movies?category=anime&limit=1', { silent: true }).then(readJsonResponse),
      apiFetch('/movies?category=series&limit=1', { silent: true }).then(readJsonResponse),
    ]);
    const all = allPayload || {};
    const anime = animePayload || {};
    const series = seriesPayload || {};

    document.getElementById('totalMovies').textContent =
      all.pagination?.total || 0;
    document.getElementById('totalAnime').textContent  =
      anime.pagination?.total || 0;
    document.getElementById('totalSeries').textContent =
      series.pagination?.total || 0;

    const totalViews = (all.movies || []).reduce(
      (sum, m) => sum + (m.views || 0), 0
    );
    document.getElementById('totalViews').textContent =
      totalViews >= 1_000_000 ? (totalViews / 1_000_000).toFixed(1) + 'M'
      : totalViews >= 1000    ? (totalViews / 1000).toFixed(1) + 'K'
      : totalViews;

  } catch(e) { console.error('Stats error:', e); }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// FILE PREVIEWS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function onVideoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('videoFileName').textContent =
    file.name.length > 40 ? file.name.substring(0, 40) + '...' : file.name;
  document.getElementById('videoFileSize').textContent =
    (file.size / (1024 * 1024)).toFixed(1) + ' MB';
  document.getElementById('videoPreview').style.display = 'flex';
}

function onThumbnailChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('thumbnailFileName').textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    document.getElementById('thumbnailImg').src = ev.target.result;
  };
  reader.readAsDataURL(file);
  document.getElementById('thumbnailPreview').style.display = 'flex';
}

function onEpVideoChange(e) {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('epVideoName').textContent =
    file.name.length > 40 ? file.name.substring(0, 40) + '...' : file.name;
  document.getElementById('epVideoSize').textContent =
    (file.size / (1024 * 1024)).toFixed(1) + ' MB';
  document.getElementById('epVideoPreview').style.display = 'flex';
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UPLOAD MOVIE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function submitMovie(e) {
  e.preventDefault();
  const token     = localStorage.getItem('token');
  const uploadBtn = document.getElementById('uploadBtn');
  const progress  = document.getElementById('uploadProgress');
  const fill      = document.getElementById('progressFill');
  const text      = document.getElementById('progressText');
  const alertBox  = document.getElementById('uploadAlert');

  const genres = [...document.querySelectorAll('input[name="genre"]:checked')]
    .map(cb => cb.value);
  const { sources, errors, primary } = syncMovieExternalSourceState();
  const externalUrl = primary?.url || '';
  const sourceType = primary?.sourceType || 'local';
  const hasExternal = sources.length > 0;
  const videoFile = document.getElementById('videoInput')?.files[0];
  const thumbnailFile = document.getElementById('thumbnailInput')?.files[0];
  const thumbnailUrl = document.getElementById('movieThumbnailUrl')?.value || '';

  if (genres.length === 0) {
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> Please select at least one genre
      </div>`;
    alertBox.style.display = 'block';
    return;
  }

  if (errors.length > 0) {
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> ${errors[0]}
      </div>`;
    alertBox.style.display = 'block';
    return;
  }

  if (!videoFile && !hasExternal) {
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> Upload a video file or add at least one provider URL
      </div>`;
    alertBox.style.display = 'block';
    return;
  }

  if (!thumbnailFile && !thumbnailUrl) {
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> Upload a thumbnail or use metadata from an external URL
      </div>`;
    alertBox.style.display = 'block';
    return;
  }

  const formData = new FormData(this);

  // Remove auto-collected genre entries and re-add properly
  formData.delete('genre');
  genres.forEach(g => formData.append('genre', g));

  // isFeatured â€” set explicitly as string 'true'/'false'
  formData.delete('isFeatured');
  formData.append('isFeatured', document.getElementById('isFeatured').checked ? 'true' : 'false');
  formData.set('sourceType', hasExternal ? sourceType : 'local');
  formData.set('videoUrl', hasExternal ? externalUrl : '');
  formData.set('sources', JSON.stringify(sources));
  if (thumbnailUrl) {
    formData.set('thumbnailUrl', thumbnailUrl);
  }

  uploadBtn.innerHTML = '<i class="ri-loader-4-line"></i> Uploading...';
  uploadBtn.disabled  = true;
  progress.classList.add('visible');
  alertBox.style.display = 'none';

  let fakeP = 0;
  const interval = setInterval(() => {
    fakeP = Math.min(fakeP + Math.random() * 8, 90);
    fill.style.width = fakeP + '%';
    text.textContent = `Uploading... ${Math.round(fakeP)}%`;
  }, 500);

  try {
    const res  = await apiFetch('/movies', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    formData,
    });
    clearInterval(interval);
    fill.style.width = '100%';
    text.textContent = 'Upload complete!';
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};

    if (res.ok && payload.success) {
      alertBox.innerHTML = `
        <div class="alert alert-success">
          <i class="ri-checkbox-circle-line"></i>
          "${escapeHtml(data.movie.title)}" uploaded successfully!
          <a href="movie-details.html?id=${data.movie._id}"
             style="color:#34d399;margin-left:8px;">View â†’</a>
        </div>`;
      alertBox.style.display = 'block';
      resetMovieForm();
      loadMoviesList();
      loadStats();
      loadSeriesList();
      loadSubtitleMovieSelect();
    } else {
      alertBox.innerHTML = `
        <div class="alert alert-error">
          <i class="ri-error-warning-line"></i> ${escapeHtml(getResponseMessage(payload))}
        </div>`;
      alertBox.style.display = 'block';
    }
  } catch(error) {
    clearInterval(interval);
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> ${escapeHtml(error.message)}
      </div>`;
    alertBox.style.display = 'block';
  }

  uploadBtn.innerHTML = '<i class="ri-upload-cloud-line"></i> Upload Movie';
  uploadBtn.disabled  = false;
  setTimeout(() => {
    progress.classList.remove('visible');
    fill.style.width = '0%';
  }, 2000);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// LOAD SERIES DROPDOWN
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadSeriesList() {
  try {
    const res  = await apiFetch('/movies?limit=200', { silent: true });
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};
    const all  = data.movies || [];
    const sel  = document.getElementById('seriesSelect');

    if (all.length === 0) {
      sel.innerHTML = '<option value="">No content â€” upload something first!</option>';
      return;
    }

    sel.innerHTML = buildGroupedOptions(all);
  } catch(e) {
    console.error('Failed to load series list:', e);
  }
}

async function loadSubtitleMovieSelect() {
  try {
    const res  = await apiFetch('/movies?limit=200', { silent: true });
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};
    const all  = data.movies || [];
    const sel  = document.getElementById('subtitleMovieSelect');
    if (all.length === 0) {
      sel.innerHTML = '<option value="">No content â€” upload something first!</option>';
      return;
    }
    sel.innerHTML = buildGroupedOptions(all);
  } catch(e) { console.error('Subtitle select error:', e); }
}

function buildGroupedOptions(movies) {
  const emoji = {
    movie:'ðŸŽ¬', anime:'âš¡', series:'ðŸ“º',
    cartoon:'ðŸŽ¨', documentary:'ðŸŒ', short:'ðŸŽžï¸',
  };
  const grouped = {};
  movies.forEach(m => {
    if (!grouped[m.category]) grouped[m.category] = [];
    grouped[m.category].push(m);
  });
  let html = '<option value="">-- Select Content --</option>';
  Object.keys(grouped).sort().forEach(cat => {
    html += `<optgroup label="${emoji[cat] || 'ðŸŽ¬'} ${cat.toUpperCase()}">`;
    grouped[cat].forEach(m => {
      html += `<option value="${m._id}">${m.title}</option>`;
    });
    html += '</optgroup>';
  });
  return html;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// UPLOAD EPISODE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function submitEpisode(e) {
  e.preventDefault();
  const token    = localStorage.getItem('token');
  const btn      = document.getElementById('epUploadBtn');
  const progress = document.getElementById('epUploadProgress');
  const fill     = document.getElementById('epProgressFill');
  const text     = document.getElementById('epProgressText');
  const alertBox = document.getElementById('episodeAlert');
  const externalUrl = document.getElementById('episodeUrlInput')?.value.trim() || '';
  const sourceType = document.getElementById('episodeSourceType')?.value || 'local';
  const hasExternal = !!externalUrl && sourceType !== 'local';
  const videoFile = document.getElementById('epVideoInput')?.files[0];
  const thumbnailUrl = document.getElementById('episodeThumbnailUrl')?.value || '';

  if (!videoFile && !hasExternal) {
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> Upload an episode file or paste a YouTube/Dailymotion URL
      </div>`;
    alertBox.style.display = 'block';
    return;
  }

  btn.innerHTML = '<i class="ri-loader-4-line"></i> Uploading...';
  btn.disabled  = true;
  progress.classList.add('visible');
  alertBox.style.display = 'none';

  let fakeP = 0;
  const interval = setInterval(() => {
    fakeP = Math.min(fakeP + Math.random() * 10, 90);
    fill.style.width = fakeP + '%';
    text.textContent = `Uploading... ${Math.round(fakeP)}%`;
  }, 400);

  try {
    const formData = new FormData(e.target);
    formData.set('sourceType', hasExternal ? sourceType : 'local');
    if (hasExternal) {
      formData.set('videoUrl', externalUrl);
    }
    if (thumbnailUrl) {
      formData.set('thumbnailUrl', thumbnailUrl);
    }
    const res  = await apiFetch('/episodes', {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    formData,
    });
    clearInterval(interval);
    fill.style.width = '100%';
    text.textContent = 'Upload complete!';
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};

    if (res.ok && payload.success) {
      alertBox.innerHTML = `
        <div class="alert alert-success">
          <i class="ri-checkbox-circle-line"></i>
          S${data.episode.season}E${data.episode.episodeNumber}:
          "${data.episode.title}" uploaded!
          <a href="episode.html?id=${data.episode._id}"
             style="color:#34d399;margin-left:8px;">Watch â†’</a>
        </div>`;
      alertBox.style.display = 'block';
      resetEpisodeForm();
      loadSeriesList();
    } else {
      alertBox.innerHTML = `
        <div class="alert alert-error">
          <i class="ri-error-warning-line"></i> ${escapeHtml(getResponseMessage(payload))}
        </div>`;
      alertBox.style.display = 'block';
    }
  } catch(error) {
    clearInterval(interval);
    alertBox.innerHTML = `
      <div class="alert alert-error">
        <i class="ri-error-warning-line"></i> ${escapeHtml(error.message)}
      </div>`;
    alertBox.style.display = 'block';
  }

  btn.innerHTML = '<i class="ri-upload-cloud-line"></i> Upload Episode';
  btn.disabled  = false;
  setTimeout(() => {
    progress.classList.remove('visible');
    fill.style.width = '0%';
  }, 2000);
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// SUBTITLE UPLOAD
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadExistingSubtitles() {
  const movieId   = document.getElementById('subtitleMovieSelect').value;
  const container = document.getElementById('existingSubtitles');
  if (!movieId) { container.innerHTML = ''; return; }

  try {
    const token = localStorage.getItem('token');
    const res   = await apiFetch(`/movies/${movieId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};

    if (!data.subtitles || data.subtitles.length === 0) {
      container.innerHTML =
        '<p style="color:var(--text-muted);font-size:13px;">No subtitles yet.</p>';
      return;
    }

    container.innerHTML = `
      <div style="background:var(--bg-card);border-radius:8px;padding:12px;margin-bottom:12px;">
        <p style="font-size:12px;color:var(--text-muted);margin-bottom:8px;">Existing subtitles:</p>
        ${data.subtitles.map(s => `
          <div style="display:flex;align-items:center;gap:10px;padding:6px 0;
                      border-bottom:1px solid var(--border);">
            <span style="font-size:13px;">${s.label} (${s.language})</span>
            ${s.default ? '<span style="color:#34d399;font-size:11px;font-weight:600;">DEFAULT</span>' : ''}
            <button data-movie="${movieId}" data-sub="${s._id}"
                    class="delete-sub-btn"
                    style="margin-left:auto;background:rgba(229,9,20,0.1);color:var(--accent);
                           border:1px solid rgba(229,9,20,0.3);padding:3px 10px;
                           border-radius:4px;font-size:11px;cursor:pointer;">
              Remove
            </button>
          </div>`).join('')}
      </div>`;

    container.querySelectorAll('.delete-sub-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        deleteSubtitle(btn.dataset.movie, btn.dataset.sub));
    });

  } catch(e) {
    console.error('Load subtitles error:', e);
  }
}

async function uploadSubtitle() {
  const movieId   = document.getElementById('subtitleMovieSelect').value;
  const file      = document.getElementById('subFile').files[0];
  const language  = document.getElementById('subLanguage').value;
  const label     = document.getElementById('subLabel').value || language;
  const isDefault = document.getElementById('subDefault').checked;
  const alertBox  = document.getElementById('subtitleAlert');
  const btn       = document.getElementById('uploadSubBtn');

  if (!movieId) {
    showAlert(alertBox, 'error', 'Please select a movie first');
    return;
  }
  if (!file) {
    showAlert(alertBox, 'error', 'Please select a .vtt or .srt file');
    return;
  }

  // Auto-convert .srt to .vtt
  let uploadFile = file;
  if (file.name.endsWith('.srt')) {
    const text    = await file.text();
    const vttText = 'WEBVTT\n\n' + text
      .replace(/\r/g, '')
      .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
    uploadFile = new File([vttText],
      file.name.replace('.srt', '.vtt'), { type: 'text/vtt' });
  }

  const formData = new FormData();
  formData.append('subtitle',  uploadFile);
  formData.append('language',  language);
  formData.append('label',     label);
  formData.append('isDefault', isDefault.toString());

  btn.innerHTML = '<i class="ri-loader-4-line"></i> Uploading...';
  btn.disabled  = true;

  try {
    const token = localStorage.getItem('token');
    const res   = await apiFetch(`/movies/${movieId}/subtitles`, {
      method:  'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body:    formData,
    });
    const payload = await res.json();
    if (res.ok && payload.success) {
      showAlert(alertBox, 'success', `Subtitle "${label}" uploaded!`);
      document.getElementById('subFile').value   = '';
      document.getElementById('subLabel').value  = '';
      document.getElementById('subDefault').checked = false;
      loadExistingSubtitles();
    } else {
      showAlert(alertBox, 'error', getResponseMessage(payload));
    }
  } catch(e) {
    showAlert(alertBox, 'error', e.message);
  }

  btn.innerHTML = '<i class="ri-upload-cloud-line"></i> Upload Subtitle';
  btn.disabled  = false;
}

async function deleteSubtitle(movieId, subId) {
  if (!confirm('Remove this subtitle?')) return;
  try {
    const token = localStorage.getItem('token');
    const res   = await apiFetch(`/movies/${movieId}/subtitles/${subId}`, {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) {
      showToast('Subtitle removed', 'success');
      loadExistingSubtitles();
    }
  } catch(e) {
    showToast('Delete failed', 'error');
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// MOVIES LIST
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function loadMoviesList() {
  const listDiv = document.getElementById('moviesList');
  try {
    const res    = await apiFetch('/movies?limit=100', { silent: true });
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};
    const movies = data.movies || [];

    if (movies.length === 0) {
      listDiv.innerHTML =
        '<p style="color:var(--text-muted);">No content uploaded yet.</p>';
      return;
    }

    // thumbnailUrl helper â€” handles both Cloudinary and local paths safely
    const thumbSrc = (url) => {
      if (!url) return '';
      if (url.startsWith('http')) return url;
      const base = (typeof MEDIA_BASE !== 'undefined') ? MEDIA_BASE : '';
      return base + url;
    };

    listDiv.innerHTML = `
      <div style="display:grid;gap:12px;">
        ${movies.map(movie => `
          <div class="card" style="padding:16px;display:flex;align-items:center;gap:16px;">
            <img src="${thumbSrc(movie.thumbnailUrl)}"
                 style="width:60px;height:80px;object-fit:cover;
                        border-radius:6px;background:var(--bg-card);"
                 data-hide-on-error="true">
            <div style="flex:1;min-width:0;">
              <div style="font-weight:600;margin-bottom:4px;
                          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${movie.title}
              </div>
              <div style="font-size:12px;color:var(--text-muted);">
                ${movie.category} â€¢ ${movie.releaseYear} â€¢
                ${movie.duration} min â€¢
                ${(movie.views || 0).toLocaleString()} views
              </div>
            </div>
            <div style="display:flex;gap:8px;flex-shrink:0;">
              <a href="movie-details.html?id=${movie._id}"
                 class="btn btn-outline"
                 style="padding:6px 12px;font-size:12px;">
                <i class="ri-eye-line"></i>
              </a>
              <button class="btn btn-outline edit-movie-btn"
                      data-id="${movie._id}"
                      style="padding:6px 12px;font-size:12px;">
                <i class="ri-edit-line"></i>
              </button>
              <button class="btn btn-outline manage-sources-btn"
                      data-id="${movie._id}"
                      data-title="${escapeHtml((movie.title || '').replace(/"/g, '&quot;'))}"
                      style="padding:6px 12px;font-size:12px;">
                <i class="ri-links-line"></i>
              </button>
              <button class="btn btn-danger delete-movie-btn"
                      data-id="${movie._id}"
                      data-title="${(movie.title || '').replace(/"/g, '&quot;')}"
                      style="padding:6px 12px;font-size:12px;">
                <i class="ri-delete-bin-line"></i>
              </button>
            </div>
          </div>`).join('')}
      </div>`;
    listDiv.querySelectorAll('img[data-hide-on-error="true"]').forEach((img) => {
      if (img.dataset.bound === 'true') return;
      img.dataset.bound = 'true';
      img.addEventListener('error', () => {
        img.style.display = 'none';
      });
    });

  } catch(e) {
    listDiv.innerHTML =
      '<p style="color:var(--text-muted);">Failed to load content.</p>';
  }
}

function toggleSourceModal(show) {
  const modal = document.getElementById('sourceModal');
  if (!modal) return;
  modal.style.display = show ? 'block' : 'none';

  if (!show) {
    document.getElementById('sourceAlert').style.display = 'none';
    document.getElementById('sourceForm')?.reset();
    document.getElementById('sourceMovieId').value = '';
    document.getElementById('movieSourcesList').innerHTML = '';
  }
}

async function openSourceModal(movieId, movieTitle) {
  document.getElementById('sourceMovieId').value = movieId;
  document.getElementById('sourceModalSubtitle').textContent =
    `Manage playback sources for ${movieTitle || 'this title'}.`;
  document.getElementById('sourceAlert').style.display = 'none';
  toggleSourceModal(true);
  await loadMovieSources(movieId);
}

async function loadMovieSources(movieId = document.getElementById('sourceMovieId')?.value) {
  const listDiv = document.getElementById('movieSourcesList');
  if (!listDiv || !movieId) return;

  listDiv.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    const token = localStorage.getItem('token');
    const res = await apiFetch(`/movies/${movieId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await res.json();
    const movie = unwrapResponse(payload);

    if (!res.ok || !payload.success || !movie) {
      throw new Error(getResponseMessage(payload, 'Failed to load sources'));
    }

    const sources = Array.isArray(movie.sources) ? movie.sources : [];
    if (!sources.length) {
      listDiv.innerHTML = '<p style="color:var(--text-muted);">No sources added yet.</p>';
      return;
    }

    listDiv.innerHTML = `
      <div style="display:grid;gap:12px;">
        ${sources.map((source, index) => `
          <div class="card" style="padding:14px;">
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
              <div style="min-width:0;flex:1;">
                <div style="font-weight:600;margin-bottom:6px;">
                  ${escapeHtml(source.server || 'unknown')} â€¢ ${escapeHtml(source.quality || 'HD')}
                </div>
                <div style="font-size:12px;color:var(--text-muted);word-break:break-all;">
                  ${escapeHtml(source.url || '')}
                </div>
              </div>
              <button type="button"
                      class="btn btn-danger delete-modal-source-btn"
                      data-movie-id="${movieId}"
                      data-source-id="${source._id}">
                <i class="ri-delete-bin-line"></i> Delete
              </button>
            </div>
          </div>
        `).join('')}
      </div>`;

    [...listDiv.querySelectorAll('.card')].forEach((card, index) => {
      const infoBlocks = card.querySelectorAll('div[style]');
      const titleBlock = infoBlocks[3];
      const detailBlock = infoBlocks[4];
      if (titleBlock) {
        titleBlock.textContent = `${index === 0 ? 'Primary' : `Fallback ${index}`} â€¢ ${sources[index]?.quality || 'HD'}`;
      }
      if (detailBlock) {
        detailBlock.style.wordBreak = 'normal';
        detailBlock.textContent = sources[index]?.server === 'upload'
          ? 'Stored upload source ready.'
          : 'External stream source saved.';
      }
    });
  } catch (error) {
    listDiv.innerHTML = '<p style="color:var(--text-muted);">Failed to load sources.</p>';
    showAlert(document.getElementById('sourceAlert'), 'error', error.message);
  }
}

async function submitSourceForm(event) {
  event.preventDefault();

  const movieId = document.getElementById('sourceMovieId').value;
  const server = document.getElementById('sourceServer').value;
  const rawUrl = document.getElementById('sourceUrl').value.trim();
  const quality = document.getElementById('sourceQuality').value;
  const button = document.getElementById('saveSourceBtn');
  const alertBox = document.getElementById('sourceAlert');

  if (!movieId) {
    showAlert(alertBox, 'error', 'No movie selected for source management.');
    return;
  }

  let url = rawUrl;
  if (server === 'youtube') {
    const id = extractYouTubeId(rawUrl);
    if (!id) {
      showAlert(alertBox, 'error', 'Invalid YouTube URL');
      return;
    }
    url = buildProviderWatchUrl('youtube', id);
  }

  if (server === 'dailymotion') {
    const id = extractDailymotionId(rawUrl);
    if (!id) {
      showAlert(alertBox, 'error', 'Invalid Dailymotion URL');
      return;
    }
    url = buildProviderWatchUrl('dailymotion', id);
  }

  if (server === 'vimeo') {
    const id = extractVimeoId(rawUrl);
    if (!id) {
      showAlert(alertBox, 'error', 'Invalid Vimeo URL');
      return;
    }
    url = buildProviderWatchUrl('vimeo', id);
  }

  button.innerHTML = '<i class="ri-loader-4-line"></i> Saving...';
  button.disabled = true;

  try {
    const token = localStorage.getItem('token');
    const res = await apiFetch(`/movies/${movieId}/source`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ server, url, quality }),
    });
    const payload = await res.json();

    if (!res.ok || !payload.success) {
      throw new Error(getResponseMessage(payload, 'Failed to add source'));
    }

    showToast(payload.message || 'Source added successfully', 'success');
    document.getElementById('sourceForm').reset();
    document.getElementById('sourceMovieId').value = movieId;
    document.getElementById('sourceQuality').value = 'HD';
    document.getElementById('sourceServer').value = 'youtube';
    alertBox.style.display = 'none';
    await loadMovieSources(movieId);
  } catch (error) {
    showAlert(alertBox, 'error', error.message);
  } finally {
    button.innerHTML = '<i class="ri-add-line"></i> Add Source';
    button.disabled = false;
  }
}

async function deleteMovieSource(movieId, sourceId) {
  const alertBox = document.getElementById('sourceAlert');

  try {
    const token = localStorage.getItem('token');
    const res = await apiFetch(`/movies/${movieId}/source/${sourceId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await res.json();

    if (!res.ok || !payload.success) {
      throw new Error(getResponseMessage(payload, 'Failed to delete source'));
    }

    showToast(payload.message || 'Source deleted successfully', 'success');
    alertBox.style.display = 'none';
    await loadMovieSources(movieId);
  } catch (error) {
    showAlert(alertBox, 'error', error.message);
  }
}

async function handleDeleteModalSource(button) {
  const confirmed = confirm('Delete this source?');
  if (!confirmed) return;

  await deleteMovieSource(button.dataset.movieId, button.dataset.sourceId);
}

function toggleAdminPanel(panel) {
  const opsPanel = document.getElementById('contentOpsPanel');
  const healthPanel = document.getElementById('contentHealthPanel');

  if (!opsPanel || !healthPanel) return;

  const isHealth = panel === 'contentHealth';
  opsPanel.style.display = isHealth ? 'none' : '';
  healthPanel.style.display = isHealth ? '' : 'none';

  document.querySelectorAll('[data-admin-panel-btn]').forEach((button) => {
    const active = button.dataset.adminPanelBtn === panel;
    button.classList.toggle('btn-primary', active);
    button.classList.toggle('btn-outline', !active);
  });

  if (isHealth) {
    loadBrokenSources();
  }
}

async function loadBrokenSources() {
  const listDiv = document.getElementById('brokenSourcesList');
  if (!listDiv) return;

  listDiv.innerHTML = '<div class="spinner-container"><div class="spinner"></div></div>';

  try {
    const token = localStorage.getItem('token');
    const res = await apiFetch('/movies/sources/broken', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const payload = await res.json();

    if (!res.ok || !payload.success) {
      throw new Error(payload.error || payload.message || 'Failed to load broken sources');
    }

    const sources = payload.data?.sources || [];
    if (!sources.length) {
      listDiv.innerHTML = '<p style="color:var(--text-muted);">No broken sources detected.</p>';
      return;
    }

    listDiv.innerHTML = `
      <div style="display:grid;gap:12px;">
        ${sources.map((source) => `
          <div style="background:var(--bg-secondary);border:1px solid rgba(229,9,20,0.25);border-radius:var(--radius);padding:16px;">
            <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;flex-wrap:wrap;">
              <div style="min-width:0;flex:1;">
                <div style="font-weight:600;margin-bottom:6px;">${escapeHtml(source.movieTitle || 'Untitled')}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">
                  ${escapeHtml(source.server || 'unknown')} â€¢ ${escapeHtml(source.quality || 'HD')}
                </div>
                <div style="font-size:12px;color:var(--accent);word-break:break-all;">${escapeHtml(source.url || '')}</div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:6px;">
                  Last checked: ${source.last_checked ? new Date(source.last_checked).toLocaleString() : 'Never'}
                </div>
              </div>
              <div style="display:flex;gap:8px;flex-wrap:wrap;">
                <button type="button" class="btn btn-outline replace-source-btn"
                        data-movie-id="${source.movieId}"
                        data-source-id="${source.sourceId}"
                        data-url="${encodeURIComponent(source.url || '')}"
                        style="padding:8px 12px;font-size:12px;">
                  <i class="ri-refresh-line"></i> Replace URL
                </button>
                <button type="button" class="btn delete-source-btn"
                        data-movie-id="${source.movieId}"
                        data-source-id="${source.sourceId}"
                        style="background:rgba(229,9,20,0.1);color:var(--accent);border:1px solid rgba(229,9,20,0.3);padding:8px 12px;font-size:12px;">
                  <i class="ri-delete-bin-line"></i> Delete
                </button>
              </div>
            </div>
          </div>
        `).join('')}
      </div>`;
  } catch (error) {
    listDiv.innerHTML = '<p style="color:var(--text-muted);">Failed to load broken sources.</p>';
    showAlert(document.getElementById('contentHealthAlert'), 'error', error.message);
  }
}

async function onBrokenSourceAction(event) {
  const deleteButton = event.target.closest('.delete-source-btn');
  const replaceButton = event.target.closest('.replace-source-btn');

  if (deleteButton) {
    const confirmed = confirm('Delete this broken source?');
    if (!confirmed) return;

    try {
      const token = localStorage.getItem('token');
      const res = await apiFetch(`/movies/${deleteButton.dataset.movieId}/source/${deleteButton.dataset.sourceId}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const payload = await res.json();

      if (!res.ok || !payload.success) {
        throw new Error(payload.error || payload.message || 'Delete failed');
      }

      showToast('Broken source deleted', 'success');
      loadBrokenSources();
      loadMoviesList();
    } catch (error) {
      showToast(error.message || 'Delete failed', 'error');
    }
  }

  if (replaceButton) {
    const currentUrl = replaceButton.dataset.url ? decodeURIComponent(replaceButton.dataset.url) : '';
    const nextUrl = prompt('Enter the replacement URL for this source:', currentUrl);
    if (!nextUrl) return;

    try {
      const token = localStorage.getItem('token');
      const res = await apiFetch(`/movies/${replaceButton.dataset.movieId}/source/${replaceButton.dataset.sourceId}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: nextUrl }),
      });
      const payload = await res.json();

      if (!res.ok || !payload.success) {
        throw new Error(payload.error || payload.message || 'Replace failed');
      }

      showToast('Source updated', 'success');
      loadBrokenSources();
      loadMoviesList();
    } catch (error) {
      showToast(error.message || 'Replace failed', 'error');
    }
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// EDIT MODAL
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function toggleEditModal(show) {
  document.getElementById('editModal').style.display = show ? 'flex' : 'none';
}

async function openEditModal(movieId) {
  try {
    const token = localStorage.getItem('token');
    const res   = await apiFetch(`/movies/${movieId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const payload = await res.json();
    const movie = unwrapResponse(payload);

    if (!res.ok || !payload.success || !movie) {
      throw new Error(getResponseMessage(payload, 'Failed to load movie data'));
    }

    document.getElementById('editMovieId').value       = movie._id;
    document.getElementById('editTitle').value         = movie.title        || '';
    document.getElementById('editDescription').value   = movie.description  || '';
    document.getElementById('editCategory').value      = movie.category     || 'movie';
    document.getElementById('editStatus').value        = movie.status       || 'Completed';
    document.getElementById('editYear').value          = movie.releaseYear  || '';
    document.getElementById('editDuration').value      = movie.duration     || '';
    document.getElementById('editTrailerUrl').value    = movie.trailerUrl   || '';
    document.getElementById('editFeatured').checked    = !!movie.isFeatured;

    document.getElementById('editAlert').style.display = 'none';
    toggleEditModal(true);
  } catch(e) {
    showToast('Failed to load movie data', 'error');
  }
}

async function saveEdit(e) {
  e.preventDefault();
  const token   = localStorage.getItem('token');
  const movieId = document.getElementById('editMovieId').value;
  const btn     = document.getElementById('saveEditBtn');
  const alertBox = document.getElementById('editAlert');

  btn.innerHTML = '<i class="ri-loader-4-line"></i> Saving...';
  btn.disabled  = true;

  try {
    const body = {
      title:       document.getElementById('editTitle').value,
      description: document.getElementById('editDescription').value,
      category:    document.getElementById('editCategory').value,
      status:      document.getElementById('editStatus').value,
      releaseYear: parseInt(document.getElementById('editYear').value) || undefined,
      duration:    parseInt(document.getElementById('editDuration').value) || undefined,
      trailerUrl:  document.getElementById('editTrailerUrl').value,
      isFeatured:  document.getElementById('editFeatured').checked,
    };

    const res  = await apiFetch(`/movies/${movieId}`, {
      method:  'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    const data = unwrapResponse(payload) || {};

    if (res.ok && payload.success) {
      showToast(`"${data.movie.title}" updated!`, 'success');
      toggleEditModal(false);
      loadMoviesList();
      loadStats();
    } else {
      showAlert(alertBox, 'error', getResponseMessage(payload));
    }
  } catch(err) {
    showAlert(alertBox, 'error', err.message);
  }

  btn.innerHTML = '<i class="ri-save-line"></i> Save Changes';
  btn.disabled  = false;
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// DELETE MOVIE
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
async function deleteMovie(id, title) {
  if (!confirm(`Delete "${title}"?\n\nThis cannot be undone!`)) return;
  const token = localStorage.getItem('token');
  try {
    const res  = await apiFetch(`/movies/${id}`, {
      method:  'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const payload = await res.json();
    if (res.ok && payload.success) {
      showToast('Deleted successfully', 'success');
      loadMoviesList();
      loadStats();
      loadSeriesList();
      loadSubtitleMovieSelect();
    } else {
      showToast(getResponseMessage(payload, 'Delete failed'), 'error');
    }
  } catch(e) {
    showToast('Delete failed â€” server error', 'error');
  }
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// RESET FORMS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function resetMovieForm() {
  document.getElementById('videoPreview').style.display     = 'none';
  document.getElementById('thumbnailPreview').style.display = 'none';
  document.getElementById('uploadAlert').style.display      = 'none';
  document.getElementById('movieSourceType').value          = 'local';
  document.getElementById('videoUrlInput').value            = '';
  document.getElementById('youtubeUrl').value               = '';
  document.getElementById('dailymotionUrl').value           = '';
  document.getElementById('vimeoUrl').value                 = '';
  document.getElementById('movieThumbnailUrl').value        = '';
  document.getElementById('movieMetadataHint').textContent  = 'Paste provider URLs to build fallback sources and auto-fill available metadata.';
  setPosterPreview('movie', '');
  document.getElementById('uploadForm').reset();
}

function resetEpisodeForm() {
  document.getElementById('epVideoPreview').style.display = 'none';
  document.getElementById('episodeAlert').style.display   = 'none';
  document.getElementById('episodeSourceType').value      = 'local';
  document.getElementById('episodeThumbnailUrl').value    = '';
  document.getElementById('episodeMetadataHint').textContent = 'Paste a provider URL to auto-fill episode metadata and thumbnail.';
  setPosterPreview('episode', '');
  document.getElementById('episodeForm').reset();
  loadSeriesList();
}

// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// HELPERS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
function showAlert(el, type, msg) {
  el.innerHTML = `
    <div class="alert alert-${type}">
      <i class="ri-${type === 'success' ? 'checkbox-circle' : 'error-warning'}-line"></i>
      ${msg}
    </div>`;
  el.style.display = 'block';
}

function showToast(msg, type = 'success') {
  const c = document.getElementById('toastContainer');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 3000);
}

// Load subtitle select on init
loadSubtitleMovieSelect();



})();
