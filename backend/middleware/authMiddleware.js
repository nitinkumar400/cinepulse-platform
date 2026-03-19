const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { getEnv, getRequiredEnv } = require('../config/env');

const USER_SELECT = '-password -verificationToken -verificationExpires -resetToken -resetExpires';

function getJwtSecret() {
  return getRequiredEnv('JWT_SECRET');
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

const generateToken = (userId, expiresIn = getEnv('JWT_EXPIRES_IN', '30d')) =>
  jwt.sign({ id: userId }, getJwtSecret(), { expiresIn });

module.exports = {
  protect,
  optionalProtect,
  adminOnly,
  generateToken,
};
