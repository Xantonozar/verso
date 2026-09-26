'use strict';

const IORedis = require('ioredis');

/**
 * Dedicated ioredis connection for BullMQ (Phase 0.5 step 18).
 * BullMQ requires maxRetriesPerRequest: null — it issues blocking commands.
 */
function createBullConnection(overrides = {}) {
  return new IORedis({
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...overrides,
  });
}

module.exports = { createBullConnection };
