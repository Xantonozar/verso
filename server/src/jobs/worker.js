'use strict';

const { Worker } = require('bullmq');
const { logger } = require('../config/logger');
const { getDlqQueue } = require('./queues');

/**
 * Worker helpers + dead-letter handling (Phase 0.5 step 18), §7.2:
 * every job logs enqueued/started/completed/failed(retry)/failed(permanent);
 * permanent failures are copied into the DLQ queue for inspection/replay.
 */

/**
 * Pure decision + side-effect handler — unit-testable with fake job/queue.
 * `job.attemptsMade` already includes the attempt that just failed when the
 * worker's 'failed' event fires.
 */
async function handleFailedJob({
  job,
  error,
  queueName,
  dlqQueue = null,
  log = logger,
}) {
  const attemptsTotal = job.opts?.attempts ?? 1;
  const permanent = job.attemptsMade >= attemptsTotal;

  if (permanent) {
    if (dlqQueue) {
      await dlqQueue.add('dead-letter', {
        sourceQueue: queueName,
        jobName: job.name,
        jobId: job.id,
        data: job.data,
        failedReason: error?.message,
        attempts: attemptsTotal,
      });
    }
    log.error(
      {
        event: 'job:failed-permanent',
        queue: queueName,
        jobName: job.name,
        jobId: job.id,
        attempts: job.attemptsMade,
        err: error?.message,
      },
      'Job failed permanently — moved to dead-letter queue',
    );
    return { permanent: true, deadLettered: Boolean(dlqQueue) };
  }

  log.warn(
    {
      event: 'job:retry-scheduled',
      queue: queueName,
      jobName: job.name,
      jobId: job.id,
      attempts: job.attemptsMade,
      maxAttempts: attemptsTotal,
      err: error?.message,
    },
    'Job failed — retry scheduled',
  );
  return { permanent: false, deadLettered: false };
}

/** Wrap a processor with "started"/"completed" lifecycle logging. */
function wrapProcessor(queueName, processor, log = logger) {
  return async (job) => {
    log.info(
      { event: 'job:started', queue: queueName, jobName: job.name, jobId: job.id },
      'Job started',
    );
    const result = await processor(job);
    log.info(
      { event: 'job:completed', queue: queueName, jobName: job.name, jobId: job.id },
      'Job completed',
    );
    return result;
  };
}

function createWorker(queueName, processor, { connection, concurrency = 5 } = {}) {
  const worker = new Worker(queueName, wrapProcessor(queueName, processor), {
    connection,
    concurrency,
  });

  worker.on('failed', (job, error) => {
    handleFailedJob({ job, error, queueName, dlqQueue: getDlqQueue(connection) }).catch((err) => {
      logger.error({ event: 'job:dlq-error', queue: queueName, err: err.message }, 'DLQ handling failed');
    });
  });

  worker.on('error', (err) => {
    logger.error({ event: 'worker:error', queue: queueName, err: err.message }, 'Worker error');
  });

  return worker;
}

module.exports = { createWorker, handleFailedJob, wrapProcessor };
