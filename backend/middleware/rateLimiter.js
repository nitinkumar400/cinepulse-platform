const crypto = require('crypto');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

function buildRateLimitHandler(message) {
  return (req, res) => {
    return res.status(429).json({
      success: false,
      message,
      data: null,
      error: 'Rate limit exceeded',
    });
  };
}

const baseConfig = {
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const ip = ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown-ip');
    const userAgent = req.get('user-agent') || 'unknown-agent';
    return crypto
      .createHash('sha256')
      .update(`${ip}:${userAgent}`)
      .digest('hex');
  },
};

const globalApiLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 250,
  skip(req) {
    return req.path.startsWith('/auth') || req.path.startsWith('/movies') || req.path.startsWith('/ai');
  },
  handler: buildRateLimitHandler('Too many requests. Please try again later.'),
});

const authLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 12,
  handler: buildRateLimitHandler('Too many authentication attempts. Please wait before trying again.'),
});

const movieLimiter = rateLimit({
  ...baseConfig,
  windowMs: 15 * 60 * 1000,
  max: 180,
  handler: buildRateLimitHandler('Too many movie requests. Please slow down and try again shortly.'),
});

const aiLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 60 * 1000,
  max: 10,
  handler: buildRateLimitHandler('Too many AI requests. Please try again later.'),
});

// WARN A-3 fix: tight limiter for /api/sync — each call triggers expensive
// TMDB + AniList API requests and MongoDB bulk writes. 5 calls per hour
// per IP is more than enough for legitimate admin use.
const syncLimiter = rateLimit({
  ...baseConfig,
  windowMs: 60 * 60 * 1000, // 1-hour window
  max: 5,
  handler: buildRateLimitHandler('Sync rate limit exceeded. Maximum 5 sync calls per hour. Please wait before trying again.'),
});

module.exports = {
  globalApiLimiter,
  authLimiter,
  movieLimiter,
  aiLimiter,
  syncLimiter,
};
