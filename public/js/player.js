(function (global) {
  let activePlayer = null;

  function destroyActivePlayer() {
    activePlayer = null;
  }

  function initPlayer(containerId, videoData) {
    const container = document.getElementById(containerId);
    if (!container || !videoData?.embedUrl) return null;

    destroyActivePlayer();

    const iframeAttrs = global.getProviderIframeAttributes?.() || {
      allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      referrerPolicy: 'strict-origin-when-cross-origin',
    };

    container.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'player-embed-shell';

    const iframe = document.createElement('iframe');
    iframe.src = videoData.embedUrl;
    iframe.allow = iframeAttrs.allow;
    iframe.referrerPolicy = iframeAttrs.referrerPolicy;
    iframe.setAttribute('allowfullscreen', '');
    iframe.removeAttribute('sandbox');

    wrapper.appendChild(iframe);
    container.appendChild(wrapper);

    return null;
  }

  async function loadMaskedWatchSource(episodeId) {
    if (!episodeId) throw new Error('Episode id is required');

    const response = await global.apiFetch(`/watch/${encodeURIComponent(episodeId)}`);
    const payload = await global.readJsonResponse(response);

    const source = global.buildNormalizedVideoSource?.(payload.type, payload.id);
    if (!source) {
      throw new Error(payload.message || 'Unsupported video source');
    }

    return {
      ...payload,
      ...source,
    };
  }

  async function bootstrapMaskedPlayer({
    containerId,
    offlineId,
    titleId,
    episodeId,
  }) {
    const container = document.getElementById(containerId);
    const offline = document.getElementById(offlineId);
    const title = document.getElementById(titleId);

    if (!container || !offline || !episodeId) return;

    try {
      const source = await loadMaskedWatchSource(episodeId);
      if (title && source.title) {
        title.textContent = source.title;
      }

      offline.classList.remove('is-visible');
      initPlayer(containerId, source);
    } catch (error) {
      container.innerHTML = '';
      offline.classList.add('is-visible');
      if (title && !title.textContent.trim()) {
        title.textContent = 'Playback unavailable';
      }
      if (typeof global.showToast === 'function') {
        global.showToast(error.message || 'Unable to load video source', 'error');
      }
    }
  }

  global.CineStreamPlayer = {
    initPlayer,
    loadMaskedWatchSource,
    bootstrapMaskedPlayer,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      initPlayer,
      loadMaskedWatchSource,
      bootstrapMaskedPlayer,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
