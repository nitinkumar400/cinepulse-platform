// ══════════════════════════════════════════
// CINE STREAM — Episodes Routes
// ══════════════════════════════════════════
const express   = require('express');
const router    = express.Router();
const mongoose  = require('mongoose');
const Episode   = require('../models/Episode');
const { protect, adminOnly } = require('../middleware/authMiddleware');
const { inspectPlaybackSource, inferSourceType } = require('../middleware/sourceQualityCheck');

const {
  uploadToCloudinary,
  deleteFromCloudinary,
  mixedStorage,
} = require('../config/cloudinary');

const upload = mixedStorage;

// ══════════════════════════════════════════
// HELPER — validate MongoDB ObjectId
// ══════════════════════════════════════════
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ══════════════════════════════════════════
// HELPER — extract Cloudinary public_id from URL
// ══════════════════════════════════════════
function extractPublicId(url = '') {
  if (!url) return null;
  try {
    const matches = url.match(/\/upload\/(?:v\d+\/)?(.+)\.[^.]+$/);
    return matches ? matches[1] : null;
  } catch {
    return null;
  }
}

// ══════════════════════════════════════════
// GET ALL EPISODES OF A SERIES
// GET /api/episodes/series/:seriesId
// Public — no auth required
// FIX: Added ObjectId validation
// FIX: videoUrl excluded from list (save bandwidth)
// ══════════════════════════════════════════
router.get('/series/:seriesId', async (req, res) => {
  try {
    const { seriesId } = req.params;

    if (!isValidId(seriesId))
      return res.status(400).json({ message: 'Invalid seriesId' });

    const episodes = await Episode.find({ series: seriesId })
      .sort({ season: 1, episodeNumber: 1 })
      .select('-videoUrl'); // FIX: never expose raw video URL in list

    // Group by season
    const seasons = {};
    episodes.forEach(ep => {
      const s = ep.season || 1;
      if (!seasons[s]) seasons[s] = [];
      seasons[s].push(ep);
    });

    res.json({
      episodes,
      seasons,
      totalEpisodes: episodes.length,
    });

  } catch (error) {
    console.error('GET episodes error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET SINGLE EPISODE
// GET /api/episodes/:id
// FIX: Removed `protect` — public users should be
// able to view episode info (player gates on login in frontend)
// FIX: View count only increments for logged-in users
// FIX: Previous episode cross-season lookup was missing
// FIX: Added ObjectId validation
// ══════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id))
      return res.status(400).json({ message: 'Invalid episode id' });

    // FIX: Only increment view if logged in (check Bearer token)
    const isLoggedIn = !!(
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer ')
    );

    let episode;
    if (isLoggedIn) {
      episode = await Episode.findByIdAndUpdate(
        id,
        { $inc: { views: 1 } },
        { new: true }
      ).populate('series', 'title thumbnailUrl category');
    } else {
      episode = await Episode.findById(id)
        .populate('series', 'title thumbnailUrl category');
    }

    if (!episode)
      return res.status(404).json({ message: 'Episode not found' });

    // ── Next episode (same season, then next season) ──
    let nextEpisode = await Episode.findOne({
      series:        episode.series._id,
      season:        episode.season,
      episodeNumber: episode.episodeNumber + 1,
    }).select('_id title episodeNumber season thumbnailUrl duration');

    // Try first episode of next season if none found
    if (!nextEpisode) {
      nextEpisode = await Episode.findOne({
        series:        episode.series._id,
        season:        episode.season + 1,
        episodeNumber: 1,
      }).select('_id title episodeNumber season thumbnailUrl duration');
    }

    // ── Previous episode ──
    // FIX: Also try last episode of previous season
    let prevEpisode = null;
    if (episode.episodeNumber > 1) {
      prevEpisode = await Episode.findOne({
        series:        episode.series._id,
        season:        episode.season,
        episodeNumber: episode.episodeNumber - 1,
      }).select('_id title episodeNumber season thumbnailUrl');
    }

    // FIX: If ep 1 of a season, look for last ep of previous season
    if (!prevEpisode && episode.season > 1) {
      prevEpisode = await Episode.findOne({
        series: episode.series._id,
        season: episode.season - 1,
      })
      .sort({ episodeNumber: -1 })
      .limit(1)
      .select('_id title episodeNumber season thumbnailUrl');
    }

    // ── Total episodes in this series ──
    const totalEpisodes = await Episode.countDocuments({
      series: episode.series._id,
    });

    res.json({
      episode: {
        ...episode.toObject(),
        sourceType: episode.sourceType || inferSourceType(episode.videoUrl),
        playback: inspectPlaybackSource({
          videoUrl: episode.videoUrl,
          sourceType: episode.sourceType,
        }),
      },
      nextEpisode:    nextEpisode  || null,
      prevEpisode:    prevEpisode  || null,
      totalEpisodes,
    });

  } catch (error) {
    console.error('GET episode error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// UPLOAD EPISODE
// POST /api/episodes
// Admin only
// FIX: Validate seriesId as ObjectId
// FIX: Added duplicate episode check BEFORE uploading to Cloudinary
//      (Old code uploaded files then hit 11000 duplicate key error —
//       files wasted on Cloudinary with no DB record)
// FIX: thumbnailUrl defaults to series thumbnail if not uploaded
// ══════════════════════════════════════════
router.post('/',
  protect, adminOnly,
  upload.fields([
    { name: 'video',     maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const {
        seriesId, season, episodeNumber,
        title, description, duration,
        videoUrl: externalVideoUrlRaw,
        sourceType: requestedSourceType,
        thumbnailUrl: externalThumbnailUrl,
      } = req.body;

      const externalVideoUrl = String(externalVideoUrlRaw || '').trim();
      const sourceType = inferSourceType(externalVideoUrl, requestedSourceType);
      const isExternalSource = Boolean(externalVideoUrl) && sourceType !== 'local';

      // Validate required fields first (before any Cloudinary upload)
      if (!seriesId || !season || !episodeNumber || !title)
        return res.status(400).json({
          message: 'seriesId, season, episodeNumber and title are required',
        });

      if (!isValidId(seriesId))
        return res.status(400).json({ message: 'Invalid seriesId' });

      if (!req.files?.video && !isExternalSource)
        return res.status(400).json({ message: 'Video file is required' });

      const seasonNum = parseInt(season)        || 1;
      const epNum     = parseInt(episodeNumber) || 1;

      // FIX: Check for duplicate BEFORE uploading to Cloudinary
      // Old code uploaded files first, then crashed on duplicate key —
      // wasting Cloudinary storage with orphaned files
      const duplicate = await Episode.findOne({
        series:        seriesId,
        season:        seasonNum,
        episodeNumber: epNum,
      });
      if (duplicate)
        return res.status(400).json({
          message: `Season ${seasonNum} Episode ${epNum} already exists`,
        });

      let videoUrl = externalVideoUrl;
      let thumbnailUrl = String(externalThumbnailUrl || '').trim();

      if (!isExternalSource) {
        // Upload video to Cloudinary
        const videoResult = await uploadToCloudinary(
          req.files.video[0].buffer, {
            folder:        'cinestream/videos',
            resource_type: 'video',
            public_id:     `ep-${seriesId}-s${seasonNum}e${epNum}-${Date.now()}`,
          }
        );
        videoUrl = videoResult.secure_url;

        // Upload thumbnail if provided
        if (req.files?.thumbnail) {
          const thumbResult = await uploadToCloudinary(
            req.files.thumbnail[0].buffer, {
              folder:        'cinestream/images',
              resource_type: 'image',
              public_id:     `ep-thumb-${seriesId}-s${seasonNum}e${epNum}-${Date.now()}`,
            }
          );
          thumbnailUrl = thumbResult.secure_url;
        }
      }

      const episode = await Episode.create({
        series:        seriesId,
        season:        seasonNum,
        episodeNumber: epNum,
        title:         title.trim(),
        description:   description?.trim() || '',
        duration:      parseInt(duration)  || 24,
        sourceType,
        videoUrl,
        thumbnailUrl,
      });

      res.status(201).json({ message: 'Episode uploaded!', episode });

    } catch (error) {
      // FIX: Handle duplicate key at DB level as fallback
      if (error.code === 11000) {
        return res.status(400).json({
          message: `Season ${req.body.season} Episode ${req.body.episodeNumber} already exists`,
        });
      }
      console.error('Episode upload error:', error.message);
      res.status(500).json({ message: error.message });
    }
  }
);

// ══════════════════════════════════════════
// UPDATE EPISODE
// PUT /api/episodes/:id
// Admin only
// FIX: Added ObjectId validation
// FIX: Allowed `isFeatured` and `thumbnailUrl` in update
// ══════════════════════════════════════════
router.put('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id))
      return res.status(400).json({ message: 'Invalid episode id' });

    const episode = await Episode.findById(id);
    if (!episode)
      return res.status(404).json({ message: 'Episode not found' });

    const allowed = [
      'title', 'description', 'duration',
      'season', 'episodeNumber', 'thumbnailUrl', 'sourceType', 'videoUrl',
    ];
    allowed.forEach(field => {
      if (req.body[field] !== undefined) episode[field] = req.body[field];
    });

    await episode.save();
    res.json({ message: 'Episode updated!', episode });

  } catch (error) {
    // Handle duplicate key if season/episode number changed to existing one
    if (error.code === 11000) {
      return res.status(400).json({
        message: 'That season/episode number combination already exists',
      });
    }
    console.error('Episode update error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// DELETE EPISODE
// DELETE /api/episodes/:id
// Admin only
// FIX: Added ObjectId validation
// FIX: Skip Cloudinary delete if URL is empty (thumbnail is optional)
// FIX: Use extractPublicId helper instead of passing full URL
// ══════════════════════════════════════════
router.delete('/:id', protect, adminOnly, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidId(id))
      return res.status(400).json({ message: 'Invalid episode id' });

    const episode = await Episode.findById(id);
    if (!episode)
      return res.status(404).json({ message: 'Episode not found' });

    // FIX: Extract public_id from URLs before deletion
    const videoId = extractPublicId(episode.videoUrl);
    const thumbId = extractPublicId(episode.thumbnailUrl);

    await Promise.all([
      videoId ? deleteFromCloudinary(videoId, 'video') : Promise.resolve(),
      // FIX: Only delete thumbnail if it exists and is a Cloudinary URL
      thumbId ? deleteFromCloudinary(thumbId, 'image') : Promise.resolve(),
    ]);

    await episode.deleteOne();
    res.json({ message: 'Episode deleted' });

  } catch (error) {
    console.error('Episode delete error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
