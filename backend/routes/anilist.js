// ══════════════════════════════════════════
// CINE STREAM — AniList Routes
// ══════════════════════════════════════════
const express = require('express');
const router  = express.Router();
const Movie   = require('../models/Movie');
const { protect, adminOnly } = require('../middleware/authMiddleware');

const ANILIST_API = 'https://graphql.anilist.co';

// ══════════════════════════════════════════
// HELPER — Fetch from AniList GraphQL
// ══════════════════════════════════════════
const fetchAniList = async (query, variables) => {
  const res = await fetch(ANILIST_API, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body:    JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`AniList API error: ${res.status}`);
  const data = await res.json();
  if (data.errors) throw new Error(data.errors[0].message);
  return data.data;
};

// ══════════════════════════════════════════
// FIX: Status mapper — converts ANY AniList status
// to a valid Movie model enum value.
//
// Movie model enum: ['Completed','Ongoing','Upcoming','Cancelled']
//
// OLD statusMap produced: 'Airing', 'Hiatus', 'Unknown'
// These are NOT in the enum → Mongoose throws ValidationError
// ══════════════════════════════════════════
function mapStatus(anilistStatus) {
  const map = {
    // AniList API values (uppercase)
    'FINISHED':          'Completed',
    'RELEASING':         'Ongoing',
    'NOT_YET_RELEASED':  'Upcoming',
    'CANCELLED':         'Cancelled',
    'HIATUS':            'Ongoing',
    // Already-mapped values (in case formatAniListItem is called twice)
    'Completed':         'Completed',
    'Ongoing':           'Ongoing',
    'Upcoming':          'Upcoming',
    'Cancelled':         'Cancelled',
    // FIX: These were the broken values from the old statusMap
    'Airing':            'Ongoing',   // old map produced this
    'Hiatus':            'Ongoing',   // old map produced this
    'Unknown':           'Completed', // old map produced this
  };
  return map[anilistStatus] || 'Completed'; // safe default
}

// ══════════════════════════════════════════
// SEARCH
// GET /api/anilist/search
// ══════════════════════════════════════════
router.get('/search', protect, adminOnly, async (req, res) => {
  try {
    const { q = '', page = 1, perPage = 20 } = req.query;
    const query = `
      query ($search: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage }
          media(search: $search, type: ANIME, sort: POPULARITY_DESC) {
            id title { romaji english native }
            description(asHtml: false)
            coverImage { large extraLarge }
            bannerImage averageScore popularity
            episodes duration status season seasonYear
            startDate { year month day }
            genres
            studios(isMain: true) { nodes { name } }
            isAdult
          }
        }
      }`;

    const data = await fetchAniList(query, {
      search:  q || undefined,
      page:    parseInt(page),
      perPage: parseInt(perPage),
    });

    // Check which ones are already imported
    const ids       = data.Page.media.map(m => m.id);
    const existing  = await Movie.find({ anilistId: { $in: ids } }).select('anilistId');
    const importedSet = new Set(existing.map(m => m.anilistId));

    const formatted = data.Page.media.map(m => ({
      ...formatAniListItem(m),
      alreadyImported: importedSet.has(m.id),
    }));

    res.json({ anime: formatted, pagination: data.Page.pageInfo });

  } catch (error) {
    console.error('AniList search error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// TRENDING
// GET /api/anilist/trending
// ══════════════════════════════════════════
router.get('/trending', protect, adminOnly, async (req, res) => {
  try {
    const { page = 1, perPage = 20 } = req.query;
    const query = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage }
          media(type: ANIME, sort: TRENDING_DESC, isAdult: false) {
            id title { romaji english native }
            description(asHtml: false)
            coverImage { large extraLarge }
            bannerImage averageScore popularity
            episodes duration status season seasonYear
            genres
            studios(isMain: true) { nodes { name } }
            isAdult
          }
        }
      }`;

    const data = await fetchAniList(query, { page: parseInt(page), perPage: parseInt(perPage) });

    const ids        = data.Page.media.map(m => m.id);
    const existing   = await Movie.find({ anilistId: { $in: ids } }).select('anilistId');
    const importedSet = new Set(existing.map(m => m.anilistId));

    const formatted = data.Page.media.map(m => ({
      ...formatAniListItem(m),
      alreadyImported: importedSet.has(m.id),
    }));

    res.json({ anime: formatted, pagination: data.Page.pageInfo });

  } catch (error) {
    console.error('AniList trending error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// BY SEASON
// GET /api/anilist/season
// ══════════════════════════════════════════
router.get('/season', protect, adminOnly, async (req, res) => {
  try {
    const { season = 'WINTER', year = 2024, page = 1, perPage = 20 } = req.query;
    const query = `
      query ($season: MediaSeason, $year: Int, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage }
          media(type: ANIME, season: $season, seasonYear: $year, sort: POPULARITY_DESC, isAdult: false) {
            id title { romaji english native }
            description(asHtml: false)
            coverImage { large extraLarge }
            bannerImage averageScore popularity
            episodes duration status season seasonYear
            genres
            studios(isMain: true) { nodes { name } }
            isAdult
          }
        }
      }`;

    const data = await fetchAniList(query, {
      season:  season.toUpperCase(),
      year:    parseInt(year),
      page:    parseInt(page),
      perPage: parseInt(perPage),
    });

    const ids         = data.Page.media.map(m => m.id);
    const existing    = await Movie.find({ anilistId: { $in: ids } }).select('anilistId');
    const importedSet = new Set(existing.map(m => m.anilistId));

    const formatted = data.Page.media.map(m => ({
      ...formatAniListItem(m),
      alreadyImported: importedSet.has(m.id),
    }));

    res.json({ anime: formatted, pagination: data.Page.pageInfo });

  } catch (error) {
    console.error('AniList season error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// TOP RATED
// GET /api/anilist/top
// ══════════════════════════════════════════
router.get('/top', protect, adminOnly, async (req, res) => {
  try {
    const { page = 1, perPage = 20 } = req.query;
    const query = `
      query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total currentPage lastPage hasNextPage }
          media(type: ANIME, sort: SCORE_DESC, isAdult: false) {
            id title { romaji english native }
            description(asHtml: false)
            coverImage { large extraLarge }
            bannerImage averageScore popularity
            episodes duration status season seasonYear
            genres
            studios(isMain: true) { nodes { name } }
            isAdult
          }
        }
      }`;

    const data = await fetchAniList(query, { page: parseInt(page), perPage: parseInt(perPage) });

    const ids         = data.Page.media.map(m => m.id);
    const existing    = await Movie.find({ anilistId: { $in: ids } }).select('anilistId');
    const importedSet = new Set(existing.map(m => m.anilistId));

    const formatted = data.Page.media.map(m => ({
      ...formatAniListItem(m),
      alreadyImported: importedSet.has(m.id),
    }));

    res.json({ anime: formatted, pagination: data.Page.pageInfo });

  } catch (error) {
    console.error('AniList top error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// IMPORT SINGLE ANIME
// POST /api/anilist/import
// FIX: status now uses mapStatus() — guaranteed valid enum
// FIX: averageRating capped at 10 (AniList gives 0-100, divide by 10)
// FIX: description length capped at 500 chars
// ══════════════════════════════════════════
router.post('/import', protect, adminOnly, async (req, res) => {
  try {
    const { anilistId } = req.body;
    if (!anilistId)
      return res.status(400).json({ message: 'AniList ID required' });

    const existing = await Movie.findOne({ anilistId: parseInt(anilistId) });
    if (existing) {
      return res.status(400).json({
        message: `"${existing.title}" is already imported!`,
        movie: existing,
      });
    }

    const query = `
      query ($id: Int) {
        Media(id: $id, type: ANIME) {
          id title { romaji english native }
          description(asHtml: false)
          coverImage { large extraLarge }
          bannerImage averageScore popularity
          episodes duration status season seasonYear
          startDate { year month day }
          genres
          studios(isMain: true) { nodes { name } }
          staff(sort: RELEVANCE) {
            edges { role node { name { full } } }
          }
          characters(sort: ROLE, role: MAIN) {
            nodes { name { full } }
          }
          isAdult
        }
      }`;

    const data  = await fetchAniList(query, { id: parseInt(anilistId) });
    const media = data.Media;

    if (media.isAdult)
      return res.status(400).json({ message: 'Adult content not allowed' });

    const formatted = formatAniListItem(media);

    const director = media.staff?.edges?.find(e =>
      e.role?.toLowerCase().includes('director')
    )?.node?.name?.full || '';

    const cast = (media.characters?.nodes || [])
      .slice(0, 8)
      .map(c => c.name?.full)
      .filter(Boolean);

    // FIX: Use mapStatus() — guaranteed valid enum value
    const safeStatus = mapStatus(media.status);

    const movie = await Movie.create({
      title:         formatted.title,
      description:   formatted.description,
      category:      'anime',
      genre:         formatted.genres,
      releaseYear:   formatted.year,
      duration:      media.duration || 24,
      rating:        'TV-14',
      language:      'English',
      studio:        formatted.studio,
      director,
      cast,
      thumbnailUrl:  formatted.posterUrl  || '',
      bannerUrl:     formatted.bannerUrl  || formatted.posterUrl || '',
      videoUrl:      '',
      isFeatured:    false,
      uploadedBy:    req.user._id,
      anilistId:     media.id,
      anilistScore:  formatted.score,
      totalEpisodes: media.episodes || 0,
      status:        safeStatus,
      averageRating: formatted.score > 0
        ? Math.min(10, parseFloat(formatted.score.toFixed(1)))
        : 0,
    });

    console.log(`✅ Imported: ${movie.title} (status: ${safeStatus})`);

    res.status(201).json({
      message: `"${movie.title}" imported successfully!`,
      movie,
    });

  } catch (error) {
    console.error('AniList import error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// BULK IMPORT
// POST /api/anilist/bulk-import
// FIX: Same status fix applied here
// FIX: Rate limit delay increased to 1.5s to avoid AniList 429
// ══════════════════════════════════════════
router.post('/bulk-import', protect, adminOnly, async (req, res) => {
  try {
    const { anilistIds = [] } = req.body;

    if (anilistIds.length === 0)
      return res.status(400).json({ message: 'No IDs provided' });

    if (anilistIds.length > 50)
      return res.status(400).json({ message: 'Max 50 at a time' });

    const results = { imported: [], skipped: [], failed: [] };

    for (const id of anilistIds) {
      try {
        const existing = await Movie.findOne({ anilistId: parseInt(id) });
        if (existing) {
          results.skipped.push(existing.title);
          continue;
        }

        // Rate limit — AniList allows ~30 req/min
        await new Promise(r => setTimeout(r, 1500));

        const query = `
          query ($id: Int) {
            Media(id: $id, type: ANIME) {
              id title { romaji english }
              description(asHtml: false)
              coverImage { large extraLarge }
              bannerImage averageScore
              episodes duration status
              seasonYear genres isAdult
              studios(isMain: true) { nodes { name } }
            }
          }`;

        const data  = await fetchAniList(query, { id: parseInt(id) });
        const media = data.Media;

        if (media.isAdult) {
          results.skipped.push(`ID:${id} (adult content)`);
          continue;
        }

        const formatted  = formatAniListItem(media);
        // FIX: mapStatus() applied here too
        const safeStatus = mapStatus(media.status);

        await Movie.create({
          title:         formatted.title,
          description:   formatted.description,
          category:      'anime',
          genre:         formatted.genres,
          releaseYear:   formatted.year,
          duration:      media.duration || 24,
          rating:        'TV-14',
          language:      'English',
          studio:        formatted.studio,
          thumbnailUrl:  formatted.posterUrl || '',
          bannerUrl:     formatted.bannerUrl || formatted.posterUrl || '',
          videoUrl:      '',
          uploadedBy:    req.user._id,
          anilistId:     media.id,
          anilistScore:  formatted.score,
          totalEpisodes: media.episodes || 0,
          status:        safeStatus,
          averageRating: formatted.score > 0
            ? Math.min(10, parseFloat(formatted.score.toFixed(1)))
            : 0,
        });

        results.imported.push(formatted.title);

      } catch (err) {
        console.error(`Bulk import failed for ID ${id}:`, err.message);
        results.failed.push(`ID:${id} — ${err.message}`);
      }
    }

    res.json({
      message: `Done! ${results.imported.length} imported, ${results.skipped.length} skipped, ${results.failed.length} failed`,
      results,
    });

  } catch (error) {
    console.error('Bulk import error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// FORMAT ANILIST ITEM
// FIX: statusMap replaced with mapStatus() call
// Old values 'Airing', 'Hiatus', 'Unknown' are now
// never returned — all map to valid enum values
// ══════════════════════════════════════════
function formatAniListItem(media) {
  const title  = media.title?.english || media.title?.romaji || 'Unknown';
  const studio = media.studios?.nodes?.[0]?.name || '';
  const score  = media.averageScore
    ? parseFloat((media.averageScore / 10).toFixed(1))
    : 0;
  const year = media.seasonYear ||
               media.startDate?.year ||
               new Date().getFullYear();

  // Clean HTML tags from AniList descriptions
  let description = media.description || 'No description available.';
  description = description
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim()
    .slice(0, 500);

  return {
    anilistId:   media.id,
    title,
    description,
    posterUrl:   media.coverImage?.extraLarge || media.coverImage?.large || '',
    bannerUrl:   media.bannerImage || '',
    score,
    genres:      media.genres || [],
    year,
    studio,
    episodes:    media.episodes  || 0,
    duration:    media.duration  || 24,
    // FIX: Use mapStatus() — always returns valid enum value
    status:      mapStatus(media.status),
    season:      media.season    || '',
    popularity:  media.popularity || 0,
    isAdult:     media.isAdult   || false,
  };
}

module.exports = router;