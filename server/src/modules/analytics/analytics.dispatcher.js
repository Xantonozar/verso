'use strict';

const { logger } = require('../../config/logger');
const { isRedisUp } = require('../../config/redis');
const { createBullConnection } = require('../../jobs/connection');
const { getQueue, enqueue } = require('../../jobs/queues');
const { QUEUE_NAME, JOB_NAME } = require('../../jobs/analytics');

/**
 * Reading-activity producer (plan step 82, §8.14): the POST /poems/:id/read
 * handler enqueues AFTER its visibility check - the analytics write itself
 * (row insert + stats.reads increment) only ever happens in the worker, so
 * the read request never blocks on analytics.
 *
 * Same degradation contract as the notification dispatcher: Redis down ->
 * `{ queued: false, reason }` and the API stays up. Never rejects, so the
 * controller can call it without a .catch().
 */
let connection = null;

function buildReadingActivityJob({ poemId, readerId, eventKey }) {
  if (!poemId || !eventKey) {
    throw new Error('dispatchReadingActivity: poemId/eventKey are required');
  }
  return {
    poemId: String(poemId),
    readerId: readerId ? String(readerId) : null,
    eventKey: String(eventKey),
    occurredAt: new Date().toISOString(),
  };
}

async function dispatchReadingActivity(input) {
  let jobData;
  try {
    jobData = buildReadingActivityJob(input);
  } catch (err) {
    logger.warn({ event: 'reading:dispatch-invalid', err: err.message }, 'Reading payload rejected');
    return { queued: false, reason: 'invalid' };
  }

  if (!isRedisUp()) {
    logger.debug(
      { event: 'reading:dispatch-skipped', eventKey: jobData.eventKey, reason: 'redis-down' },
      'Reading dispatch skipped - Redis unavailable',
    );
    return { queued: false, reason: 'redis-down' };
  }

  try {
    if (!connection) connection = createBullConnection();
    const queue = getQueue(QUEUE_NAME, connection);
    // Deterministic jobId = eventKey: BullMQ drops the add while a job with
    // the same id still exists (queue-level dedupe on top of the DB unique).
    const job = await enqueue(queue, JOB_NAME, jobData, { jobId: jobData.eventKey });
    return { queued: true, jobId: String(job.id) };
  } catch (err) {
    logger.warn({ event: 'reading:dispatch-failed', err: err.message }, 'Reading dispatch failed');
    return { queued: false, reason: 'enqueue-failed' };
  }
}

/** Shutdown helper - closes the dispatcher's dedicated ioredis connection. */
async function closeAnalyticsDispatcher() {
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

module.exports = { buildReadingActivityJob, dispatchReadingActivity, closeAnalyticsDispatcher };
