(function (global) {
  const YOUTUBE_REGEX = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
  const DAILYMOTION_REGEX = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([A-Za-z0-9]+)/i;
  const VIMEO_REGEX = /(?:vimeo\.com\/)(\d+)/i;

  function buildNormalizedSource(type, id) {
    const normalizedType = String(type || '').trim().toLowerCase();
    const normalizedId = String(id || '').trim();

    if (!normalizedType || !normalizedId) return null;

    if (normalizedType === 'youtube') {
      return {
        type: 'youtube',
        id: normalizedId,
        embedUrl: `https://www.youtube.com/embed/${normalizedId}?rel=0&modestbranding=1`,
      };
    }

    if (normalizedType === 'dailymotion') {
      return {
        type: 'dailymotion',
        id: normalizedId,
        embedUrl: `https://www.dailymotion.com/embed/video/${normalizedId}`,
      };
    }

    if (normalizedType === 'vimeo') {
      return {
        type: 'vimeo',
        id: normalizedId,
        embedUrl: `https://player.vimeo.com/video/${normalizedId}`,
      };
    }

    return null;
  }

  function normalizeVideoSource(url) {
    const raw = String(url || '').trim();
    if (!raw) return null;

    const youtubeMatch = raw.match(YOUTUBE_REGEX);
    if (youtubeMatch?.[1]) {
      return buildNormalizedSource('youtube', youtubeMatch[1]);
    }

    const dailymotionMatch = raw.match(DAILYMOTION_REGEX);
    if (dailymotionMatch?.[1]) {
      return buildNormalizedSource('dailymotion', dailymotionMatch[1]);
    }

    const vimeoMatch = raw.match(VIMEO_REGEX);
    if (vimeoMatch?.[1]) {
      return buildNormalizedSource('vimeo', vimeoMatch[1]);
    }

    return null;
  }

  global.normalizeVideoSource = normalizeVideoSource;
  global.buildNormalizedVideoSource = buildNormalizedSource;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      normalizeVideoSource,
      buildNormalizedVideoSource: buildNormalizedSource,
    };
  }
})(typeof window !== 'undefined' ? window : globalThis);
