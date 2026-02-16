// config/database.js
const mongoose = require('mongoose');
const logger = require('../utils/logger');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      throw new Error('MONGODB_URI is not set in environment');
    }

    // Recommended connection options for Mongoose 6/7: do not pass useNewUrlParser/useUnifiedTopology
    const conn = await mongoose.connect(mongoUri, {
      // no useNewUrlParser, no useUnifiedTopology — those are unsupported in modern Mongoose
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
      family: 4 // optional: force IPv4 if your environment needs it; remove if unsure
    });

    logger.info(`MongoDB Connected: ${conn.connection.host}`);

    mongoose.connection.on('connected', () => logger.info('Mongoose connected to DB'));
    mongoose.connection.on('error', (err) => logger.error(`Mongoose connection error: ${err.message}`));
    mongoose.connection.on('disconnected', () => logger.warn('Mongoose disconnected'));

    process.on('SIGINT', async () => {
      await mongoose.connection.close();
      logger.info('MongoDB connection closed through app termination');
      process.exit(0);
    });

    return conn;
  } catch (error) {
    logger.error(`MongoDB Connection Error: ${error.message}`);
    // optional: retry logic
    setTimeout(connectDB, 5000);
  }
};

module.exports = connectDB;
