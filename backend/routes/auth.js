const express = require('express');
const mongoose = require('mongoose');

const User = require('../models/User');
const WatchHistory = require('../models/WatchHistory');
const Comment = require('../models/Comment');
const { protect, adminOnly, generateToken } = require('../middleware/authMiddleware');
const { validate } = require('../middleware/validate');
const {
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
} = require('../schemas/authSchemas');
const { asyncHandler, sendError, sendSuccess } = require('../utils/apiResponse');
const logger = require('../config/logger');

const router = express.Router();

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function buildUserPayload(user) {
  return {
    id: user._id,
    username: user.username,
    email: user.email,
    role: user.role,
    isVerified: user.isVerified,
    isActive: user.isActive,
    avatar: user.avatar || null,
    avatarColor: user.avatarColor || user.avatar || null,
    bio: user.bio || '',
    watchlist: user.watchlist || [],
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
  };
}

router.post('/admin/login', validate(loginSchema), asyncHandler(async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password))) {
      return sendError(res, new Error('Invalid admin email or password.'), {
        status: 401,
        code: 'INVALID_CREDENTIALS',
      });
    }

    if (user.role !== 'admin') {
      return sendError(res, new Error('Admin access required.'), {
        status: 403,
        code: 'ADMIN_REQUIRED',
      });
    }

    if (user.isActive === false) {
      return sendError(res, new Error('Admin account is disabled.'), {
        status: 403,
        code: 'ACCOUNT_SUSPENDED',
      });
    }

    if (user.isVerified === false) {
      user.isVerified = true;
    }

    user.lastLogin = new Date();
    await user.save();

    logger.info('Admin login successful', {
      userId: user._id.toString(),
      email: user.email,
    });

    return sendSuccess(res, {
      token: generateToken(user._id),
      user: buildUserPayload(user),
    }, {
      message: 'Admin login successful.',
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
}));

router.get('/me', protect, adminOnly, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id)
    .select('-password -verificationToken -verificationExpires -resetToken -resetExpires')
    .populate('watchlist', 'title thumbnailUrl category releaseYear averageRating');

  if (!user) {
    return sendError(res, new Error('Admin user not found.'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  }

  return sendSuccess(res, { user: buildUserPayload(user) });
}));

router.put('/watchlist/:movieId', protect, adminOnly, asyncHandler(async (req, res) => {
  const { movieId } = req.params;

  if (!isValidObjectId(movieId)) {
    return sendError(res, new Error('Invalid movieId.'), {
      status: 400,
      code: 'INVALID_MOVIE_ID',
    });
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return sendError(res, new Error('Admin user not found.'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  }

  const exists = user.watchlist.some((id) => id.toString() === movieId);

  if (exists) {
    user.watchlist = user.watchlist.filter((id) => id.toString() !== movieId);
    await user.save();
    return sendSuccess(res, {
      inWatchlist: false,
    }, {
      message: 'Removed from watchlist.',
    });
  }

  if (user.watchlist.length >= 500) {
    return sendError(res, new Error('Watchlist is full.'), {
      status: 400,
      code: 'WATCHLIST_LIMIT_REACHED',
    });
  }

  user.watchlist.push(movieId);
  await user.save();

  return sendSuccess(res, {
    inWatchlist: true,
  }, {
    message: 'Added to watchlist.',
  });
}));

router.put('/profile', protect, adminOnly, validate(updateProfileSchema), asyncHandler(async (req, res) => {
  const { username, avatar, bio } = req.body;
  const user = await User.findById(req.user._id);

  if (!user) {
    return sendError(res, new Error('Admin user not found.'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  }

  if (username && username !== user.username) {
    const conflict = await User.findOne({ username, _id: { $ne: user._id } });
    if (conflict) {
      return sendError(res, new Error('Username already taken.'), {
        status: 409,
        code: 'USERNAME_EXISTS',
      });
    }
    user.username = username;
  }

  if (avatar !== undefined) {
    user.avatar = avatar || user.avatar;
  }

  if (bio !== undefined) {
    user.bio = bio;
  }

  await user.save();

  return sendSuccess(res, {
    user: buildUserPayload(user),
  }, {
    message: 'Profile updated.',
  });
}));

router.put('/change-password', protect, adminOnly, validate(changePasswordSchema), asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (currentPassword === newPassword) {
    return sendError(res, new Error('New password must be different from the current password.'), {
      status: 400,
      code: 'PASSWORD_UNCHANGED',
    });
  }

  const user = await User.findById(req.user._id);
  if (!user) {
    return sendError(res, new Error('Admin user not found.'), {
      status: 404,
      code: 'USER_NOT_FOUND',
    });
  }

  const matches = await user.matchPassword(currentPassword);
  if (!matches) {
    return sendError(res, new Error('Current password is incorrect.'), {
      status: 401,
      code: 'PASSWORD_INVALID',
    });
  }

  user.password = newPassword;
  await user.save();

  return sendSuccess(res, {}, { message: 'Password changed successfully.' });
}));

router.get('/stats', protect, adminOnly, asyncHandler(async (req, res) => {
  const [watchCount, completedCount, reviewCount, user, timeAgg] = await Promise.all([
    WatchHistory.countDocuments({ user: req.user._id }),
    WatchHistory.countDocuments({ user: req.user._id, completed: true }),
    Comment.countDocuments({ user: req.user._id }),
    User.findById(req.user._id)
      .select('-password -verificationToken -verificationExpires -resetToken -resetExpires')
      .populate('watchlist', 'title thumbnailUrl category'),
    WatchHistory.aggregate([
      { $match: { user: new mongoose.Types.ObjectId(req.user._id) } },
      { $group: { _id: null, totalSeconds: { $sum: '$progress' } } },
    ]),
  ]);

  const totalSeconds = timeAgg[0]?.totalSeconds || 0;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);

  return sendSuccess(res, {
    watchCount,
    completedCount,
    inProgressCount: watchCount - completedCount,
    reviewCount,
    watchlistCount: user?.watchlist?.length || 0,
    watchlist: user?.watchlist || [],
    joinDate: user?.createdAt,
    lastLogin: user?.lastLogin,
    watchTime: {
      seconds: totalSeconds,
      minutes: totalMinutes,
      hours: totalHours,
      display: totalHours > 0
        ? `${totalHours}h ${totalMinutes % 60}m`
        : `${totalMinutes}m`,
    },
  });
}));

module.exports = router;
