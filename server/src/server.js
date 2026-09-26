'use strict';

require('./config/loadEnv');

const http = require('http');
const { createApp } = require('./app');
const { connectMongo, disconnectMongo } = require('./config/db');
const { connectRedis, disconnectRedis } = require('./config/redis');
const { configureCloudinary } = require('./config/cloudinary');
const { createSocketServer } = require('./sockets');
const { logger } = require('./config/logger');

const PORT = Number(process.env.PORT) || 4000;

async function main() {
  // Fail fast on missing critical env (full schema validation arrives in Phase 0.5 step 12)
  for (const key of ['MONGODB_URI', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (!process.env[key]) {
      logger.fatal({ event: 'boot:missing-env', key }, `Missing required env var: ${key}`);
      process.exit(1);
    }
  }

  // MongoDB is required to serve requests
  await connectMongo();

  // Redis degrades gracefully — API stays up if it's down (§0.5 step 3)
  await connectRedis();

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
