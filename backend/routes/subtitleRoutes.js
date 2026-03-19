// ══════════════════════════════════════════
// CINE STREAM — Subtitle Routes
// backend/routes/subtitleRoutes.js
// ══════════════════════════════════════════
const express   = require('express');
const router    = express.Router();
const mongoose  = require('mongoose');
const path      = require('path');
const fs        = require('fs');
const { getSubtitles } = require('youtube-captions-scraper');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { searchSubtitles, downloadAndConvert } = require('../services/subtitleService');
const { inferSourceType } = require('../middleware/sourceQualityCheck');

// ══════════════════════════════════════════
// MONGOOSE MODEL — StoredSubtitle
// Stores downloaded .vtt files so we never
// re-download the same subtitle twice
// ══════════════════════════════════════════
const StoredSubtitleSchema = new mongoose.Schema({
  fileId:    { type: String, required: true, unique: true, index: true },
  vttUrl:    { type: String, required: true },
  language:  { type: String, default: 'en' },
  title:     { type: String, default: '' },
  movieId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Movie', default: null },
  downloads: { type: Number, default: 1 },
  createdAt: { type: Date,   default: Date.now },
}, { suppressReservedKeysWarning: true });

const StoredSubtitle = mongoose.models.StoredSubtitle
  || mongoose.model('StoredSubtitle', StoredSubtitleSchema);

const YOUTUBE_ID_REGEX = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i;
const DAILYMOTION_ID_REGEX = /(?:dailymotion\.com\/(?:video|embed\/video)\/|dai\.ly\/)([A-Za-z0-9]+)/i;
function extractProviderVideoId(url = '', sourceType = '') {
  try {
    const normalizedType = inferSourceType(url, sourceType);
    if (normalizedType === 'youtube') {
      return String(url).match(YOUTUBE_ID_REGEX)?.[1] || '';
    }
    if (normalizedType === 'dailymotion') {
      return String(url).match(DAILYMOTION_ID_REGEX)?.[1] || '';
    }
    return '';
  } catch {
    return '';
  }
}

function formatTimestamp(seconds) {
  try {
    const totalMs = Math.max(0, Math.round(Number(seconds || 0) * 1000));
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const millis = totalMs % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  } catch {
    return '00:00:00.000';
  }
}

function toWebVtt(captions = []) {
  try {
    const body = captions.map((caption, index) => {
      const start = Number(caption.start || 0);
      const duration = Number(caption.dur || caption.duration || 0);
      const end = start + duration;
      return `${index + 1}\n${formatTimestamp(start)} --> ${formatTimestamp(end)}\n${String(caption.text || '').trim()}\n`;
    }).join('\n');
    return `WEBVTT\n\n${body}`.trim();
  } catch {
    return 'WEBVTT';
  }
}

async function fetchYoutubeTracks(videoId, langs = []) {
  const requestedLangs = langs.length ? langs : ['en'];
  const tracks = [];

  for (const lang of requestedLangs) {
    try {
      const captions = await getSubtitles({ videoID: videoId, lang });
      if (!captions?.length) continue;
      tracks.push({
        language: lang,
        label: lang.toUpperCase(),
        vtt: toWebVtt(captions),
      });
    } catch {}
  }

  return tracks;
}

async function fetchDailymotionTracks(videoId, langs = []) {
  try {
    const response = await fetch(`https://api.dailymotion.com/video/${videoId}/subtitles`);
    if (!response.ok) throw new Error('Failed to fetch Dailymotion subtitles');
    const payload = await response.json();
    const entries = Array.isArray(payload.list) ? payload.list : [];
    const requested = langs.length ? new Set(langs.map((lang) => lang.toLowerCase())) : null;
    const tracks = [];

    for (const entry of entries) {
      try {
        const language = String(entry.language || '').toLowerCase();
        if (requested && !requested.has(language)) continue;
        if (!entry.url) continue;
        const subtitleResponse = await fetch(entry.url);
        if (!subtitleResponse.ok) continue;
        const vtt = await subtitleResponse.text();
        tracks.push({
          language,
          label: String(entry.language || language || 'Subtitle').toUpperCase(),
          vtt,
        });
      } catch {}
    }

    return tracks;
  } catch (error) {
    throw error;
  }
}

router.get('/', async (req, res) => {
  try {
    const url = String(req.query.url || '').trim();
    const sourceType = String(req.query.sourceType || '').trim().toLowerCase();
    const langs = String(req.query.langs || 'en')
      .split(',')
      .map((lang) => lang.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);

    if (!url) {
      return res.status(400).json({ message: 'url is required' });
    }

    const normalizedSourceType = inferSourceType(url, sourceType);
    const videoId = extractProviderVideoId(url, normalizedSourceType);
    if (!videoId) {
      return res.status(200).json({
        sourceType: normalizedSourceType,
        videoId: '',
        tracks: [],
      });
    }

    let tracks = [];
    if (normalizedSourceType === 'youtube') {
      tracks = await fetchYoutubeTracks(videoId, langs);
    } else if (normalizedSourceType === 'dailymotion') {
      tracks = await fetchDailymotionTracks(videoId, langs);
    }

    const payload = {
      sourceType: normalizedSourceType,
      videoId,
      tracks,
    };

    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: error.message || 'Subtitle provider lookup failed' });
  }
});

// ══════════════════════════════════════════
// GET /api/subtitles/search/:title
// Search OpenSubtitles by movie title
//
// Query params:
//   ?lang=en          (default: en)
//   ?langs=en,hi,ja   (multiple, comma separated)
//
// Returns: array of subtitle options the user
//   can pick from before downloading
//
// Auth: requires login (prevent API abuse)
// ══════════════════════════════════════════
router.get('/search/:title', protect, async (req, res) => {
  try {
    const title = decodeURIComponent(req.params.title).trim();
    if (!title) return res.status(400).json({ message: 'Title is required' });

    // Support multiple languages via ?langs=en,hi,ja
    const multiLang  = req.query.langs;
    const singleLang = req.query.lang || 'en';

    let results = [];

    if (multiLang) {
      // Fetch each language in parallel (max 3 to avoid rate limits)
      const langs   = multiLang.split(',').slice(0, 3).map(l => l.trim());
      const batches = await Promise.allSettled(
        langs.map(lang => searchSubtitles(title, lang))
      );
      batches.forEach(b => {
        if (b.status === 'fulfilled') results.push(...b.value);
      });
    } else {
      results = await searchSubtitles(title, singleLang);
    }

    // Check which fileIds are already downloaded
    const fileIds       = results.map(r => r.file_id);
    const alreadyStored = await StoredSubtitle.find({ fileId: { $in: fileIds } })
      .select('fileId vttUrl').lean();
    const storedMap     = new Map(alreadyStored.map(c => [c.fileId, c.vttUrl]));

    // Enrich results with cached flag
    const enriched = results.map(r => ({
      ...r,
      already_downloaded: storedMap.has(String(r.file_id)),
      subtitle_url:       storedMap.get(String(r.file_id)) || null,
    }));

    res.json({
      query:   title,
      total:   enriched.length,
      results: enriched,
    });

  } catch (err) {
    console.error('[Subtitles] Search error:', err.message);

    if (err.response?.status === 401) {
      return res.status(502).json({ message: 'Invalid OpenSubtitles API key — check OPENSUB_API_KEY in .env' });
    }
    if (err.response?.status === 429) {
      return res.status(429).json({ message: 'OpenSubtitles rate limit reached — wait 1 minute' });
    }
    res.status(500).json({ message: err.message || 'Subtitle search failed' });
  }
});

// ══════════════════════════════════════════
// GET /api/subtitles/download/:fileId
// Downloads subtitle, converts to .vtt,
// saves to MongoDB, returns file URL
//
// Query params:
//   ?lang=en        (stored in DB, optional)
//   ?title=Naruto   (stored in DB, optional)
//   ?movieId=xxx    (links subtitle to a movie, optional)
//
// Auth: requires login
// ══════════════════════════════════════════
router.get('/download/:fileId', protect, async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) return res.status(400).json({ message: 'fileId is required' });

    // Check MongoDB first — prevent duplicate downloads
    const existing = await StoredSubtitle.findOne({ fileId });
    if (existing) {
      // Verify the .vtt file still exists on disk
      const diskPath = path.join(__dirname, '..', existing.vttUrl.replace(/^[\\/]+/, ''));
      if (fs.existsSync(diskPath)) {
        await StoredSubtitle.updateOne({ fileId }, { $inc: { downloads: 1 } });
        return res.json({
          message:  'Subtitle ready',
          url:      existing.vttUrl,
          fileId,
          language: existing.language,
          alreadyDownloaded: true,
        });
      }
      // File missing from disk — delete DB record and re-download
      await StoredSubtitle.deleteOne({ fileId });
    }

    // Download + convert
    const result = await downloadAndConvert(fileId);

    // Save to MongoDB
    await StoredSubtitle.create({
      fileId,
      vttUrl:   result.url,
      language: req.query.lang    || 'en',
      title:    req.query.title   || '',
      movieId:  req.query.movieId || null,
    });

    res.json({
      message:  'Subtitle downloaded and converted',
      url:      result.url,
      fileId,
      language: req.query.lang || 'en',
      alreadyDownloaded: false,
    });

  } catch (err) {
    console.error('[Subtitles] Download error:', err.message);

    if (err.response?.status === 401) {
      return res.status(502).json({ message: 'Invalid OpenSubtitles API key' });
    }
    if (err.response?.status === 406) {
      return res.status(400).json({ message: 'Daily download limit reached on your OpenSubtitles account' });
    }
    if (err.response?.status === 429) {
      return res.status(429).json({ message: 'OpenSubtitles rate limit — wait 1 minute' });
    }
    res.status(500).json({ message: err.message || 'Subtitle download failed' });
  }
});

// ══════════════════════════════════════════
// GET /api/subtitles/movie/:movieId
// Get all stored subtitles for a movie
// Used by frontend to auto-load subtitle tracks
// ══════════════════════════════════════════
router.get('/movie/:movieId', async (req, res) => {
  try {
    const subs = await StoredSubtitle.find({
      movieId: req.params.movieId,
    }).select('fileId vttUrl language title').lean();

    res.json({ subtitles: subs });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ══════════════════════════════════════════
// DELETE /api/subtitles/:fileId
// Admin only — delete a stored subtitle
// ══════════════════════════════════════════
router.delete('/:fileId', protect, adminOnly, async (req, res) => {
  try {
    const { fileId } = req.params;
    const sub = await StoredSubtitle.findOneAndDelete({ fileId });

    if (sub) {
      // Delete .vtt from disk too
      const diskPath = path.join(__dirname, '..', sub.vttUrl.replace(/^[\\/]+/, ''));
      if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
    }

    res.json({ message: 'Subtitle deleted', fileId });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
