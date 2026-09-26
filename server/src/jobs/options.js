'use strict';

/**
 * Shared BullMQ job defaults (Phase 0.5 step 18) — §7.3: exponential backoff
 * 1s → 2s → 4s, 3 attempts, then the failed handler dead-letters the job.
 */

const DLQ_QUEUE_NAME = 'verso:dead-letter';

const DEFAULT_JOB_OPTIONS = Object.freeze({
  attempts: 3,
  backoff: Object.freeze({ type: 'exponential', delay: 1000 }),
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
});

/** Merge overrides on top of defaults (backoff is deep-merged). */
function buildJobOptions(overrides = {}) {
  const { backoff, ...rest } = overrides;
  return {
    ...DEFAULT_JOB_OPTIONS,
    ...rest,
    backoff: { ...DEFAULT_JOB_OPTIONS.backoff, ...(backoff || {}) },
  };
}

module.exports = { DEFAULT_JOB_OPTIONS, buildJobOptions, DLQ_QUEUE_NAME };
