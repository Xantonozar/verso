'use strict';

const { logger } = require('../../config/logger');
const { isRedisUp } = require('../../config/redis');
const { createBullConnection } = require('../../jobs/connection');
const { getQueue, enqueue } = require('../../jobs/queues');
const { QUEUE_NAME, JOB_NAME } = require('../../jobs/notifications');

/**
 * Notification producer (plan step 79, 8.14): services fire-and-forget this
 * AFTER their primary write - the request never awaits it, so notification
 * fan-out can never block a user-perceived response.
 *
 * Degradation contract (0.5 step 3): Redis down -> skip the dispatch and log,
 * exactly like the trending scheduler; the API stays up. This function never
 * rejects (all failures fold into `{ queued: false, reason }`) so callers can
 * invoke it without a .catch().
 */
let connection = null;

function buildNotificationJob({ recipientId, type, relatedType, relatedId, eventKey, actor = null }) {
  if (!recipientId || !type || !relatedType || !relatedId || !eventKey) {
    throw new Error('dispatchNotification: recipientId/type/relatedType/relatedId/eventKey are required');
  }
  return {
    recipientId: String(recipientId),
    type,
    relatedType,
    relatedId: String(relatedId),
    eventKey: String(eventKey),
    actor: actor
      ? {
          id: String(actor.id),
          displayName: actor.displayName || null,
          username: actor.username || null,
        }
      : null,
    occurredAt: new Date().toISOString(),
  };
}

async function dispatchNotification(input) {
  let jobData;
  try {
    jobData = buildNotificationJob(input);
  } catch (err) {
    logger.warn({ event: 'notification:dispatch-invalid', err: err.message }, 'Notification payload rejected');
    return { queued: false, reason: 'invalid' };
  }

  if (!isRedisUp()) {
    logger.debug(
      { event: 'notification:dispatch-skipped', eventKey: jobData.eventKey, reason: 'redis-down' },
      'Notification dispatch skipped - Redis unavailable',
    );
    return { queued: false, reason: 'redis-down' };
  }

  try {
    if (!connection) connection = createBullConnection();
    const queue = getQueue(QUEUE_NAME, connection);
    // Deterministic jobId = eventKey: BullMQ drops the add while a job with
    // the same id still exists, which deduplicates at the queue level too.
    const job = await enqueue(queue, JOB_NAME, jobData, { jobId: jobData.eventKey });
    return { queued: true, jobId: String(job.id) };
  } catch (err) {
    logger.warn({ event: 'notification:dispatch-failed', err: err.message }, 'Notification dispatch failed');
    return { queued: false, reason: 'enqueue-failed' };
  }
}

/** Shutdown helper - closes the dispatcher's dedicated ioredis connection. */
async function closeDispatcher() {
  if (connection) {
    connection.disconnect();
    connection = null;
  }
}

module.exports = { buildNotificationJob, dispatchNotification, closeDispatcher };
