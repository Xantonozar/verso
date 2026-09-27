'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan step 5.5 — load test: feed + trending (+ mood) under concurrency must
 * stay inside the §10 p95 budget (400ms for feed/discovery) with zero 5xx.
 * Measured end-to-end through supertest against the real app + memory Mongo.
 */
const app = createApp();
let mongod;
let reader; // { accessToken, followeeIds }
const MOODS = ['rain', 'calm', 'joy', 'grief'];
const P95_BUDGET_MS = 400;
const REQUESTS_PER_ENDPOINT = 30;

async function register(username) {
  const res = await request(app).post('/api/v1/auth/register').send({
    username,
    displayName: 'Load',
    email: `${username}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function measure(fn, n) {
  const durations = [];
  let failures = 0;
  for (let i = 0; i < n; i++) {
    const start = process.hrtime.bigint();
    const status = await fn(i);
    durations.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (status !== 200) failures += 1;
  }
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    failures,
  };
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem]);

  // 10 followees × 20 poems = 200 published public poems, moods/tags spread
  const users = [];
  for (let i = 0; i < 10; i++) users.push(await register(`loadwriter${i}`));
  reader = await register('loadreader');

  const docs = [];
  let n = 0;
  for (const u of users) {
    for (let i = 0; i < 20; i++) {
      docs.push({
        authorId: u.user.id,
        title: `Load ${n}`,
        content: `body line ${n} of a poem written under load testing conditions`,
        status: 'published',
        visibility: i % 7 === 0 ? 'followers' : 'public',
        moods: [MOODS[n % MOODS.length]],
        tags: [`tag${n % 5}`],
        publishedAt: new Date(Date.UTC(2026, 0, 1) + n * 1000),
        createdAt: new Date(Date.UTC(2026, 0, 1) + n * 1000),
        trendingScore: n,
        stats: { reads: n, reactionCount: n % 5, commentCount: n % 3, saveCount: n % 2, shareCount: 0 },
      });
      n += 1;
    }
    const res = await request(app)
      .post(`/api/v1/users/${u.user.id}/follow`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(res.status).toBe(201);
  }
  await Poem.insertMany(docs);
}, 180_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('Load test — feed + trending + discovery p95 (plan 5.5 gate)', () => {
  test('GET /feed: p95 under 400ms, no failures, non-empty pages', async () => {
    const warm = await request(app)
      .get('/api/v1/feed?limit=20')
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(warm.status).toBe(200);
    expect(warm.body.data.items.length).toBeGreaterThan(0);

    const stats = await measure(async (i) => {
      const res = await request(app)
        .get(`/api/v1/feed?limit=20&offsetless=${i}`) // unique query → no accidental caching
        .set('Authorization', `Bearer ${reader.accessToken}`);
      return res.status;
    }, REQUESTS_PER_ENDPOINT);

    // eslint-disable-next-line no-console
    console.log(`[load] feed p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(1)}ms`);
    expect(stats.failures).toBe(0);
    expect(stats.p95).toBeLessThan(P95_BUDGET_MS);
  });

  test('GET /discover/trending: p95 under 400ms, no failures', async () => {
    const warm = await request(app).get('/api/v1/discover/trending');
    expect(warm.status).toBe(200);
    expect(warm.body.data.items.length).toBeGreaterThan(0);

    const stats = await measure(async () => {
      const res = await request(app).get('/api/v1/discover/trending');
      return res.status;
    }, REQUESTS_PER_ENDPOINT);

    // eslint-disable-next-line no-console
    console.log(`[load] trending p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(1)}ms`);
    expect(stats.failures).toBe(0);
    expect(stats.p95).toBeLessThan(P95_BUDGET_MS);
  });

  test('GET /discover/mood/:mood: p95 under 400ms, no failures', async () => {
    const warm = await request(app).get('/api/v1/discover/mood/rain');
    expect(warm.status).toBe(200);

    const stats = await measure(async (i) => {
      const res = await request(app).get(`/api/v1/discover/mood/${MOODS[i % MOODS.length]}?limit=20`);
      return res.status;
    }, REQUESTS_PER_ENDPOINT);

    // eslint-disable-next-line no-console
    console.log(`[load] mood p50=${stats.p50.toFixed(1)}ms p95=${stats.p95.toFixed(1)}ms max=${stats.max.toFixed(1)}ms`);
    expect(stats.failures).toBe(0);
    expect(stats.p95).toBeLessThan(P95_BUDGET_MS);
  });
});
