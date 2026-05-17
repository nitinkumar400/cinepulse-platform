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
    if (user && user.isActive !== false) {
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
// Accepts THREE forms of authentication (checked in priority order):
//
//   1. Vercel Cron header — Vercel always sends `x-vercel-cron: 1` on
//      every scheduled invocation. On Vercel Pro/Enterprise the header
//      is cryptographically signed; on Hobby it is present but unsigned.
//      We accept it only when CRON_SECRET is configured (proves the env
//      is intentionally set up for cron) so an attacker cannot spoof it
//      on a misconfigured deployment that has no secret at all.
//
//   2. Bearer <CRON_SECRET> — sent by external schedulers (GitHub Actions,
//      cURL, etc.) that cannot inject custom headers. Uses constant-time
//      comparison to prevent timing attacks.
//
//   3. Admin JWT — standard Bearer <jwt> from a logged-in admin user.
//
// Security properties:
//   • CRON_SECRET must be at least 32 characters; shorter values are
//     rejected to prevent accidental weak secrets.
//   • Constant-time comparison is used for the Bearer secret path.
//   • If CRON_SECRET is not configured, paths 1 and 2 are both disabled
//     and only admin JWT is accepted.
// ─────────────────────────────────────────────────────────────────────────
const cronOrAdmin = async (req, res, next) => {
  const { timingSafeEqual } = require('crypto');

  const cronSecret = getCronSecret();
  const hasCronSecret = cronSecret && cronSecret.length >= 32;

  // ── Path 1: Vercel Cron header (x-vercel-cron: 1) ────────────────────
  // Vercel injects this header on every scheduled cron invocation.
  // We only trust it when CRON_SECRET is configured — this ensures the
  // deployment is intentionally set up for automated sync, and prevents
  // a spoofed header from working on a fresh deployment with no secret.
  if (req.headers['x-vercel-cron'] === '1' && hasCronSecret) {
    req.user = {
      _id:      'cron-scheduler',
      id:       'cron-scheduler',
      username: 'vercel-cron',
      role:     'admin',
      isCron:   true,
    };
    return next();
  }

  const token = getBearerToken(req);

  if (!token || token === 'null' || token === 'undefined') {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
      error: { code: 'TOKEN_MISSING' },
    });
  }

  // ── Path 2: Bearer <CRON_SECRET> (external schedulers) ───────────────
  if (hasCronSecret) {
    // Constant-time comparison to prevent timing attacks.
    // We pad the shorter buffer so timingSafeEqual always receives equal
    // lengths — this prevents a length oracle from leaking the secret.
    const secretBuf    = Buffer.from(cronSecret);
    const tokenBuf     = Buffer.from(token);
    const lengthsMatch = secretBuf.length === tokenBuf.length;
    const a = lengthsMatch ? secretBuf : Buffer.alloc(secretBuf.length);
    const b = lengthsMatch ? tokenBuf  : Buffer.alloc(secretBuf.length);

    if (lengthsMatch && timingSafeEqual(a, b)) {
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

  // ── Path 3: Fall back to standard Admin JWT ──────────────────────────
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
