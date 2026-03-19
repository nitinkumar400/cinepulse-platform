const User = require('../models/User');
const logger = require('../config/logger');
const { getEnv, runtime } = require('../config/env');

async function ensureAdminAccount() {
  const existingAdmin = await User.findOne({ role: 'admin' }).select('_id email username').lean();
  if (existingAdmin) {
    return existingAdmin;
  }

  const username = getEnv('ADMIN_USERNAME', runtime === 'production' ? '' : 'admin');
  const email = getEnv('ADMIN_EMAIL', runtime === 'production' ? '' : 'admin@cinestream.local');
  const password = getEnv('ADMIN_PASSWORD', runtime === 'production' ? '' : 'Admin@12345');

  if (!username || !email || !password) {
    logger.warn('Admin bootstrap skipped because ADMIN_USERNAME, ADMIN_EMAIL, or ADMIN_PASSWORD is missing');
    return null;
  }

  const adminUser = await User.create({
    username,
    email,
    password,
    role: 'admin',
    isVerified: true,
    isActive: true,
  });

  logger.warn('Bootstrap admin account created', {
    userId: adminUser._id.toString(),
    email: adminUser.email,
    username: adminUser.username,
  });

  return adminUser;
}

module.exports = {
  ensureAdminAccount,
};
