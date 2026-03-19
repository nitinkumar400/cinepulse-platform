const mongoose = require('mongoose');
const { getEnv } = require('../config/env');
const logger = require('../config/logger');

async function connectDB() {
  const mongoUri = getEnv('MONGO_URI', 'mongodb://127.0.0.1:27017/cine-stream');

  try {
    const connection = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 10000,
      maxPoolSize: 10,
    });

    logger.info('MongoDB connected', {
      host: connection.connection.host,
      name: connection.connection.name,
    });

    return connection;
  } catch (error) {
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
