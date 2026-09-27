'use strict';

const http = require('http');
const { loadEnv, getConfig, EnvValidationError } = require('./config/env');
const { createApp } = require('./app');
const { connectMongo, disconnectMongo } = require('./config/db');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { configureCloudinary } = require('./config/cloudinary');
const { createSocketServer } = require('./sockets');
const { scheduleTrending, stopTrending } = require('./jobs/trending');
const { logger } = require('./config/logger');

async function main() {
  // Fail fast on invalid/missing env with a readable, per-field report (Phase 0.5 step 12)
  try {
    loadEnv();
  } catch (err) {
    if (err instanceof EnvValidationError) {
      // Plain console: env (incl. LOG_LEVEL) failed validation, so the logger
      // itself may be misconfigured. This must be readable regardless.
      // eslint-disable-next-line no-console
      console.error(`[FATAL] ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const config = getConfig();
  const PORT = config.PORT;

  // MongoDB is required to serve requests
  await connectMongo();

  // Redis degrades gracefully — API stays up if it's down (§0.5 step 3)
  await connectRedis();

  // Trending worker + scheduler (Phase 5 step 55) — skipped entirely when
  // Redis is down; the read path then serves the denormalized Mongo index.
  try {
    const sched = await scheduleTrending();
    if (sched.scheduled) {
      logger.info({ event: 'trending:scheduler', scheduled: true }, 'Trending scheduler up');
    }
  } catch (err) {
    logger.warn(
      { event: 'trending:scheduler-failed', err: err.message },
      'Trending scheduler failed to start - discovery still serves fallback scores',
    );
  }

  configureCloudinary();

  const app = createApp();
  const server = http.createServer(app);
  const io = createSocketServer(server, { corsOrigins: process.env.CORS_ORIGINS || '*' });

  server.listen(PORT, () => {
    logger.info({ event: 'server:listening', port: PORT }, `Verso API listening on :${PORT}`);
  });

  const shutdown = async (signal) => {
    logger.info({ event: 'server:shutdown', signal }, 'Shutting down');
    io.close();
    await stopTrending();
    server.close(async () => {
      await disconnectRedis();
      await disconnectMongo();
      process.exit(0);
    });
    // Hard exit if connections hang
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ event: 'process:unhandled-rejection', reason }, 'Unhandled rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ event: 'process:uncaught-exception', err }, 'Uncaught exception');
    process.exit(1);
  });

  return { app, server, io };
}

if (require.main === module) {
  main().catch((err) => {
    logger.fatal({ event: 'boot:failed', err: err.message, stack: err.stack }, 'Boot failed');
    process.exit(1);
  });
}

module.exports = { main };
