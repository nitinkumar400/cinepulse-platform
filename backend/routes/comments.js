// ══════════════════════════════════════════
// CINE STREAM — Comments Routes
// ══════════════════════════════════════════
const express   = require('express');
const router    = express.Router();
const mongoose  = require('mongoose');
const Comment   = require('../models/Comment');
const { protect } = require('../middleware/authMiddleware');

// ══════════════════════════════════════════
// HELPER — validate MongoDB ObjectId
// FIX: prevents CastError crash on bad IDs
// ══════════════════════════════════════════
const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ══════════════════════════════════════════
// GET COMMENTS
// GET /api/comments/movie/:movieId
// Public — no auth required
// FIX: total was returning page count not real total
// FIX: Added ObjectId validation
// FIX: Added totalPages for frontend pagination
// ══════════════════════════════════════════
router.get('/movie/:movieId', async (req, res) => {
  try {
    const { movieId } = req.params;

    // FIX: validate ID first — bad ID crashes Mongoose with CastError
    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    const { limit = 50, page = 1, sort = 'newest' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // FIX: sort options — most liked + newest both useful
    const sortOptions = {
      newest:     { createdAt: -1 },
      oldest:     { createdAt:  1 },
      most_liked: { likes: -1   },
      highest:    { rating: -1  },
    };
    const sortBy = sortOptions[sort] || sortOptions.newest;

    // FIX: count total docs separately — comments.length only counts current page
    const [comments, total] = await Promise.all([
      Comment.find({ movie: movieId })
        .populate('user', 'username avatar avatarColor')
        .sort(sortBy)
        .skip(skip)
        .limit(parseInt(limit)),
      Comment.countDocuments({ movie: movieId }),
    ]);

    res.json({
      comments,
      total,
      // FIX: Added pagination meta for frontend
      pagination: {
        total,
        page:  parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
        limit: parseInt(limit),
      },
    });

  } catch (error) {
    console.error('GET comments error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// POST COMMENT
// POST /api/comments/movie/:movieId
// Auth required
// FIX: Added ObjectId validation
// FIX: Sanitize text — strip leading/trailing whitespace consistently
// FIX: Integer rating cast (parseFloat could allow 4.5)
// ══════════════════════════════════════════
router.post('/movie/:movieId', protect, async (req, res) => {
  try {
    const { movieId } = req.params;

    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    const { text, rating } = req.body;
    const cleanText = (text || '').trim();

    if (!cleanText || cleanText.length < 3)
      return res.status(400).json({ message: 'Review is too short (min 3 chars)' });

    if (cleanText.length > 500)
      return res.status(400).json({ message: 'Review too long (max 500 chars)' });

    // FIX: Use parseInt not raw value — prevents float ratings like 4.5
    const ratingNum = rating ? parseInt(rating) : null;
    if (ratingNum !== null && (ratingNum < 1 || ratingNum > 5))
      return res.status(400).json({ message: 'Rating must be 1–5' });

    // One review per user per movie
    const already = await Comment.findOne({
      movie: movieId,
      user:  req.user._id,
    });
    if (already)
      return res.status(400).json({ message: 'You already reviewed this title' });

    const comment = await Comment.create({
      movie:  movieId,
      user:   req.user._id,
      text:   cleanText,
      rating: ratingNum,
    });

    await comment.populate('user', 'username avatar avatarColor');

    res.status(201).json({ message: 'Review posted!', comment });

  } catch (error) {
    console.error('POST comment error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// DELETE COMMENT
// DELETE /api/comments/movie/:movieId/:commentId
// Auth required — owner or admin only
// FIX: Added ObjectId validation on commentId
// FIX: Verify comment belongs to this movie (prevents cross-movie deletion)
// ══════════════════════════════════════════
router.delete('/movie/:movieId/:commentId', protect, async (req, res) => {
  try {
    const { movieId, commentId } = req.params;

    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    if (!isValidId(commentId))
      return res.status(400).json({ message: 'Invalid commentId' });

    const comment = await Comment.findById(commentId);
    if (!comment)
      return res.status(404).json({ message: 'Comment not found' });

    // FIX: Verify comment actually belongs to this movie
    // Without this, someone could delete any comment by swapping the movieId
    if (comment.movie.toString() !== movieId)
      return res.status(404).json({ message: 'Comment not found for this movie' });

    const isOwner = comment.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAdmin)
      return res.status(403).json({ message: 'Not allowed to delete this review' });

    await comment.deleteOne();
    res.json({ message: 'Review deleted' });

  } catch (error) {
    console.error('DELETE comment error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// LIKE / UNLIKE COMMENT
// PUT /api/comments/movie/:movieId/:commentId/like
// Auth required
// FIX: likedBy initialisation was a runtime patch — now relies on model default
// FIX: Added ObjectId validation
// FIX: likes count is now derived from likedBy.length (single source of truth)
//       instead of a separate counter that can drift out of sync
// ══════════════════════════════════════════
router.put('/movie/:movieId/:commentId/like', protect, async (req, res) => {
  try {
    const { movieId, commentId } = req.params;

    if (!isValidId(movieId))
      return res.status(400).json({ message: 'Invalid movieId' });

    if (!isValidId(commentId))
      return res.status(400).json({ message: 'Invalid commentId' });

    const comment = await Comment.findById(commentId);
    if (!comment)
      return res.status(404).json({ message: 'Comment not found' });

    const userId = req.user._id.toString();

    // FIX: likedBy should always be an array — rely on model schema default
    // The old runtime `if (!comment.likedBy) comment.likedBy = []` was a red flag
    // that the model schema was incomplete. Now the model guarantees it exists.
    const likedByStrings = (comment.likedBy || []).map(id => id.toString());
    const alreadyLiked   = likedByStrings.includes(userId);

    if (alreadyLiked) {
      // Unlike — remove from array
      comment.likedBy = comment.likedBy.filter(
        id => id.toString() !== userId
      );
    } else {
      // Like — add to array
      comment.likedBy.push(req.user._id);

      // Notify comment owner (non-blocking — failure never breaks the like)
      if (comment.user.toString() !== userId) {
        try {
          const { sendNotification } = require('../notificationHelper');
          await sendNotification({
            userId:  comment.user,
            type:    'review_liked',
            title:   '❤️ Someone liked your review!',
            message: `${req.user.username} liked your review.`,
            link:    `/pages/movie-details.html?id=${movieId}`,
          });
        } catch (err) { /* Notification failure is silent */ }
      }
    }

    // FIX: Derive likes count from likedBy.length — single source of truth
    // Old code kept a separate `likes` counter that could drift out of sync
    // if the server crashed between incrementing `likes` and saving `likedBy`
    comment.likes = comment.likedBy.length;

    await comment.save();

    res.json({
      likes:  comment.likes,
      liked:  !alreadyLiked,
    });

  } catch (error) {
    console.error('Like comment error:', error.message);
    res.status(500).json({ message: error.message });
  }
});

// ══════════════════════════════════════════
// GET TOP REVIEWS (for homepage / featured)
// GET /api/comments/top
// Public — no auth required
// FIX: This was completely missing
// Dashboard can use this to show "top reviews" section
// ══════════════════════════════════════════
router.get('/top', async (req, res) => {
  try {
    const { limit = 6 } = req.query;

    const top = await Comment.find({ likes: { $gt: 0 } })
      .populate('user',  'username avatar avatarColor')
      .populate('movie', 'title thumbnailUrl category')
      .sort({ likes: -1, rating: -1 })
      .limit(parseInt(limit));

    // Filter out any where movie/user was deleted
    const valid = top.filter(c => c.movie && c.user);

    res.json({ comments: valid });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;