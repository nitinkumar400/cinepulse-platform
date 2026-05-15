const axios = require('axios');

const { getTmdbCredentials } = require('../config/env');

const TMDB_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMG = 'https://image.tmdb.org/t/p/original';
const TMDB_IMG_W = 'https://image.tmdb.org/t/p/w500';

const GENRE_MAP = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Sci-Fi',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War',
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mapTmdbStatus(tmdbStatus) {
  const map = {
    Released: 'Completed',
    Ended: 'Completed',
    'Returning Series': 'Ongoing',
    'In Production': 'Ongoing',
    'In Development': 'Upcoming',
    Planned: 'Upcoming',
    Canceled: 'Cancelled',
    Cancelled: 'Cancelled',
    Pilot: 'Upcoming',
    Completed: 'Completed',
    Ongoing: 'Ongoing',
    Upcoming: 'Upcoming',
  };
  return map[tmdbStatus] || 'Completed';
}

function formatItem(item) {
  const genres = (item.genres || item.genre_ids || [])
    .map((genre) => (typeof genre === 'object' ? genre.name : GENRE_MAP[genre]))
    .filter(Boolean);

  const rawRating = Number(item.vote_average || 0);
  const safeOverview = String(item.overview || 'No description available.')
    .replace(/<[^>]+>/g, '')
    .trim()
    .slice(0, 600);

  return {
    tmdbId: item.id,
    title: item.title || item.name || 'Unknown',
    description: safeOverview,
    posterUrl: item.poster_path ? `${TMDB_IMG_W}${item.poster_path}` : '',
    bannerUrl: item.backdrop_path ? `${TMDB_IMG}${item.backdrop_path}` : '',
    logoUrl: item.logo_path ? `${TMDB_IMG}${item.logo_path}` : '',
    releaseYear: parseInt((item.release_date || item.first_air_date || '2024').split('-')[0], 10) || 2024,
    rating: item.adult ? 'R' : 'PG-13',
    averageRating: rawRating > 0 ? Math.min(10, Number(rawRating.toFixed(1))) : 0,
    popularity: Number(item.popularity || 0),
    genres,
    type: item.media_type || (item.first_air_date ? 'tv' : 'movie'),
    alreadyImported: false,
  };
}

function normalizeRoutePayload(data) {
  return {
    results: Array.isArray(data.results) ? data.results.map(formatItem) : [],
    pagination: {
      page: data.page || 1,
      totalPages: data.total_pages || 1,
      total: data.total_results || 0,
    },
  };
}

function normalizeBearerToken(value = '') {
  return String(value || '').trim().replace(/^Bearer\s+/i, '');
}

function buildTmdbRequest(endpoint, params = {}) {
  const credentials = getTmdbCredentials();
  const apiKey = String(credentials.apiKey || '').trim();
  const bearerToken = normalizeBearerToken(credentials.bearerToken);
  const useApiKey = !!apiKey;

  if (!apiKey && !bearerToken) {
    const error = new Error('TMDb credentials are missing. Add TMDB_API_KEY or TMDB_TOKEN.');
    error.status = 503;
    error.code = 'TMDB_CONFIG_MISSING';
    throw error;
  }

  const url = new URL(`${TMDB_BASE}${endpoint}`);
  if (useApiKey) url.searchParams.set('api_key', apiKey);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  const headers = { Accept: 'application/json' };
  if (!useApiKey && bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  return { url: url.toString(), headers };
}

function buildAxiosError(error, requestUrl) {
  const status = error.response?.status || 502;
  const responseBody = error.response?.data || null;
  const responsePreview = typeof responseBody === 'string'
    ? responseBody.slice(0, 400)
    : JSON.stringify(responseBody || {}).slice(0, 400);

  console.error('[TMDB] request failed', {
    url: requestUrl,
    code: error.code || error.name || 'UNKNOWN',
    status,
    message: error.message || 'Unknown TMDB error',
    response: responsePreview,
  });

  const wrapped = new Error(
    error.response?.data?.status_message ||
    error.message ||
    'TMDb request failed'
  );

  wrapped.status = status;
  wrapped.code = error.code || (status === 429 ? 'TMDB_RATE_LIMIT' : 'TMDB_REQUEST_FAILED');
  wrapped.details = {
    requestUrl,
    response: responseBody,
  };
  return wrapped;
}

async function requestTmdb(endpoint, params = {}, options = {}) {
  const { url, headers } = buildTmdbRequest(endpoint, params);
  const attempts = options.attempts ?? 3;
  const timeout = options.timeoutMs ?? 7000;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await axios.get(url, {
        headers,
        timeout,
        validateStatus: () => true,
      });

      if (response.status >= 200 && response.status < 300) {
        return response.data;
      }

      const httpError = new Error(
        response.data?.status_message || `TMDb request failed with ${response.status}`
      );
      httpError.response = response;
      httpError.code = response.status === 429 ? 'TMDB_RATE_LIMIT' : 'TMDB_REQUEST_FAILED';
      throw httpError;
    } catch (error) {
      lastError = buildAxiosError(error, url);
      const retryable =
        lastError.code === 'ECONNABORTED' ||
        lastError.code === 'ETIMEDOUT' ||
        lastError.code === 'EAI_AGAIN' ||
        lastError.code === 'ECONNRESET' ||
        lastError.code === 'EACCES' ||
        lastError.code === 'TMDB_RATE_LIMIT' ||
        lastError.status >= 500;

      if (!retryable || attempt === attempts) {
        break;
      }

      await sleep(300 * attempt);
    }
  }

  if (lastError && (lastError.code === 'ECONNABORTED' || lastError.code === 'ETIMEDOUT')) {
    lastError.status = 504;
    lastError.code = 'TMDB_TIMEOUT';
    lastError.message = 'TMDb request timed out';
  }

  throw lastError;
}

async function requestTmdbWithRetry(endpoint, params = {}, options = {}) {
  return requestTmdb(endpoint, params, options);
}

function buildMovieDocument(tmdbData, type, uploadedBy) {
  const formatted = formatItem(tmdbData);
  const logo = (tmdbData.images?.logos || [])
    .find((entry) => entry.iso_639_1 === 'en' && entry.file_path)
    || (tmdbData.images?.logos || []).find((entry) => entry.file_path);

  const cast = (tmdbData.credits?.cast || [])
    .slice(0, 10)
    .map((person) => person.name)
    .filter(Boolean);

  const director = type === 'tv'
    ? (tmdbData.created_by?.[0]?.name || '')
    : ((tmdbData.credits?.crew || []).find((person) => person.job === 'Director')?.name || '');

  const studio = type === 'tv'
    ? (tmdbData.networks?.[0]?.name || tmdbData.production_companies?.[0]?.name || '')
    : (tmdbData.production_companies?.[0]?.name || '');

  const duration = type === 'tv'
    ? (tmdbData.episode_run_time?.[0] || 45)
    : (tmdbData.runtime || 120);

  const trailerVideo = (tmdbData.videos?.results || []).find(
    (video) => video.type === 'Trailer' && video.site === 'YouTube'
  );

  return {
    title: formatted.title,
    description: formatted.description,
    category: type === 'tv' ? 'series' : 'movie',
    genre: formatted.genres,
    releaseYear: formatted.releaseYear,
    duration,
    rating: formatted.rating,
    language: 'English',
    studio,
    director,
    cast,
    thumbnailUrl: formatted.posterUrl,
    bannerUrl: formatted.bannerUrl,
    logoUrl: logo?.file_path ? `${TMDB_IMG}${logo.file_path}` : '',
    trailerUrl: trailerVideo ? `https://www.youtube.com/watch?v=${trailerVideo.key}` : '',
    videoUrl: '',
    uploadedBy,
    averageRating: formatted.averageRating,
    status: mapTmdbStatus(tmdbData.status),
    tmdbId: tmdbData.id,
    totalEpisodes: tmdbData.number_of_episodes || 0,
  };
}

async function fetchList(type, mode, params = {}) {
  switch (mode) {
    case 'search':
      return requestTmdbWithRetry(type === 'tv' ? '/search/tv' : '/search/movie', params, {
        attempts: 3,
        timeoutMs: 7000,
      });
    case 'trending':
      return requestTmdbWithRetry(`/trending/${type}/${params.time || 'week'}`, { page: params.page || 1 }, {
        attempts: 3,
        timeoutMs: 7000,
      });
    case 'popular':
      return requestTmdbWithRetry(type === 'tv' ? '/tv/popular' : '/movie/popular', params, {
        attempts: 3,
        timeoutMs: 7000,
      });
    case 'top-rated':
      if (params.genre) {
        return requestTmdbWithRetry(type === 'tv' ? '/discover/tv' : '/discover/movie', {
          ...params,
          sort_by: 'vote_average.desc',
          with_genres: params.genre,
          'vote_count.gte': 100,
        }, {
          attempts: 3,
          timeoutMs: 7000,
        });
      }
      return requestTmdbWithRetry(type === 'tv' ? '/tv/top_rated' : '/movie/top_rated', params, {
        attempts: 3,
        timeoutMs: 7000,
      });
    default:
      throw new Error(`Unsupported TMDb mode: ${mode}`);
  }
}

async function fetchDetails(tmdbId, type) {
  return requestTmdbWithRetry(
    type === 'tv' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`,
    {
      language: 'en-US',
      append_to_response: 'credits,videos,keywords,images',
    },
    {
      attempts: 3,
      timeoutMs: 7000,
    }
  );
}

async function fetchSeasonDetails(tmdbId, seasonNumber) {
  return requestTmdbWithRetry(
    `/tv/${tmdbId}/season/${seasonNumber}`,
    {
      language: 'en-US',
    },
    {
      attempts: 3,
      timeoutMs: 7000,
    }
  );
}

module.exports = {
  TMDB_BASE,
  TMDB_IMG,
  TMDB_IMG_W,
  formatItem,
  mapTmdbStatus,
  normalizeRoutePayload,
  requestTmdb,
  requestTmdbWithRetry,
  fetchList,
  fetchDetails,
  fetchSeasonDetails,
  buildMovieDocument,
  buildTmdbRequest,
};
