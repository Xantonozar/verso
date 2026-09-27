'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { ReadingActivity } = require('../../src/modules/analytics/reading-activity.model');
const analyticsDispatcher = require('../../src/modules/analytics/analytics.dispatcher');
const { processReadingActivityJob } = require('../../src/jobs/analytics');
const {
  updateReadingStreak,
  localDayKey,
} = require('../../src/modules/users/reading-streak.service');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 13 gate (plan steps 85-86):
 * - Streak day = reader's LOCAL calendar day, never server UTC (85):
 *   pinned by the dedicated 11:58pm -> 12:05am local test (13.2) - a read
 *   7 minutes after local midnight must EXTEND the streak, not reset it.
 * - Atomic/idempotent per local day: same-day re-reads never double-increment
 *   (single conditional updateOne + pipeline, see reading-streak.service.js).
 * - Worker integration: streak rides the queued read job (before the insert
 *   for replay safety); anonymous/self-reads never streak anyone.
 * - POST /poems/:id/read: validates + passes the client's tzOffsetMinutes
 *   through to the dispatch payload; absent body stays back-compatible.
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

// Fixed instants around an IST (UTC+5:30, offset -330) midnight - the
// Phase 13 gate pair: 23:58 local Sep 28, then 00:05 local Sep 29.
const BEFORE_MIDNIGHT = new Date('2026-09-28T18:28:00.000Z'); // 23:58 IST
const AFTER_MIDNIGHT = new Date('2026-09-28T18:35:00.000Z'); // 00:05 IST Sep 29
const IST = -330;

async function register(displayName = 'Reader') {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName,
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function streakOf(userId) {
  const user = await User.findById(userId).select('readingStreak').lean();
  return user.readingStreak;
}

async function createPublishedPoem(token) {
  const create = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Night Lamp', content: 'one wick\nstill burning', visibility: 'public' });
  expect(create.status).toBe(201);
  const publish = await request(app)
    .post(`/api/v1/poems/${create.body.data.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(publish.status).toBe(200);
  return publish.body.data;
}

function postRead(poemId, token, body) {
  const req = request(app).post(`/api/v1/poems/${poemId}/read`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  if (body) req.send(body);
  return req;
}

function readJob(overrides) {
  return {
    data: {
      eventKey: `evt-${uniq()}`,
      poemId: 'unused',
      readerId: null,
      occurredAt: BEFORE_MIDNIGHT.toISOString(),
      ...overrides,
    },
  };
}

let alice; // writer/author
let bob; // reader
let dave; // streak-calculation subject (isolated from worker tests)
let eve; // UTC reader for the contrast case

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Poem, PoemVersion, ReadingActivity]);
  alice = await register('Alice Writer');
  bob = await register('Bob Reader');
  dave = await register('Dave Streak');
  eve = await register('Eve UTC');
});

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('local-timezone streak day (plan 85, gate 13.2)', () => {
  test('read at 11:58pm local, then 12:05am local, EXTENDS the streak', async () => {
    // 23:58 IST on Sep 28 - first read of the day.
    const first = await updateReadingStreak({
      userId: dave.user.id,
      tzOffsetMinutes: IST,
      now: BEFORE_MIDNIGHT,
    });
    expect(first).toEqual({ updated: true, localDay: '2026-09-28' });

    let streak = await streakOf(dave.user.id);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(1);
    expect(new Date(streak.lastReadDate).toISOString()).toBe('2026-09-28T00:00:00.000Z');

    // 7 minutes later the reader's wall clock has crossed midnight:
    // local day is Sep 29, yesterday (Sep 28) matches -> streak GROWS.
    // A UTC-day implementation would see the same calendar date and
    // treat this as a same-day re-read (streak stuck at 1) - or worse,
    // reset it. This assertion pins the required behaviour (13.2).
    const second = await updateReadingStreak({
      userId: dave.user.id,
      tzOffsetMinutes: IST,
      now: AFTER_MIDNIGHT,
    });
    expect(second).toEqual({ updated: true, localDay: '2026-09-29' });

    streak = await streakOf(dave.user.id);
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(2);
    expect(new Date(streak.lastReadDate).toISOString()).toBe('2026-09-29T00:00:00.000Z');
  });

  test('same local day re-read is a no-op (atomic per-day guard)', async () => {
    const again = await updateReadingStreak({
      userId: dave.user.id,
      tzOffsetMinutes: IST,
      now: AFTER_MIDNIGHT,
    });
    expect(again).toEqual({ updated: false, localDay: '2026-09-29' });

    const streak = await streakOf(dave.user.id);
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(2);
  });

  test('a gap breaks the streak to 1 but longest is preserved', async () => {
    // Skip Sep 30 entirely -> read on Oct 1 local.
    const res = await updateReadingStreak({
      userId: dave.user.id,
      tzOffsetMinutes: IST,
      now: new Date('2026-10-01T07:00:00.000Z'),
    });
    expect(res).toEqual({ updated: true, localDay: '2026-10-01' });

    const streak = await streakOf(dave.user.id);
    expect(streak.current).toBe(1);
    expect(streak.longest).toBe(2);
  });

  test('UTC reader at the same instants stays on the UTC day', async () => {
    // Eve reads at 23:58 UTC Sep 28 (day = Sep 28), then again at 00:05
    // UTC Sep 29... but AFTER_MIDNIGHT is 18:35Z = still Sep 28 UTC, so
    // the second read is the SAME UTC day -> no-op. Same two instants,
    // opposite outcome to the IST reader above: the day is the reader's,
    // not the server's.
    const first = await updateReadingStreak({
      userId: eve.user.id,
      tzOffsetMinutes: 0,
      now: BEFORE_MIDNIGHT,
    });
    expect(first).toEqual({ updated: true, localDay: '2026-09-28' });

    const second = await updateReadingStreak({
      userId: eve.user.id,
      tzOffsetMinutes: 0,
      now: AFTER_MIDNIGHT,
    });
    expect(second).toEqual({ updated: false, localDay: '2026-09-28' });

    const streak = await streakOf(eve.user.id);
    expect(streak.current).toBe(1);
  });

  test('missing/garbage offsets fall back to UTC days; unknown user is a no-op', async () => {
    expect(localDayKey(AFTER_MIDNIGHT, undefined)).toBe(localDayKey(AFTER_MIDNIGHT, 0));
    expect(localDayKey(AFTER_MIDNIGHT, 'not-a-number')).toBe('2026-09-28');
    // getTimezoneOffset() sign convention: negative east of Greenwich.
    expect(localDayKey(AFTER_MIDNIGHT, IST)).toBe('2026-09-29');
    expect(localDayKey(AFTER_MIDNIGHT, -600)).toBe('2026-09-29'); // UTC+10 already Sep 29

    const res = await updateReadingStreak({
      userId: '64b000000000000000000000',
      tzOffsetMinutes: IST,
      now: AFTER_MIDNIGHT,
    });
    expect(res.updated).toBe(false);
  });
});

describe('worker streak integration (queued read job)', () => {
  let poemId;

  beforeAll(async () => {
    const poem = await createPublishedPoem(alice.accessToken);
    poemId = poem.id;
  });

  test('counted read advances the reader streak; retry never double-streaks', async () => {
    const eventKey = `stk-${Date.now()}-1`;
    const first = await processReadingActivityJob(
      readJob({ eventKey, poemId, readerId: bob.user.id, tzOffsetMinutes: IST }),
    );
    expect(first.counted).toBe(true);
    expect(first.streak).toEqual({ updated: true, localDay: '2026-09-28' });
    expect((await streakOf(bob.user.id)).current).toBe(1);
    expect((await Poem.findById(poemId).lean()).stats.reads).toBe(1);

    // Same job replayed (BullMQ retry / DLQ replay): duplicate row, and the
    // streak guard makes the second update a no-op as well.
    const again = await processReadingActivityJob(
      readJob({ eventKey, poemId, readerId: bob.user.id, tzOffsetMinutes: IST }),
    );
    expect(again).toEqual({ duplicate: true });
    expect((await streakOf(bob.user.id)).current).toBe(1);
    expect((await Poem.findById(poemId).lean()).stats.reads).toBe(1);

    // Next local day (7 minutes after Bob's midnight): streak extends.
    const nextDay = await processReadingActivityJob(
      readJob({
        eventKey: `${eventKey}-d2`,
        poemId,
        readerId: bob.user.id,
        tzOffsetMinutes: IST,
        occurredAt: AFTER_MIDNIGHT.toISOString(),
      }),
    );
    expect(nextDay.counted).toBe(true);
    expect(nextDay.streak).toEqual({ updated: true, localDay: '2026-09-29' });
    const streak = await streakOf(bob.user.id);
    expect(streak.current).toBe(2);
    expect(streak.longest).toBe(2);
    expect((await Poem.findById(poemId).lean()).stats.reads).toBe(2);
  });

  test('anonymous read counts analytics but streaks nobody', async () => {
    const before = await streakOf(bob.user.id);
    const eventKey = `stk-${Date.now()}-anon`;
    const out = await processReadingActivityJob(
      readJob({
        eventKey,
        poemId,
        readerId: null,
        occurredAt: AFTER_MIDNIGHT.toISOString(),
      }),
    );
    expect(out.counted).toBe(true);
    expect(out.streak).toEqual({ updated: false, localDay: null });

    const row = await ReadingActivity.findOne({ eventKey }).lean();
    expect(row).toBeTruthy();
    expect(row.readerId).toBe(null);

    const after = await streakOf(bob.user.id);
    expect(after.current).toBe(before.current);
    expect(after.longest).toBe(before.longest);
  });

  test('author self-read skips streak and analytics entirely', async () => {
    const out = await processReadingActivityJob(
      readJob({ poemId, readerId: alice.user.id, tzOffsetMinutes: IST }),
    );
    expect(out).toEqual({ skipped: 'self-read' });
    expect((await streakOf(alice.user.id)).current).toBe(0);
    expect((await streakOf(alice.user.id)).longest).toBe(0);
  });
});

describe('POST /poems/:id/read timezone passthrough + validation', () => {
  let poemId;

  beforeAll(async () => {
    const poem = await createPublishedPoem(alice.accessToken);
    poemId = poem.id;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('valid tzOffsetMinutes rides into the dispatch payload', async () => {
    const spy = jest
      .spyOn(analyticsDispatcher, 'dispatchReadingActivity')
      .mockResolvedValue({ queued: true, jobId: 'job-tz' });

    const res = await postRead(poemId, bob.accessToken, { tzOffsetMinutes: IST });
    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      poemId,
      readerId: bob.user.id,
      eventKey: expect.stringMatching(/^read:/),
      tzOffsetMinutes: IST,
    });
  });

  test('missing body stays back-compatible (no tz key dispatched)', async () => {
    const spy = jest
      .spyOn(analyticsDispatcher, 'dispatchReadingActivity')
      .mockResolvedValue({ queued: false, reason: 'redis-down' });

    const res = await postRead(poemId, bob.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ queued: false, reason: 'redis-down', jobId: null });
    expect(spy).toHaveBeenCalledWith({
      poemId,
      readerId: bob.user.id,
      eventKey: expect.stringMatching(/^read:/),
    });
  });

  test('out-of-range or fractional offsets are rejected with VALIDATION_ERROR', async () => {
    const spy = jest.spyOn(analyticsDispatcher, 'dispatchReadingActivity');

    const tooBig = await postRead(poemId, bob.accessToken, { tzOffsetMinutes: 5000 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.code).toBe('VALIDATION_ERROR');

    const fractional = await postRead(poemId, bob.accessToken, { tzOffsetMinutes: 2.5 });
    expect(fractional.status).toBe(400);
    expect(fractional.body.error.code).toBe('VALIDATION_ERROR');

    const notANumber = await postRead(poemId, bob.accessToken, { tzOffsetMinutes: 'UTC+6' });
    expect(notANumber.status).toBe(400);
    expect(notANumber.body.error.code).toBe('VALIDATION_ERROR');

    expect(spy).not.toHaveBeenCalled();
  });
});
