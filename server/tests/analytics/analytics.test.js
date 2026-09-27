'use strict';

const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Reaction } = require('../../src/modules/engagement/reaction.model');
const { Comment } = require('../../src/modules/engagement/comment.model');
const { Save } = require('../../src/modules/engagement/save.model');
const { ReadingActivity } = require('../../src/modules/analytics/reading-activity.model');
const analyticsDispatcher = require('../../src/modules/analytics/analytics.dispatcher');
const { processReadingActivityJob } = require('../../src/jobs/analytics');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 12 gate (plan steps 82-84):
 * - POST /poems/:id/read: visibility-checked, ALWAYS queued (never sync),
 *   reader-scoped eventKey, anonymous readers logged as readerId null (82)
 * - worker: insert + stats.reads bump, idempotent on eventKey (§8.15),
 *   skips vanished/removed poems and author self-reads (82)
 * - GET /analytics/writer: reads/reactions/comments/saves/follower growth
 *   per day, own content only, zero-filled buckets for new writers (83)
 * - Redis-down degradation: endpoint stays 200 with queued:false
 * - explain('executionStats') on the dashboard aggregation → IXSCAN on
 *   { authorId, createdAt } (12.3 gate, §4/§10)
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;
const utcDay = (d) => d.toISOString().slice(0, 10);
const YESTERDAY = new Date(Date.now() - 86_400_000);
const YESTERDAY_KEY = utcDay(YESTERDAY);

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

async function createPublishedPoem(token) {
  const create = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'First Light', content: 'dawn\nspills over', visibility: 'public' });
  expect(create.status).toBe(201);
  const publish = await request(app)
    .post(`/api/v1/poems/${create.body.data.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(publish.status).toBe(200);
  return publish.body.data;
}

function postRead(poemId, token) {
  const req = request(app).post(`/api/v1/poems/${poemId}/read`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({});
}

function writerStats(token, query = {}) {
  const qs = new URLSearchParams(query).toString();
  return request(app)
    .get(`/api/v1/analytics/writer${qs ? `?${qs}` : ''}`)
    .set('Authorization', `Bearer ${token}`);
}

let alice; // writer/owner
let bob; // reader
let carol; // second writer (decoy content)

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Follow,
    Poem,
    PoemVersion,
    Reaction,
    Comment,
    Save,
    ReadingActivity,
  ]);
  alice = await register('Alice Writer');
  bob = await register('Bob Reader');
  carol = await register('Carol Writer');
});

afterAll(async () => {
  await stopTestDb(mongod);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('POST /poems/:id/read — queued read logging (plan 82)', () => {
  test('authenticated read dispatches a reader-scoped eventKey, never sync', async () => {
    const poem = await createPublishedPoem(alice.accessToken);
    const spy = jest
      .spyOn(analyticsDispatcher, 'dispatchReadingActivity')
      .mockResolvedValue({ queued: true, jobId: 'job-1' });

    const res = await postRead(poem.id, bob.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ queued: true, reason: null, jobId: 'job-1' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({
      poemId: poem.id,
      readerId: bob.user.id,
      eventKey: expect.stringMatching(new RegExp(`^read:${poem.id}:${bob.user.id}:`)),
    });
    // the request itself wrote nothing — the worker owns the insert (§8.14)
    expect(await ReadingActivity.countDocuments({})).toBe(0);
  });

  test('anonymous read of a public poem dispatches readerId null', async () => {
    const poem = await createPublishedPoem(alice.accessToken);
    const spy = jest
      .spyOn(analyticsDispatcher, 'dispatchReadingActivity')
      .mockResolvedValue({ queued: true, jobId: 'job-2' });

    const res = await postRead(poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      poemId: poem.id,
      readerId: null,
      eventKey: expect.stringMatching(new RegExp(`^read:${poem.id}:anon:`)),
    });
  });

  test('unknown poem → 404 POEM_NOT_FOUND, nothing dispatched', async () => {
    const spy = jest.spyOn(analyticsDispatcher, 'dispatchReadingActivity');
    const res = await postRead(new mongoose.Types.ObjectId().toHexString(), bob.accessToken);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
    expect(spy).not.toHaveBeenCalled();
  });

  test("another user's draft → 404 (fail-closed), nothing dispatched", async () => {
    const create = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .send({ title: 'WIP', content: 'unfinished', visibility: 'public' });
    expect(create.status).toBe(201);

    const spy = jest.spyOn(analyticsDispatcher, 'dispatchReadingActivity');
    const res = await postRead(create.body.data.id, bob.accessToken);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
    expect(spy).not.toHaveBeenCalled();
  });

  test('malformed poem id → 400 VALIDATION_ERROR', async () => {
    const res = await postRead('not-an-id', bob.accessToken);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('Redis down → 200 { queued: false, reason: redis-down } (real dispatcher)', async () => {
    const poem = await createPublishedPoem(alice.accessToken);
    const res = await postRead(poem.id, bob.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data.queued).toBe(false);
    expect(res.body.data.reason).toBe('redis-down');
    expect(res.body.data.jobId).toBeNull();
  });
});

describe('reading-activity worker (plan 82, §8.15)', () => {
  let poemId;

  beforeAll(async () => {
    const poem = await createPublishedPoem(alice.accessToken);
    poemId = poem.id;
  });

  test('counts a queued read once: row inserted + stats.reads bumped', async () => {
    const eventKey = `wk-${Date.now()}-1`;
    const out = await processReadingActivityJob({
      data: { eventKey, poemId, readerId: bob.user.id },
    });
    expect(out).toEqual({
      counted: true,
      activityId: expect.any(String),
      // streak rides the same job (Phase 13): first counted read today
      streak: { updated: true, localDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) },
    });

    const row = await ReadingActivity.findOne({ eventKey }).lean();
    expect(row).toBeTruthy();
    expect(String(row.authorId)).toBe(alice.user.id);
    expect(String(row.readerId)).toBe(bob.user.id);

    const after = await Poem.findById(poemId).lean();
    expect(after.stats.reads).toBe(1);
  });

  test('retried job with the same eventKey does not double-count', async () => {
    const baseline = (await Poem.findById(poemId).lean()).stats.reads;
    const eventKey = `wk-${Date.now()}-2`;
    const first = await processReadingActivityJob({
      data: { eventKey, poemId, readerId: bob.user.id },
    });
    expect(first.counted).toBe(true);

    const again = await processReadingActivityJob({
      data: { eventKey, poemId, readerId: bob.user.id },
    });
    expect(again).toEqual({ duplicate: true });

    expect(await ReadingActivity.countDocuments({ eventKey })).toBe(1);
    const after = await Poem.findById(poemId).lean();
    expect(after.stats.reads).toBe(baseline + 1); // +1 from THIS event, not +2
  });

  test('author reading their own poem → skipped, no row, no bump', async () => {
    const eventKey = `wk-${Date.now()}-self`;
    const out = await processReadingActivityJob({
      data: { eventKey, poemId, readerId: alice.user.id },
    });
    expect(out).toEqual({ skipped: 'self-read' });
    expect(await ReadingActivity.exists({ eventKey })).toBeNull();
  });

  test('vanished poem → skipped; missing fields → skipped', async () => {
    const missing = await processReadingActivityJob({
      data: { eventKey: `wk-${Date.now()}-gone`, poemId: new mongoose.Types.ObjectId() },
    });
    expect(missing).toEqual({ skipped: 'poem-missing' });

    const empty = await processReadingActivityJob({ data: {} });
    expect(empty).toEqual({ skipped: 'missing-fields' });
  });

  test('soft-removed poem → skipped, no row', async () => {
    const create = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${carol.accessToken}`)
      .send({ title: 'Doomed', content: 'gone soon', visibility: 'public' });
    await Poem.updateOne({ _id: create.body.data.id }, { $set: { status: 'removed' } });

    const eventKey = `wk-${Date.now()}-removed`;
    const out = await processReadingActivityJob({
      data: { eventKey, poemId: create.body.data.id, readerId: bob.user.id },
    });
    expect(out).toEqual({ skipped: 'poem-removed' });
    expect(await ReadingActivity.exists({ eventKey })).toBeNull();
  });
});

describe('GET /analytics/writer (plan 83)', () => {
  test('401 without a token', async () => {
    const res = await request(app).get('/api/v1/analytics/writer');
    expect(res.status).toBe(401);
  });

  test('aggregates reads/reactions/comments/saves/followers by day — own content only', async () => {
    // clean slate: earlier describes left rows behind for the same users
    await ReadingActivity.deleteMany({});
    await Reaction.deleteMany({});
    await Comment.deleteMany({});
    await Save.deleteMany({});
    await Follow.deleteMany({});
    await Poem.deleteMany({});

    const mine = await createPublishedPoem(alice.accessToken);
    const theirs = await createPublishedPoem(carol.accessToken);

    // 2 reads on Alice's poem (yesterday), 1 decoy read on Carol's poem.
    // createdAt is passed explicitly at create() — mongoose's update-query
    // timestamps middleware silently overrides $set on createdAt, while
    // create() honors a provided value (verified empirically, debug run).
    await ReadingActivity.create({
      poemId: mine.id,
      authorId: alice.user.id,
      readerId: bob.user.id,
      eventKey: `agg-mine-a-${Date.now()}`,
      createdAt: YESTERDAY,
    });
    await ReadingActivity.create({
      poemId: mine.id,
      authorId: alice.user.id,
      readerId: null,
      eventKey: `agg-mine-b-${Date.now()}`,
      createdAt: YESTERDAY,
    });
    await ReadingActivity.create({
      poemId: theirs.id,
      authorId: carol.user.id,
      readerId: bob.user.id,
      eventKey: `agg-decoy-${Date.now()}`,
    });

    // 1 reaction + 1 active comment + 1 removed (excluded) + 1 save on mine,
    // plus matching decoys on Carol's poem
    await Reaction.create({
      targetType: 'poem',
      targetId: mine.id,
      userId: bob.user.id,
      type: 'beautiful',
      createdAt: YESTERDAY,
    });
    await Reaction.create({
      targetType: 'poem',
      targetId: theirs.id,
      userId: bob.user.id,
      type: 'loved',
    });
    await Comment.create({
      targetType: 'poem',
      targetId: mine.id,
      authorId: bob.user.id,
      content: 'this lands',
      status: 'active',
      createdAt: YESTERDAY,
    });
    await Comment.create({
      targetType: 'poem',
      targetId: mine.id,
      authorId: bob.user.id,
      content: 'hidden away',
      status: 'removed',
    });
    await Comment.create({
      targetType: 'poem',
      targetId: theirs.id,
      authorId: bob.user.id,
      content: 'carol decoy',
      status: 'active',
    });
    await Save.create({ userId: bob.user.id, poemId: mine.id, createdAt: YESTERDAY });
    await Save.create({ userId: bob.user.id, poemId: theirs.id });

    const follow = await Follow.create({ followerId: bob.user.id, followingId: alice.user.id });
    const followDay = utcDay(follow.createdAt);

    const res = await writerStats(alice.accessToken, { days: '7' });
    expect(res.status).toBe(200);
    const { range, totals, days } = res.body.data;

    expect(range.days).toBe(7);
    expect(totals).toEqual({
      poems: 1,
      reads: 2,
      reactions: 1,
      comments: 1, // removed comment excluded
      saves: 1,
      followers: 1,
    });

    expect(days).toHaveLength(7);
    expect(days.map((d) => d.date)).toEqual([...days.map((d) => d.date)].sort());
    expect(new Set(days.map((d) => d.date)).size).toBe(7);
    expect(days[0].date).toBe(range.from);
    expect(days[6].date).toBe(range.to);

    const yesterdayBucket = days.find((d) => d.date === YESTERDAY_KEY);
    expect(yesterdayBucket).toBeTruthy();
    expect(yesterdayBucket.reads).toBe(2);
    expect(yesterdayBucket.reactions).toBe(1);
    expect(yesterdayBucket.comments).toBe(1);
    expect(yesterdayBucket.saves).toBe(1);
    expect(yesterdayBucket.followers).toBe(0);

    const followBucket = days.find((d) => d.date === followDay);
    expect(followBucket.followers).toBe(1);

    expect(days.reduce((n, d) => n + d.reads, 0)).toBe(2);
    expect(days.reduce((n, d) => n + d.followers, 0)).toBe(1);
  });

  test('new writer: honest zeros, one bucket per default day (30)', async () => {
    const fresh = await register('Fresh Writer');
    const res = await writerStats(fresh.accessToken);
    expect(res.status).toBe(200);
    const { range, totals, days } = res.body.data;
    expect(range.days).toBe(30);
    expect(days).toHaveLength(30);
    expect(totals).toEqual({ poems: 0, reads: 0, reactions: 0, comments: 0, saves: 0, followers: 0 });
    expect(days.every((d) => d.reads === 0 && d.reactions === 0 && d.comments === 0)).toBe(true);
  });

  test("another user's dashboard never leaks into mine", async () => {
    const res = await writerStats(carol.accessToken, { days: '7' });
    expect(res.status).toBe(200);
    // Her own rows from the seed: the decoy read/comment/save/reaction on
    // HER poem — and none of Alice's.
    expect(res.body.data.totals).toEqual({
      poems: 1,
      reads: 1,
      reactions: 1,
      comments: 1,
      saves: 1,
      followers: 0,
    });
  });

  test('days validation: 0 and 91 → 400 VALIDATION_ERROR; 2 honored', async () => {
    for (const days of ['0', '91']) {
      const res = await writerStats(alice.accessToken, { days });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const ok = await writerStats(alice.accessToken, { days: '2' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.days).toHaveLength(2);
  });
});

describe("explain('executionStats') — writer aggregation (12.3 gate, §4)", () => {
  beforeAll(async () => {
    await ReadingActivity.deleteMany({});
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({
        poemId: new mongoose.Types.ObjectId(),
        authorId: new mongoose.Types.ObjectId(alice.user.id),
        readerId: new mongoose.Types.ObjectId(),
        eventKey: `ex-a-${i}-${now}`,
        createdAt: new Date(now - i * 3_600_000),
      });
      rows.push({
        poemId: new mongoose.Types.ObjectId(),
        authorId: new mongoose.Types.ObjectId(carol.user.id),
        readerId: null,
        eventKey: `ex-decoy-${i}-${now}`,
        createdAt: new Date(now - i * 3_600_000),
      });
    }
    await ReadingActivity.insertMany(rows);
  });

  test('reads series aggregation wins IXSCAN on { authorId, createdAt }', async () => {
    const from = new Date(Date.now() - 30 * 86_400_000);
    const explain = await ReadingActivity.aggregate([
      { $match: { authorId: new mongoose.Types.ObjectId(alice.user.id), createdAt: { $gte: from } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
    ]).explain('executionStats');

    const json = JSON.stringify(explain);
    expect(json).toContain('authorId_1_createdAt_-1');
    expect(json).toContain('IXSCAN');
    expect(json).not.toContain('COLLSCAN');
    // recorded executionStats: bounded index work (keys AND docs examined)
    expect(json).toContain('totalKeysExamined');
    expect(json).toContain('totalDocsExamined');
    const stats =
      explain?.stages?.[0]?.$cursor?.executionStats ?? explain?.executionStats ?? null;
    if (stats) {
      expect(stats.totalKeysExamined).toBeGreaterThan(0);
      expect(stats.totalDocsExamined).toBeLessThanOrEqual(stats.totalKeysExamined);
    }
  });
});
