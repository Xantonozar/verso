'use strict';

const { logger } = require('../config/logger');
const { isRedisUp } = require('../config/redis');
const { User } = require('../modules/users/user.model');
const { emitToUser } = require('../sockets/registry');
const {
  createNotificationIdempotent,
  serializeNotification,
} = require('../modules/notifications/notifications.service');
const { createWorker } = require('./worker');
const { createBullConnection } = require('./connection');

/**
 * Notification worker (plan steps 79-80): creates rows from queued events
 * idempotently (10.15), fans them out over `notification:push`, then makes a
 * best-effort Expo push delivery. Push failures (invalid/expired token, HTTP
 * errors, network) are logged and swallowed - they must never fail the job.
 */
const QUEUE_NAME = 'verso:notifications';
const JOB_NAME = 'notify';
const PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

let connection = null;
let worker = null;

/**
 * Expo push delivery (plan step 80). Never throws: every failure path logs
 * `push:delivery-failed` and returns `{ delivered: false }`. An
 * `DeviceNotRegistered` / `InvalidCredentials` response clears the stored
 * token so the next attempt does not repeat a known-dead address.
 */
async function deliverExpoPush({ token, title, body, data }, deps = {}) {
  const { fetchImpl = fetch, userId = null, log = logger } = deps;
  try {
    const res = await fetchImpl(PUSH_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, sound: 'default', data }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      log.warn({ event: 'push:delivery-failed', status: res.status, userId }, 'Expo push delivery failed');
      return { attempted: true, delivered: false, reason: `http-${res.status}` };
    }
    const payload = await res.json();
    const first = Array.isArray(payload?.data) ? payload.data[0] : null;
    if (!first || first.status !== 'ok') {
      const error = first?.details?.error || first?.message || 'unknown';
      log.warn({ event: 'push:delivery-failed', error, userId }, 'Expo push rejected message');
      if ((error === 'DeviceNotRegistered' || error === 'InvalidCredentials') && userId) {
        await User.updateOne({ _id: userId }, { $set: { pushToken: '' } });
        log.warn({ event: 'push:token-cleared', error, userId }, 'Invalid push token cleared');
      }
      return { attempted: true, delivered: false, reason: error };
    }
    return { attempted: true, delivered: true };
  } catch (err) {
    log.warn({ event: 'push:delivery-failed', err: err.message, userId }, 'Expo push delivery failed');
    return { attempted: true, delivered: false, reason: err.message };
  }
}

/** Load the recipient's push token and deliver; no token -> quiet no-op. */
async function deliverNotificationPush(recipientId, notification, deps = {}) {
  const user = await User.findById(recipientId).select('pushToken').lean();
  if (!user?.pushToken) return { attempted: false, reason: 'no-token' };
  return deliverExpoPush(
    {
      token: user.pushToken,
      title: 'Verso',
      body: notification.poeticMessage,
      data: { notificationId: String(notification._id ?? notification.id) },
    },
    { ...deps, userId: String(recipientId) },
  );
}

/**
 * Processor (unit-testable without Redis - mirrors processTrendingRefresh):
 * idempotent insert -> socket fan-out -> best-effort push. A duplicate job
 * short-circuits before any emit, so retries never ping the recipient twice.
 */
async function processNotificationJob(job, deps = {}) {
  const result = await createNotificationIdempotent(job.data);
  if (!result.inserted) {
    return { duplicate: true, skipped: result.skipped || null, duplicateOf: result.duplicateOf || null };
  }

  const notification = result.notification;
  emitToUser(job.data.recipientId, 'notification:push', serializeNotification(notification));
  const push = await deliverNotificationPush(job.data.recipientId, notification, deps);

  return { duplicate: false, notificationId: String(notification.id), push };
}

/** Boot helper - skipped when Redis is down (API keeps serving, 0.5 step 3). */
function startNotificationsWorker() {
  if (!isRedisUp()) return { started: false, reason: 'redis-down' };
  if (!connection) connection = createBullConnection();
  if (!worker) {
    worker = createWorker(QUEUE_NAME, processNotificationJob, { connection, concurrency: 5 });
  }
  logger.info({ event: 'notifications:worker-started', queue: QUEUE_NAME }, 'Notification worker up');
  return { started: true };
}

/** Shutdown helper - closes the worker and its dedicated ioredis connection. */
async function stopNotificationsWorker() {
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
  PUSH_ENDPOINT,
  processNotificationJob,
  deliverExpoPush,
  deliverNotificationPush,
  startNotificationsWorker,
  stopNotificationsWorker,
};
