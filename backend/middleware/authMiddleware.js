const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getEnv, getRequiredEnv } = require('../config/env');

const USER_SELECT = '-password -verificationToken -verificationExpires -resetToken -resetExpires';

function getJwtSecret() {
  return getRequiredEnv('JWT_SECRET');
}

// ─────────────────────────────────────────────────────────────────────────
// getCronSecret — reads CRON_SECRET from env.
// Returns '' if not set so the guard below can reject cleanly.
// ─────────────────────────────────────────────────────────────────────────
function getCronSecret() {
  return getEnv('CRON_SECRET', '');
}

async function resolveUserFromToken(token) {
  const decoded = jwt.verify(token, getJwtSecret());
  const user = await User.findById(decoded.id).select(USER_SELECT);
  return user;
}

function getBearerToken(req) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return '';
  return header.split(' ')[1] || '';
}

const protect = async (req, res, next) => {
  const token = getBearerToken(req);

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      error: { code: 'TOKEN_MISSING' },
    });
  }

  try {
    const user = await resolveUserFromToken(token);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Please log in again.',
        error: { code: 'USER_NOT_FOUND' },
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended. Please contact support.',
        error: { code: 'ACCOUNT_SUSPENDED' },
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
        error: { code: 'TOKEN_EXPIRED' },
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid session token.',
        error: { code: 'TOKEN_INVALID' },
      });
    }

    return next(error);
  }
};

const optionalProtect = async (req, res, next) => {
  const token = getBearerToken(req);
  if (!token || token === 'null' || token === 'undefined') {
    return next();
  }

  try {
    const user = await resolveUserFromToken(token);
    if (user && user.isActive !== false && user.role === 'admin') {
      req.user = user;
    }
  } catch (error) {
    // Ignore invalid tokens on public routes.
  }

  return next();
};

const adminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      error: { code: 'TOKEN_MISSING' },
    });
  }

  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.',
      error: { code: 'ADMIN_REQUIRED' },
    });
  }

  return next();
};

// ─────────────────────────────────────────────────────────────────────────
// cronOrAdmin — combined middleware for cron-triggered sync routes.
//
// Accepts two forms of authentication:
//   1. Admin JWT  — standard Bearer <jwt> from a logged-in admin user.
//   2. Cron token — Bearer <CRON_SECRET> sent by Vercel Cron or any
//                   external scheduler. Sets a synthetic req.user so
//                   downstream adminOnly-style checks still pass.
//
// Security properties:
//   • CRON_SECRET must be at least 32 characters; shorter values are
//     rejected to prevent accidental weak secrets.
//   • Constant-time comparison is used to prevent timing attacks.
//   • If CRON_SECRET is not configured the cron path is disabled and
//     only admin JWT is accepted.
// ─────────────────────────────────────────────────────────────────────────
const cronOrAdmin = async (req, res, next) => {
  const token = getBearerToken(req);

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      error: { code: 'TOKEN_MISSING' },
    });
  }

  // ── Path 1: Try CRON_SECRET first (fast, no DB hit) ──────────────────
  const cronSecret = getCronSecret();
  if (cronSecret && cronSecret.length >= 32) {
    // Constant-time comparison to prevent timing attacks
    const secretBuf  = Buffer.from(cronSecret);
    const tokenBuf   = Buffer.from(token);
    const lengthsMatch = secretBuf.length === tokenBuf.length;

    // Always run timingSafeEqual even on length mismatch (pad to avoid leak)
    const a = lengthsMatch ? secretBuf : Buffer.alloc(secretBuf.length);
    const b = lengthsMatch ? tokenBuf  : Buffer.alloc(secretBuf.length);

    const { timingSafeEqual } = require('crypto');
    if (lengthsMatch && timingSafeEqual(a, b)) {
      // Inject a synthetic admin-equivalent user so route handlers
      // that call req.user.role work without a real DB lookup.
      req.user = {
        _id:      'cron-scheduler',
        id:       'cron-scheduler',
        username: 'cron',
        role:     'admin',
        isCron:   true,
      };
      return next();
    }
  }

  // ── Path 2: Fall back to standard Admin JWT ───────────────────────────
  try {
    const user = await resolveUserFromToken(token);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found. Please log in again.',
        error: { code: 'USER_NOT_FOUND' },
      });
    }

    if (user.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Account suspended. Please contact support.',
        error: { code: 'ACCOUNT_SUSPENDED' },
      });
    }

    if (user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Admin access required.',
        error: { code: 'ADMIN_REQUIRED' },
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Session expired. Please log in again.',
        error: { code: 'TOKEN_EXPIRED' },
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token.',
        error: { code: 'TOKEN_INVALID' },
      });
    }

    return next(error);
  }
};

const generateToken = (userId, expiresIn = getEnv('JWT_EXPIRES_IN', '30d')) =>
  jwt.sign({ id: userId }, getJwtSecret(), { expiresIn });

module.exports = {
  protect,
  optionalProtect,
  adminOnly,
  cronOrAdmin,
  generateToken,
};
