'use strict';

const { Queue } = require('bullmq');
const { logger } = require('../config/logger');
const { buildJobOptions, DLQ_QUEUE_NAME } = require('./options');

/**
 * Queue registry (Phase 0.5 step 18). One Queue instance per job name,
 * default job options applied at construction (§7.3).
 */

const queues = new Map();

function getQueue(name, connection) {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, { connection, defaultJobOptions: buildJobOptions() }),
    );
  }
  return queues.get(name);
}

/** Enqueue with §7.2 lifecycle logging ("enqueued"). */
async function enqueue(queue, jobName, data, opts = {}) {
  const job = await queue.add(jobName, data, opts);
  logger.info(
    { event: 'job:enqueued', queue: queue.name, jobName, jobId: job.id, attempts: job.opts.attempts },
    'Job enqueued',
  );
  return job;
}

function getDlqQueue(connection) {
  return getQueue(DLQ_QUEUE_NAME, connection);
}

async function closeAllQueues() {
  const open = [...queues.values()];
  queues.clear();
  await Promise.allSettled(open.map((q) => q.close()));
}

module.exports = { getQueue, enqueue, getDlqQueue, closeAllQueues };
