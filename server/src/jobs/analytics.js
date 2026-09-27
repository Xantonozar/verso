'use strict';

const { logger } = require('../config/logger');
const { isRedisUp } = require('../config/redis');
const { Poem } = require('../modules/poems/poem.model');
const { ReadingActivity } = require('../modules/analytics/reading-activity.model');
const { createWorker } = require('./worker');
const { createBullConnection } = require('./connection');

/**
 * Reading-activity worker (plan step 82, §8.14/§8.15): consumes the queued
 * read events POST /poems/:id/read enqueues, counts them idempotently (a
 * retried job must not double-count - §8.15), and bumps the denormalized
 * `stats.reads` counter (§8.17) server-side.
 *
 * Skips (logged, never thrown): vanished poem, soft-removed poem, the
 * author reading their own poem, duplicate eventKey.
 */
const QUEUE_NAME = 'verso:analytics';
const JOB_NAME = 'reading-activity';

let connection = null;
let worker = null;

async function processReadingActivityJob(job) {
  const { eventKey, poemId, readerId } = job?.data || {};
  if (!eventKey || !poemId) return { skipped: 'missing-fields' };

  const existing = await ReadingActivity.findOne({ eventKey }).select('_id').lean();
  if (existing) return { duplicate: true };

  const poem = await Poem.findById(poemId).select('authorId status').lean();
  if (!poem) return { skipped: 'poem-missing' };
  if (poem.status === 'removed') return { skipped: 'poem-removed' };
  if (readerId && String(readerId) === String(poem.authorId)) return { skipped: 'self-read' };

  try {
    const doc = await ReadingActivity.create({
      poemId: poem._id,
      authorId: poem.authorId,
      readerId: readerId || null,
      eventKey,
    });
    // Insert gates the increment: a duplicate surfaces as E11000 here or in
    // the pre-check above, so retries never inflate the counter (§8.15/§8.19).
    await Poem.updateOne({ _id: poem._id }, { $inc: { 'stats.reads': 1 } });
    logger.info(
      { event: 'reading:counted', activityId: String(doc._id), poemId: String(poem._id) },
      'Reading activity counted',
    );
    return { counted: true, activityId: String(doc._id) };
  } catch (err) {
    if (err?.code === 11000) return { duplicate: true };
    throw err;
  }
}

/** Boot helper - skipped when Redis is down (API keeps serving, 0.5 step 3). */
function startAnalyticsWorker() {
  if (!isRedisUp()) return { started: false, reason: 'redis-down' };
  if (!connection) connection = createBullConnection();
  if (!worker) {
    worker = createWorker(QUEUE_NAME, processReadingActivityJob, { connection, concurrency: 5 });
  }
  logger.info({ event: 'analytics:worker-started', queue: QUEUE_NAME }, 'Analytics worker up');
  return { started: true };
}

/** Shutdown helper - closes the worker and its dedicated ioredis connection. */
async function stopAnalyticsWorker() {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

module.exports = {
  QUEUE_NAME,
  JOB_NAME,
  processReadingActivityJob,
  startAnalyticsWorker,
  stopAnalyticsWorker,
};
