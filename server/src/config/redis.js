'use strict';

const { createClient } = require('redis');
const { logger } = require('./logger');

/**
 * Shared Redis client for cache + rate limiting.
 *
 * Graceful degradation contract (§0.5 step 17): if Redis is unreachable the API
 * stays up — callers must treat `isRedisUp() === false` as "skip cache / skip limit
 * for cache paths" rather than failing the request. Auth rate limiting must fail
 * CLOSED (reject) only if policy demands it; default here is fail-open with a warn
 * log so a Redis blip never takes the whole API down.
 */
let client = null;
let up = false;
let degradedLogged = false;

function createRedisClient() {
  const c = createClient({
    socket: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      reconnectStrategy: (retries) => Math.min(retries * 200, 5000),
    },
  });

  c.on('ready', () => {
    up = true;
    degradedLogged = false;
    logger.info({ event: 'redis:ready' }, 'Redis ready');
  });
  c.on('error', (err) => {
    const wasUp = up;
    up = false;
    if (!degradedLogged) {
      degradedLogged = true;
      logger.warn(
        { event: 'redis:error', err: err.message, wasUp },
        'Redis unavailable - caching/rate-limiting degraded, API continues',
      );
    }
  });
  c.on('end', () => {
    up = false;
  });

  return c;
}

async function connectRedis() {
  if (!client) client = createRedisClient();
  if (client.isOpen) return client;
  try {
    // Never block boot on Redis: race the connect against a short timeout.
    // The client keeps retrying in the background — if Redis comes up later,
    // 'ready' fires and caching re-enables without a restart.
    await Promise.race([
      client.connect(),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (err) {
    // Do not crash: degradation path above already logged.
    logger.warn(
      { event: 'redis:connect-failed', err: err.message },
      'Redis connect failed - continuing without cache',
    );
  }
  if (!client.isOpen) {
    logger.warn(
      { event: 'redis:timeout' },
      'Redis not ready within 3s - continuing in degraded mode',
    );
  }
  return client;
}

function getRedis() {
  return client;
}

function isRedisUp() {
  return up && !!client?.isOpen;
}

async function disconnectRedis() {
  if (client?.isOpen) {
    try {
      await client.quit();
    } catch {
      client.disconnect();
    }
    up = false;
    logger.info({ event: 'redis:closed' }, 'Redis closed');
  }
}

module.exports = { connectRedis, disconnectRedis, getRedis, isRedisUp };
