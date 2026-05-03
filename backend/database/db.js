const mongoose = require('mongoose');
const { getEnv } = require('../config/env');
const logger = require('../config/logger');

// Connection caching for serverless (Vercel)
let cachedConnection = null;

async function connectDB() {
  // Return cached connection if available
  if (cachedConnection && mongoose.connection.readyState === 1) {
    return cachedConnection;
  }

  const mongoUri = getEnv('MONGO_URI', 'mongodb://127.0.0.1:27017/cine-stream');

  // Serverless-optimized settings
  const options = {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    maxPoolSize: 1, // Single connection for serverless
    minPoolSize: 0,
    maxIdleTimeMS: 10000,
  };

  try {
    // Use existing connection if available
    if (mongoose.connection.readyState === 1) {
      cachedConnection = mongoose.connection;
      return cachedConnection;
    }

    const connection = await mongoose.connect(mongoUri, options);
    cachedConnection = connection;

    logger.info('MongoDB connected', {
      host: connection.connection.host,
      name: connection.connection.name,
    });

    return connection;
  } catch (error) {
    logger.error('MongoDB connection failed', { error: error.message });
    error.message = `MongoDB connection failed. Check MONGO_URI. ${error.message}`;
    throw error;
  }
}

function getMongoHealth() {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'];
  const readyState = mongoose.connection.readyState;

  return {
    enabled: true,
    state: states[readyState] || 'unknown',
    readyState,
    host: mongoose.connection.host || '',
    name: mongoose.connection.name || '',
  };
}

module.exports = connectDB;
module.exports.getMongoHealth = getMongoHealth;
