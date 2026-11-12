const mongoose = require('mongoose');
const logger = require('../utils/logger');

/** MongoDB connection. ClassKit's ledger lives here, so the app refuses to start without it. */
class Database {
  constructor() { this.connected = false; }

  async connect(uri = process.env.MONGODB_URI) {
    if (!uri) {
      logger.error('MONGODB_URI is not set. ClassKit cannot run without a database.');
      process.exit(1);
    }
    await mongoose.connect(uri);
    this.connected = true;
    logger.info('✅ MongoDB connected');
    mongoose.connection.on('disconnected', () => { this.connected = false; logger.warn('MongoDB disconnected'); });
    mongoose.connection.on('reconnected', () => { this.connected = true; logger.info('MongoDB reconnected'); });
  }

  isConnected() { return this.connected && mongoose.connection.readyState === 1; }
}

module.exports = new Database();
