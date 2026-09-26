'use strict';

const { buildJobOptions, DEFAULT_JOB_OPTIONS, DLQ_QUEUE_NAME } = require('../../src/jobs/options');
const { handleFailedJob, wrapProcessor } = require('../../src/jobs/worker');

function fakeJob({ attemptsMade, attempts = 3, data = { x: 1 } } = {}) {
  return {
    id: 'job-1',
    name: 'send-email',
    data,
    attemptsMade,
    opts: { attempts },
  };
}

const silentLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

describe('job options (step 18 / §7.3)', () => {
  test('defaults: 3 attempts, exponential backoff 1s', () => {
    expect(DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 1000 });
    expect(DLQ_QUEUE_NAME).toBe('verso:dead-letter');
  });

  test('buildJobOptions deep-merges overrides', () => {
    const opts = buildJobOptions({ attempts: 5, backoff: { delay: 250 } });
    expect(opts.attempts).toBe(5);
    expect(opts.backoff).toEqual({ type: 'exponential', delay: 250 });
    expect(opts.removeOnComplete).toEqual(DEFAULT_JOB_OPTIONS.removeOnComplete);
  });
});

describe('handleFailedJob (dead-letter logic)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('mid-retry failure → warn, no DLQ entry', async () => {
    const dlq = { add: jest.fn() };
    const result = await handleFailedJob({
      job: fakeJob({ attemptsMade: 1 }),
      error: new Error('flaky'),
      queueName: 'email',
      dlqQueue: dlq,
      log: silentLog,
    });
    expect(result).toEqual({ permanent: false, deadLettered: false });
    expect(dlq.add).not.toHaveBeenCalled();
    expect(silentLog.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job:retry-scheduled', attempts: 1, maxAttempts: 3 }),
      expect.any(String),
    );
  });

  test('exhausted attempts → permanent failure copied to DLQ with payload', async () => {
    const dlq = { add: jest.fn().mockResolvedValue(undefined) };
    const job = fakeJob({ attemptsMade: 3 });
    const result = await handleFailedJob({
      job,
      error: new Error('still broken'),
      queueName: 'email',
      dlqQueue: dlq,
      log: silentLog,
    });
    expect(result).toEqual({ permanent: true, deadLettered: true });
    expect(dlq.add).toHaveBeenCalledWith(
      'dead-letter',
      expect.objectContaining({
        sourceQueue: 'email',
        jobName: 'send-email',
        jobId: 'job-1',
        data: { x: 1 },
        failedReason: 'still broken',
        attempts: 3,
      }),
    );
    expect(silentLog.error).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job:failed-permanent', attempts: 3 }),
      expect.any(String),
    );
  });

  test('permanent failure without a DLQ queue still logs error', async () => {
    const result = await handleFailedJob({
      job: fakeJob({ attemptsMade: 3 }),
      error: new Error('boom'),
      queueName: 'email',
      dlqQueue: null,
      log: silentLog,
    });
    expect(result).toEqual({ permanent: true, deadLettered: false });
    expect(silentLog.error).toHaveBeenCalled();
  });
});

describe('wrapProcessor lifecycle logging', () => {
  test('logs started then completed around the processor', async () => {
    jest.clearAllMocks();
    const processor = jest.fn().mockResolvedValue('done');
    const wrapped = wrapProcessor('email', processor, silentLog);
    const out = await wrapped(fakeJob({ attemptsMade: 0 }));
    expect(out).toBe('done');
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job:started', queue: 'email' }),
      expect.any(String),
    );
    expect(silentLog.info).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'job:completed', queue: 'email' }),
      expect.any(String),
    );
  });

  test('propagates processor errors (worker marks the job failed)', async () => {
    const wrapped = wrapProcessor(
      'email',
      async () => {
        throw new Error('processor exploded');
      },
      silentLog,
    );
    await expect(wrapped(fakeJob())).rejects.toThrow('processor exploded');
  });
});
