const express = require('express');
const router = express.Router();
const Movie = require('../models/Movie');
const { cronOrAdmin } = require('../middleware/authMiddleware');
const { fetchList, requestTmdbWithRetry, formatItem } = require('../services/tmdbService');

const ANILIST_API = 'https://graphql.anilist.co';

async function fetchAniList(query, variables = {}) {
  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const firstError = payload?.errors?.[0];
    const errorMessage = firstError?.message || `AniList API error (${response.status})`;
    const isNotFound = response.status === 404 || /not found/i.test(String(errorMessage));
    if (isNotFound) {
      return payload?.data || {};
    }
    throw new Error(errorMessage);
  }
  if (payload?.errors?.length) {
    const firstErrorMessage = payload.errors[0]?.message || 'AniList query failed';
    if (/not found/i.test(String(firstErrorMessage))) {
      return payload?.data || {};
    }
    throw new Error(firstErrorMessage);
  }

  return payload.data || {};
}

async function resolveTmdbForAnimeTitle(title = '', seasonYear = null) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) return null;

  try {
    const result = await requestTmdbWithRetry('/search/tv', {
      query: cleanTitle,
      year: seasonYear || undefined,
      language: 'en-US',
      include_adult: false,
      page: 1,
    }, { attempts: 2, timeoutMs: 6500 });

    const rows = Array.isArray(result?.results) ? result.results : [];
    if (!rows.length) return null;

    const normalized = cleanTitle.toLowerCase();
    const match = rows.find((row) => String(row?.name || '').trim().toLowerCase() === normalized) || rows[0];

    return {
      tmdbId: Number(match?.id) || null,
      originalLanguage: String(match?.original_language || '').trim().toLowerCase(),
      genreIds: Array.isArray(match?.genre_ids) ? match.genre_ids : [],
    };
  } catch {
    return null;
  }
}

function parseSeasonNumberFromTitle(title = '') {
  const raw = String(title || '').trim();
  if (!raw) return 1;
  const match = raw.match(/\bseason\s*(\d+)\b/i) || raw.match(/\bs(\d+)\b/i);
  const num = match ? parseInt(match[1], 10) : 1;
  return Number.isFinite(num) && num > 0 ? num : 1;
}

function buildFranchiseKey(title = '') {
  return String(title || '')
    .toLowerCase()
    .replace(/\bseason\s*\d+\b/gi, '')
    .replace(/\bs\d+\b/gi, '')
    .replace(/[:\-–—].*$/g, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveCategoryFromMedia(item) {
  const mediaType = item.media_type || (item.first_air_date ? 'tv' : 'movie');
  return mediaType === 'tv' ? 'series' : 'movie';
}

function normalizeSpokenLanguages(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .map((entry) => String(entry?.english_name || entry?.name || entry?.iso_639_1 || '').trim())
    .filter(Boolean);
}

function safeGenresFromFormatted(formatted) {
  return Array.isArray(formatted?.genres) ? formatted.genres : [];
}

function dedupeKey(item) {
  if (Number.isFinite(item.tmdb_id)) return `tmdb:${item.tmdb_id}`;
  if (Number.isFinite(item.tmdbId)) return `tmdb:${item.tmdbId}`;
  if (Number.isFinite(item.anilist_id)) return `anilist:${item.anilist_id}`;
  if (Number.isFinite(item.anilistId)) return `anilist:${item.anilistId}`;
  const title = String(item.title || '').trim().toLowerCase();
  return title ? `title:${title}` : '';
}

function pruneNullIdFields(setPayload = {}) {
  const payload = { ...setPayload };
  if (!Number.isFinite(payload.tmdbId) || payload.tmdbId <= 0) {
    delete payload.tmdbId;
  }
  if (!Number.isFinite(payload.tmdb_id) || payload.tmdb_id <= 0) {
    delete payload.tmdb_id;
  }
  if (!Number.isFinite(payload.anilistId) || payload.anilistId <= 0) {
    delete payload.anilistId;
  }
  if (!Number.isFinite(payload.anilist_id) || payload.anilist_id <= 0) {
    delete payload.anilist_id;
  }
  return payload;
}

router.post('/', cronOrAdmin, async (req, res) => {
  try {
    const [popularMovies, popularTv, trendingAll] = await Promise.all([
      fetchList('movie', 'popular', { page: 1 }),
      fetchList('tv', 'popular', { page: 1 }),
      requestTmdbWithRetry('/trending/all/week', { page: 1 }),
    ]);

    const mergedRaw = [
      ...(popularMovies.results || []),
      ...(popularTv.results || []),
      ...(trendingAll.results || []),
    ];

    const records = mergedRaw
      .filter((item) => item && (item.title || item.name) && item.id)
      .slice(0, 20);

    const deduped = [];
    const seen = new Set();
    for (const raw of records) {
      const key = dedupeKey(raw || {});
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push(raw || {});
    }

    const updates = deduped.map((raw) => {
      const title = String(raw.title || raw.name || '').trim();
      const tmdbId = Number.isFinite(raw.tmdb_id) ? raw.tmdb_id : raw.tmdbId;
      const anilistId = Number.isFinite(raw.anilist_id) ? raw.anilist_id : raw.anilistId;
      const { title: _ignoreTitle, ...rest } = raw || {};
      const mediaType = raw.media_type || (raw.first_air_date ? 'tv' : 'movie');

      const filter = tmdbId
        ? { $or: [{ tmdbId }, { tmdb_id: tmdbId }] }
        : anilistId
          ? { $or: [{ anilistId }, { anilist_id: anilistId }] }
          : { title };

      const formatted = formatItem({ ...raw, media_type: mediaType });
      const detailsPromise = Number.isFinite(tmdbId)
        ? requestTmdbWithRetry(mediaType === 'tv' ? `/tv/${tmdbId}` : `/movie/${tmdbId}`, { language: 'en-US' })
        : Promise.resolve(null);

      return detailsPromise.then((details) => {
        const spokenLanguages = normalizeSpokenLanguages(details?.spoken_languages)
          || (raw.original_language ? [raw.original_language] : []);

        const setPayload = pruneNullIdFields({
          ...rest,
          title,
          category: resolveCategoryFromMedia(raw),
          genre: safeGenresFromFormatted(formatted),
          tmdb_genre_ids: Array.isArray(raw.genre_ids) ? raw.genre_ids : [],
          averageRating: Number(raw.vote_average || 0),
          vote_average: Number(raw.vote_average || 0),
          original_language: String(raw.original_language || '').trim().toLowerCase(),
          spoken_languages: spokenLanguages.length ? spokenLanguages : (raw.original_language ? [String(raw.original_language).trim()] : []),
          releaseYear: parseInt(String(raw.release_date || raw.first_air_date || '2024').split('-')[0], 10) || 2024,
          thumbnailUrl: formatted.posterUrl || '',
          bannerUrl: formatted.bannerUrl || '',
          tmdbId: tmdbId ?? raw.tmdbId ?? null,
          tmdb_id: tmdbId ?? raw.tmdb_id ?? null,
          anilistId: anilistId ?? raw.anilistId ?? null,
          anilist_id: anilistId ?? raw.anilist_id ?? null,
          provider: 'tmdb',
        });
        return {
          filter,
          update: {
            $set: setPayload,
            $unset: {
              ...(Object.prototype.hasOwnProperty.call(setPayload, 'tmdbId') ? {} : { tmdbId: '' }),
              ...(Object.prototype.hasOwnProperty.call(setPayload, 'tmdb_id') ? {} : { tmdb_id: '' }),
              ...(Object.prototype.hasOwnProperty.call(setPayload, 'anilistId') ? {} : { anilistId: '' }),
              ...(Object.prototype.hasOwnProperty.call(setPayload, 'anilist_id') ? {} : { anilist_id: '' }),
            },
          },
        };
      });
    });

    const resolvedUpdates = await Promise.all(updates);

    let matchedCount = 0;
    let modifiedCount = 0;
    let upsertedCount = 0;

    for (const item of resolvedUpdates) {
      const existing = await Movie.findOne(item.filter).select('_id').lean();
      await Movie.findOneAndUpdate(item.filter, item.update, {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      });

      if (existing?._id) {
        matchedCount += 1;
        modifiedCount += 1;
      } else {
        upsertedCount += 1;
      }
    }

    return res.json({
      message: 'Sync completed',
      received: mergedRaw.length,
      deduped: deduped.length,
      stats: { matchedCount, modifiedCount, upsertedCount },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

router.post('/anime', cronOrAdmin, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || req.body?.limit || '50', 10) || 50));
    const byTitleQuery = `
      query ($search: String!) {
        Media(search: $search, type: ANIME) {
          id
          idMal
          title { romaji english }
          description(asHtml: false)
          coverImage { extraLarge large }
          bannerImage
          averageScore
          episodes
          duration
          status
          genres
          seasonYear
          studios(isMain: true) { nodes { name } }
          nextAiringEpisode { episode airingAt }
          trailer { id site }
        }
      }
    `;

    const popularAllTimeQuery = `
      query ($page: Int!, $perPage: Int!) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
            id
            idMal
            title { romaji english }
            description(asHtml: false)
            coverImage { extraLarge large }
            bannerImage
            averageScore
            episodes
            duration
            status
            genres
            seasonYear
            studios(isMain: true) { nodes { name } }
            nextAiringEpisode { episode airingAt }
            trailer { id site }
          }
        }
      }
    `;

    const [narutoPayload, cotePayload, blueLockPayload, popularPayload] = await Promise.all([
      fetchAniList(byTitleQuery, { search: 'Naruto' }),
      fetchAniList(byTitleQuery, { search: 'Classroom of the Elite' }),
      fetchAniList(byTitleQuery, { search: 'Blue Lock' }),
      fetchAniList(popularAllTimeQuery, { page: 1, perPage: limit }),
    ]);

    const merged = [
      narutoPayload?.Media,
      cotePayload?.Media,
      blueLockPayload?.Media,
      ...((popularPayload?.Page?.media || [])),
    ].filter(Boolean);

    const seen = new Set();
    const deduped = merged.filter((item) => {
      const key = Number(item?.id) || `${String(item?.title?.romaji || '').trim().toLowerCase()}`;
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    let upsertedCount = 0;
    let updatedCount = 0;

    for (const anime of deduped) {
      const titleRomaji = String(anime?.title?.romaji || '').trim();
      if (!titleRomaji) continue;

      const tmdbMatch = await resolveTmdbForAnimeTitle(titleRomaji, anime?.seasonYear || null);
      const animeId = Number(anime?.id) || 0;
      const filter = animeId
        ? { $or: [{ anilistId: animeId }, { anilist_id: animeId }] }
        : { title: titleRomaji };
      const existing = await Movie.findOne(filter).select('_id').lean();
      const score = Number(anime?.averageScore || 0);
      const nextAiringAtSeconds = Number(anime?.nextAiringEpisode?.airingAt || 0);
      const spokenLanguages = ['Japanese', 'English'];
      const animeSeasonNumber = parseSeasonNumberFromTitle(titleRomaji);
      const franchiseKey = buildFranchiseKey(titleRomaji);
      const trailerUrl = anime?.trailer?.id && String(anime?.trailer?.site || '').toLowerCase() === 'youtube'
        ? `https://www.youtube.com/watch?v=${anime.trailer.id}`
        : '';

      const setPayload = pruneNullIdFields({
        title: titleRomaji,
        description: String(anime?.description || '').replace(/<[^>]+>/g, '').trim().slice(0, 600) || 'No description available.',
        category: 'anime',
        provider: 'anilist',
        anilistId: animeId || null,
        anilist_id: animeId || null,
        idMal: Number(anime?.idMal) || null,
        tmdbId: tmdbMatch?.tmdbId || null,
        tmdb_id: tmdbMatch?.tmdbId || null,
        tmdb_genre_ids: tmdbMatch?.genreIds || [16],
        original_language: tmdbMatch?.originalLanguage || 'ja',
        genre: Array.isArray(anime?.genres) ? anime.genres : ['Animation'],
        thumbnailUrl: anime?.coverImage?.extraLarge || anime?.coverImage?.large || '',
        bannerUrl: anime?.bannerImage || anime?.coverImage?.extraLarge || '',
        studio: anime?.studios?.nodes?.[0]?.name || '',
        releaseYear: Number(anime?.seasonYear) || new Date().getFullYear(),
        duration: Number(anime?.duration || 24),
        totalEpisodes: Number(anime?.episodes || 0),
        anilistScore: score > 0 ? Number((score / 10).toFixed(1)) : 0,
        averageRating: score > 0 ? Number((score / 10).toFixed(1)) : 0,
        vote_average: score > 0 ? Number((score / 10).toFixed(1)) : 0,
        spoken_languages: spokenLanguages,
        subDubTag: 'Subbed',
        animeSeasonNumber,
        franchiseKey,
        trailerUrl,
        status: anime?.status === 'RELEASING' ? 'Ongoing' : (anime?.status === 'NOT_YET_RELEASED' ? 'Upcoming' : (anime?.status === 'CANCELLED' ? 'Cancelled' : 'Completed')),
        nextAiringEpisode: {
          episode: Number(anime?.nextAiringEpisode?.episode || 0),
          airingAt: nextAiringAtSeconds > 0 ? new Date(nextAiringAtSeconds * 1000) : null,
        },
      });

      try {
        await Movie.findOneAndUpdate(filter, {
          $set: setPayload,
          $unset: {
            ...(Object.prototype.hasOwnProperty.call(setPayload, 'tmdbId') ? {} : { tmdbId: '' }),
            ...(Object.prototype.hasOwnProperty.call(setPayload, 'tmdb_id') ? {} : { tmdb_id: '' }),
            ...(Object.prototype.hasOwnProperty.call(setPayload, 'anilistId') ? {} : { anilistId: '' }),
            ...(Object.prototype.hasOwnProperty.call(setPayload, 'anilist_id') ? {} : { anilist_id: '' }),
          },
        }, {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        });
      } catch (error) {
        if (error?.code === 11000 && /tmdb_id|tmdbId/i.test(String(error.message || ''))) {
          const safePayload = pruneNullIdFields({
            ...setPayload,
            tmdbId: null,
            tmdb_id: null,
          });
          await Movie.findOneAndUpdate(filter, {
            $set: safePayload,
            $unset: {
              tmdbId: '',
              tmdb_id: '',
            },
          }, {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
          });
        } else {
          throw error;
        }
      }

      if (existing?._id) updatedCount += 1;
      else upsertedCount += 1;
    }

    return res.json({
      message: 'Anime sync completed',
      received: deduped.length,
      stats: { upsertedCount, updatedCount },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
