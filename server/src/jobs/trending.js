'use strict';

const { logger } = require('../config/logger');
const { isRedisUp } = require('../config/redis');
const { getQueue, enqueue } = require('./queues');
const { createWorker } = require('./worker');
const { createBullConnection } = require('./connection');
const {
  getTrending,
  runTrendingRefresh,
} = require('../modules/discover/discover.service');

/**
 * Trending scheduler (Phase 5, plan step 55): a repeatable BullMQ job that
 * recomputes and denormalizes `trendingScore` on Poem every 5 minutes, so
 * GET /discover/trending reads a precomputed index (§8.6) — never
 * scan+score at request time (§10.75). Redis down → scheduler is skipped at
 * boot and the read path already degrades to the denormalized Mongo index.
 */
const QUEUE_NAME = 'verso:trending';
const JOB_NAME = 'trending-refresh';
const SCHEDULER_ID = 'trending-refresh-every-5m';
const EVERY_MS = 5 * 60 * 1000;

let connection = null;
let worker = null;

async function processTrendingRefresh() {
  const { durationMs, records } = await runTrendingRefresh();
  return { durationMs, records };
}

/** Boot helper — idempotent (upsertJobScheduler) + one immediate warm-up run. */
async function scheduleTrending() {
  if (!isRedisUp()) return { scheduled: false, reason: 'redis-down' };
  if (!connection) connection = createBullConnection();
  const queue = getQueue(QUEUE_NAME, connection);
  await queue.upsertJobScheduler(SCHEDULER_ID, { every: EVERY_MS }, {
    name: JOB_NAME,
    data: {},
  });
  await enqueue(queue, JOB_NAME, {});
  if (!worker) worker = createWorker(QUEUE_NAME, processTrendingRefresh, { connection, concurrency: 1 });
  logger.info(
    { event: 'trending:scheduled', queue: QUEUE_NAME, everyMs: EVERY_MS },
    'Trending refresh scheduled',
  );
  return { scheduled: true };
}

/** Shutdown helper — closes the worker and its dedicated ioredis connection. */
async function stopTrending() {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

module.exports = { QUEUE_NAME, JOB_NAME, scheduleTrending, stopTrending, processTrendingRefresh, getTrending };
