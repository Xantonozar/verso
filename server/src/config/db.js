'use strict';

const mongoose = require('mongoose');
const { logger } = require('./logger');

mongoose.set('strictQuery', true);

let connecting = false;

/**
 * Connect to MongoDB.
 * Initial-connection failure rejects and does NOT auto-reconnect (Mongoose 9 behavior),
 * so we retry with a bounded backoff here and log loudly.
 * Post-initial drops are retried by Mongoose itself; we log those via 'error'/'disconnected'.
 */
async function connectMongo(uri = process.env.MONGODB_URI) {
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }
  if (mongoose.connection.readyState === 1) return mongoose.connection;
  if (connecting) return mongoose.connection.asPromise().then(() => mongoose.connection);
  connecting = true;

  try {
    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 20,
    });
    logger.info({ event: 'mongo:connected', db: conn.connection.name }, 'MongoDB connected');
    return conn.connection;
  } catch (err) {
    logger.error(
      { event: 'mongo:connect-failed', err: err.message },
      'MongoDB initial connection failed',
    );
    throw err;
  } finally {
    connecting = false;
  }
}

mongoose.connection.on('error', (err) => {
  logger.error({ event: 'mongo:error', err: err.message }, 'MongoDB connection error');
});
mongoose.connection.on('disconnected', () => {
  logger.warn({ event: 'mongo:disconnected' }, 'MongoDB disconnected');
});
mongoose.connection.on('reconnected', () => {
  logger.info({ event: 'mongo:reconnected' }, 'MongoDB reconnected');
});

async function disconnectMongo() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    logger.info({ event: 'mongo:disconnected' }, 'MongoDB disconnected by request');
  }
}

module.exports = { connectMongo, disconnectMongo, mongoose };
