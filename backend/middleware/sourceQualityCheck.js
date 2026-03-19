const YOUTUBE_ID_REGEX = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const DAILYMOTION_ID_REGEX = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([A-Za-z0-9]+)/i;

function inferSourceType(url = '', fallbackType = '') {
  const explicit = String(fallbackType || '').trim().toLowerCase();
  if (explicit) return explicit;

  const raw = String(url || '').trim();
  if (!raw) return 'offline';
  if (YOUTUBE_ID_REGEX.test(raw)) return 'youtube';
  if (DAILYMOTION_ID_REGEX.test(raw)) return 'dailymotion';
  return 'local';
}

function getCleanEmbedUrl(url = '', fallbackType = '') {
  const raw = String(url || '').trim();
  if (!raw) return '';

  const sourceType = inferSourceType(raw, fallbackType);

  if (sourceType === 'youtube') {
    const match = raw.match(YOUTUBE_ID_REGEX);
    if (!match?.[1]) return '';
    const params = new URLSearchParams({
      autoplay: '1',
      controls: '1',
      cc_load_policy: '1',
      cc_lang_pref: 'en',
      modestbranding: '1',
      playsinline: '1',
      rel: '0',
    });
    return `https://www.youtube-nocookie.com/embed/${match[1]}?${params.toString()}`;
  }

  if (sourceType === 'dailymotion') {
    const match = raw.match(DAILYMOTION_ID_REGEX);
    if (!match?.[1]) return '';
    const params = new URLSearchParams({
      autoplay: '1',
      'ui-logo': 'false',
      'subtitles-default': 'en',
      'queue-enable': 'false',
      'sharing-enable': 'false',
      'endscreen-enable': 'false',
    });
    return `https://www.dailymotion.com/embed/video/${match[1]}?${params.toString()}`;
  }

  return raw;
}

function inspectPlaybackSource({ videoUrl = '', sourceType = '' } = {}) {
  const resolvedType = inferSourceType(videoUrl, sourceType);
  const hasUrl = Boolean(String(videoUrl || '').trim());

  if (!hasUrl) {
    return {
      sourceType: resolvedType,
      originalUrl: '',
      embedUrl: '',
      isOffline: true,
      reason: 'missing_url',
    };
  }

  if (resolvedType === 'youtube' || resolvedType === 'dailymotion') {
    const embedUrl = getCleanEmbedUrl(videoUrl, resolvedType);
    return {
      sourceType: resolvedType,
      originalUrl: videoUrl,
      embedUrl,
      isOffline: !embedUrl,
      reason: embedUrl ? '' : 'malformed_external_url',
    };
  }

  return {
    sourceType: resolvedType,
    originalUrl: videoUrl,
    embedUrl: '',
    isOffline: false,
    reason: '',
  };
}

module.exports = {
  inferSourceType,
  getCleanEmbedUrl,
  inspectPlaybackSource,
};
