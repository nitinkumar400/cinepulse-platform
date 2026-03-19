const express = require('express');
const mongoose = require('mongoose');
const User = require('../models/User');
const WatchHistory = require('../models/WatchHistory');
const Comment = require('../models/Comment');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/me', protect, async (req, res) => {
  try {
    const [user, watchEntries, reviewCount] = await Promise.all([
      User.findById(req.user._id)
        .select('-password -verificationToken -verificationExpires -resetToken -resetExpires')
        .populate('watchlist', 'title thumbnailUrl category releaseYear averageRating duration'),
      WatchHistory.find({ user: req.user._id })
        .select('movie episode progress totalDuration completed watchedAt updatedAt')
        .populate('movie', 'title thumbnailUrl category releaseYear averageRating duration'),
      Comment.countDocuments({ user: req.user._id }),
    ]);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const watched = watchEntries.filter((entry) => entry.movie);
    const completed = watched.filter((entry) => entry.completed);

    return res.json({
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        avatar: user.avatar || null,
        avatarColor: user.avatarColor || user.avatar || null,
        avatarPreset: user.avatar?.startsWith('elite:') ? user.avatar : null,
        bio: user.bio || '',
        isVerified: user.isVerified,
        isActive: user.isActive,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin,
        watchlist: user.watchlist || [],
        watched,
        completed,
        counts: {
          watched: watched.length,
          completed: completed.length,
          watchlist: user.watchlist?.length || 0,
          reviews: reviewCount,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
});

module.exports = router;
