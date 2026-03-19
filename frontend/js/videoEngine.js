const VideoEngine = (() => {
  const SERVER_PRIORITY = {
    upload: 0,
    youtube: 1,
    dailymotion: 2,
  };

  function normalizeServer(server = '', url = '') {
    const value = String(server || '').trim().toLowerCase();
    if (value) return value;

    const raw = String(url || '').toLowerCase();
    if (raw.includes('youtube.com') || raw.includes('youtu.be')) return 'youtube';
    if (raw.includes('dailymotion.com') || raw.includes('dai.ly')) return 'dailymotion';
    return 'upload';
  }

  function getYoutubeId(url = '') {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('youtu.be')) {
        return parsed.pathname.replace('/', '').trim();
      }
      if (parsed.searchParams.get('v')) {
        return parsed.searchParams.get('v');
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      const embedIndex = parts.findIndex((part) => part === 'embed');
      if (embedIndex !== -1 && parts[embedIndex + 1]) {
        return parts[embedIndex + 1];
      }
    } catch {}
    return '';
  }

  function getDailymotionId(url = '') {
    try {
      const parsed = new URL(url);
      if (parsed.hostname.includes('dai.ly')) {
        return parsed.pathname.replace('/', '').trim();
      }
      const parts = parsed.pathname.split('/').filter(Boolean);
      const videoIndex = parts.findIndex((part) => part === 'video');
      if (videoIndex !== -1 && parts[videoIndex + 1]) {
        return parts[videoIndex + 1];
      }
      const embedIndex = parts.findIndex((part) => part === 'embed');
      if (embedIndex !== -1 && parts[embedIndex + 2]) {
        return parts[embedIndex + 2];
      }
    } catch {}
    return '';
  }

  function toEmbedUrl(source) {
    const server = normalizeServer(source.server, source.url);
    const url = String(source.url || '').trim();

    if (!url) return '';

    if (server === 'youtube' || server === 'dailymotion') {
      if (typeof window.getCleanEmbedUrl === 'function') {
        return window.getCleanEmbedUrl(url);
      }
    }

    return url;
  }

  function createSourceConfig(source, index = 0) {
    const server = normalizeServer(source.server, source.url);
    const playUrl = toEmbedUrl({ ...source, server });

    return {
      id: source._id || `${server}-${index}`,
      server,
      sourceType: source.sourceType || server,
      url: String(source.url || '').trim(),
      quality: String(source.quality || 'HD').trim() || 'HD',
      embedUrl: server === 'upload' ? '' : playUrl,
      playUrl: server === 'upload' ? playUrl : '',
      label: `${server.charAt(0).toUpperCase()}${server.slice(1)}${source.quality ? ` • ${source.quality}` : ''}`,
      isExternal: server !== 'upload',
    };
  }

  function buildMovieSources(movie) {
    const sources = Array.isArray(movie.sources) ? movie.sources.map(createSourceConfig) : [];

    if (movie.videoUrl) {
      const uploadExists = sources.some((source) =>
        source.server === 'upload' && source.url === movie.videoUrl
      );

      if (!uploadExists) {
        sources.unshift(createSourceConfig({
          server: 'upload',
          url: movie.videoUrl,
          quality: movie.qualities?.['1080p'] ? 'Full HD' : 'HD',
        }, 'native'));
      }
    }

    return sources.sort((a, b) => {
      const priorityDiff = (SERVER_PRIORITY[a.server] ?? 99) - (SERVER_PRIORITY[b.server] ?? 99);
      if (priorityDiff !== 0) return priorityDiff;
      return a.label.localeCompare(b.label);
    });
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
  };

  return window.VideoEngine;
})();
