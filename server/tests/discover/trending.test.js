'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { DiaryEntry } = require('../../src/modules/diary/diary.model');
const { logger } = require('../../src/config/logger');
const { runTrendingRefresh, getTrending } = require('../../src/modules/discover/discover.service');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Writer',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function seedPoem(authorId, overrides = {}) {
  return Poem.create({
    authorId,
    title: `Tr${(seq++).toString(36)}`,
    content: 'a trending line about weather and waiting for the tram',
    status: 'published',
    visibility: 'public',
    ...overrides,
  });
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem, DiaryEntry]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Poem.deleteMany({});
});

describe('runTrendingRefresh — scheduled denormalized scoring (plan 55, §8.6)', () => {
  test('scores = reactions×3 + comments×2 + saves×2 + reads (in-window public)', async () => {
    const author = await register();
    const hot = await seedPoem(author.user.id, {
      stats: { reads: 10, reactionCount: 4, commentCount: 3, saveCount: 2, shareCount: 99 },
    });
    const cold = await seedPoem(author.user.id, {
      stats: { reads: 1, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 },
    });

    const { durationMs, records } = await runTrendingRefresh();

    expect(typeof durationMs).toBe('number');
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(records).toBe(2);
    const hotDoc = await Poem.findById(hot._id).lean();
    const coldDoc = await Poem.findById(cold._id).lean();
    // 4×3 + 3×2 + 2×2 + 10 = 32; shareCount deliberately NOT part of the formula
    expect(hotDoc.trendingScore).toBe(32);
    expect(coldDoc.trendingScore).toBe(1);
  });

  test('stale scores reset; out-of-window and followers-only poems stay 0', async () => {
    const author = await register();
    const old = await seedPoem(author.user.id, {
      stats: { reads: 500, reactionCount: 50, commentCount: 50, saveCount: 50 },
    });
    // native update: mongoose timestamps make createdAt immutable via Model.updateOne
    await Poem.collection.updateOne(
      { _id: old._id },
      { $set: { createdAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000), trendingScore: 777 } },
    );
    const followersOnly = await seedPoem(author.user.id, {
      visibility: 'followers',
      stats: { reads: 100, reactionCount: 20, commentCount: 20, saveCount: 20 },
    });
    const stale = await seedPoem(author.user.id, {
      stats: { reads: 0, reactionCount: 0, commentCount: 0, saveCount: 0 },
      trendingScore: 42,
    });

    await runTrendingRefresh();

    expect((await Poem.findById(old._id).lean()).trendingScore).toBe(0);
    expect((await Poem.findById(followersOnly._id).lean()).trendingScore).toBe(0);
    expect((await Poem.findById(stale._id).lean()).trendingScore).toBe(0);
  });

  test('logs duration + record count (plan 55 observability)', async () => {
    const author = await register();
    await seedPoem(author.user.id, { stats: { reads: 5, reactionCount: 1 } });

    const infoSpy = jest.spyOn(logger, 'info');
    const result = await runTrendingRefresh();

    const call = infoSpy.mock.calls.find((args) => args[0]?.event === 'trending:refreshed');
    infoSpy.mockRestore();
    expect(call).toBeTruthy();
    expect(call[0].durationMs).toBe(result.durationMs);
    expect(call[0].records).toBe(1);
    expect(call[0].windowDays).toBe(7);
  });

  test('idempotent: a second run recomputes the same scores', async () => {
    const author = await register();
    const p = await seedPoem(author.user.id, {
      stats: { reads: 7, reactionCount: 2, commentCount: 1, saveCount: 0 },
    });

    await runTrendingRefresh();
    const first = (await Poem.findById(p._id).lean()).trendingScore;
    await runTrendingRefresh();
    const second = (await Poem.findById(p._id).lean()).trendingScore;

    expect(first).toBe(7 * 1 + 2 * 3 + 1 * 2);
    expect(second).toBe(first);
  });
});

describe('GET /discover/trending — end-to-end after refresh (plan 53.3)', () => {
  test('HTTP read reflects denormalized scores, Redis-down fallback path', async () => {
    const author = await register();
    const a = await seedPoem(author.user.id, { stats: { reads: 2 } });
    const b = await seedPoem(author.user.id, {
      stats: { reads: 100, reactionCount: 10, commentCount: 10, saveCount: 10 },
    });

    await runTrendingRefresh();

    const res = await request(app).get('/api/v1/discover/trending');
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].title).toBe(b.title);
    expect(res.body.data.items[1].title).toBe(a.title);
    expect(typeof res.body.data.generatedAt).toBe('string');
  });

  test('diary rows never trend (discovery = poems only, gate 4.2)', async () => {
    const author = await register();
    await DiaryEntry.create({
      authorId: author.user.id,
      content: 'diary line that must never trend',
      visibility: 'public',
      status: 'published',
    });

    await runTrendingRefresh();
    const res = await request(app).get('/api/v1/discover/trending');

    expect(res.status).toBe(200);
    expect(res.body.data.items.every((i) => i.type === 'poem')).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('must never trend');
  });

  test('service read works with cache disabled (isRedisUp false in tests)', async () => {
    const author = await register();
    await seedPoem(author.user.id, { stats: { reads: 3 } });
    await runTrendingRefresh();

    const payload = await getTrending({});
    expect(payload.items.length).toBeGreaterThan(0);
    expect(payload.nextCursor).toBeNull();
    expect(typeof payload.generatedAt).toBe('string');
  });
});
