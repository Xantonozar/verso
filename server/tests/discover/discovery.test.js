'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { Story } = require('../../src/modules/stories/story.model');
const { StoryChapter } = require('../../src/modules/stories/story-chapter.model');
const { StoryVersion } = require('../../src/modules/stories/story-version.model');
const { DiaryEntry } = require('../../src/modules/diary/diary.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;
let seedCount = 0;

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

/**
 * Unique title per seed (shared DB across tests in this file) + ascending
 * createdAt so cursor pagination is deterministic (stories pattern).
 */
async function seedPoem(authorId, overrides = {}) {
  const i = seedCount++;
  const poem = await Poem.create({
    authorId,
    title: `T${i.toString(36)}`,
    content: `the rain keeps time on the roof ${i} and the kettle hums along quietly`,
    status: 'published',
    visibility: 'public',
    publishedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 10_000),
    ...overrides,
  });
  // native driver: mongoose timestamps make createdAt immutable via Model.updateOne
  await Poem.collection.updateOne(
    { _id: poem._id },
    { $set: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + i * 10_000) } },
  );
  return poem;
}

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Follow,
    Poem,
    Story,
    StoryChapter,
    StoryVersion,
    DiaryEntry,
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('GET /discover/mood/:mood — mood discovery (plan 53.1)', () => {
  test('returns public published poems carrying the mood, newest first', async () => {
    const author = await register();
    const m1 = await seedPoem(author.user.id, { moods: ['rain'] });
    const m2 = await seedPoem(author.user.id, { moods: ['rain', 'calm'] });
    await seedPoem(author.user.id, { moods: ['anger'] });

    const res = await request(app).get('/api/v1/discover/mood/rain');

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((p) => p.title)).toEqual([m2.title, m1.title]);
    expect(res.body.data.items[0].moods).toEqual(['rain', 'calm']);
    expect(res.body.data.items[0].type).toBe('poem');
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('excludes drafts, other visibilities, and diary/story rows', async () => {
    const author = await register();
    await seedPoem(author.user.id, { moods: ['xray'], status: 'draft' });
    await seedPoem(author.user.id, { moods: ['xray'], visibility: 'followers' });
    await seedPoem(author.user.id, { moods: ['xray'], visibility: 'unlisted' });
    const kept = await seedPoem(author.user.id, { moods: ['xray'], visibility: 'private_draft' });
    await seedPoem(author.user.id, { moods: ['xray'] });
    await DiaryEntry.create({
      authorId: author.user.id,
      content: 'private rain diary line that must never surface in discovery',
      visibility: 'public',
      status: 'published',
    });
    await Story.create({
      authorId: author.user.id,
      title: 'Rain Story',
      synopsis: 'a story about rain',
      status: 'published',
    });

    const res = await request(app).get('/api/v1/discover/mood/xray');

    expect(res.status).toBe(200);
    // only the one public published poem survives the filter
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].title).not.toBe(kept.title);
    expect(res.body.data.items.every((i) => i.type === 'poem')).toBe(true);
    const bodies = JSON.stringify(res.body);
    expect(bodies).not.toContain('rain diary line');
    expect(bodies).not.toContain('Rain Story');
  });

  test('cursor pagination follows createdAt desc', async () => {
    const author = await register();
    const a = await seedPoem(author.user.id, { moods: ['mist'] });
    const b = await seedPoem(author.user.id, { moods: ['mist'] });
    const c = await seedPoem(author.user.id, { moods: ['mist'] });

    const page1 = await request(app).get('/api/v1/discover/mood/mist?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.data.items.map((p) => p.title)).toEqual([c.title, b.title]);
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await request(app).get(
      `/api/v1/discover/mood/mist?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
    );
    expect(page2.body.data.items.map((p) => p.title)).toEqual([a.title]);
    expect(page2.body.data.nextCursor).toBeNull();
  });

  test('unknown mood → empty page (distinct "nothing here yet" state)', async () => {
    const res = await request(app).get('/api/v1/discover/mood/no-such-mood');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('mood over 40 chars → 400 params.mood', async () => {
    const res = await request(app).get(`/api/v1/discover/mood/${'x'.repeat(41)}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('params.mood');
  });

  test('invalid cursor → 400 query.cursor', async () => {
    const res = await request(app).get('/api/v1/discover/mood/rain?cursor=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('query.cursor');
  });
});

describe('GET /discover/tags/:tag — tag discovery (plan 53.1)', () => {
  test('returns tagged public published poems with batched author', async () => {
    const author = await register();
    const t1 = await seedPoem(author.user.id, { tags: ['nature'] });
    const t2 = await seedPoem(author.user.id, { tags: ['nature', 'city'] });
    await seedPoem(author.user.id, { tags: ['sea'] });

    const res = await request(app).get('/api/v1/discover/tags/nature');

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((p) => p.title)).toEqual([t2.title, t1.title]);
    expect(res.body.data.items[0].tags).toEqual(['nature', 'city']);
    expect(res.body.data.items[0].author.username).toBe(author.user.username);
  });

  test('tag query never returns drafts or followers-only poems', async () => {
    const author = await register();
    await seedPoem(author.user.id, { tags: ['solo'], status: 'draft' });
    await seedPoem(author.user.id, { tags: ['solo'], visibility: 'followers' });
    const kept = await seedPoem(author.user.id, { tags: ['solo'] });

    const res = await request(app).get('/api/v1/discover/tags/solo');
    expect(res.body.data.items.map((p) => p.title)).toEqual([kept.title]);
  });
});

describe('GET /discover/trending — precomputed fallback read (plan 53.3)', () => {
  test('orders by denormalized trendingScore, public published only', async () => {
    await Poem.deleteMany({});
    const author = await register();
    const low = await seedPoem(author.user.id);
    const high = await seedPoem(author.user.id);
    const mid = await seedPoem(author.user.id);
    const hidden = await seedPoem(author.user.id, { visibility: 'followers' });
    await Poem.updateOne({ _id: low._id }, { $set: { trendingScore: 10 } });
    await Poem.updateOne({ _id: high._id }, { $set: { trendingScore: 90 } });
    await Poem.updateOne({ _id: mid._id }, { $set: { trendingScore: 50 } });
    await Poem.updateOne({ _id: hidden._id }, { $set: { trendingScore: 999 } });

    const res = await request(app).get('/api/v1/discover/trending');

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((p) => p.title)).toEqual([high.title, mid.title, low.title]);
    expect(res.body.data.nextCursor).toBeNull();
    expect(typeof res.body.data.generatedAt).toBe('string');
  });

  test('anonymous poems surface with author: null (plan 41B)', async () => {
    const author = await register();
    const anon = await seedPoem(author.user.id, { anonymous: true });

    const res = await request(app).get('/api/v1/discover/trending');
    const item = res.body.data.items.find((p) => p.title === anon.title);
    expect(item.author).toBeNull();
    expect(item.anonymous).toBe(true);
    expect(item).not.toHaveProperty('authorId');
  });
});

describe('GET /discover/random — uniform random pick (plan 53)', () => {
  test('returns one published public poem from the corpus', async () => {
    await Poem.deleteMany({});
    const author = await register();
    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const p = await seedPoem(author.user.id);
      ids.add(String(p._id));
    }

    const res = await request(app).get('/api/v1/discover/random');

    expect(res.status).toBe(200);
    expect(res.body.data.type).toBe('poem');
    expect(ids.has(res.body.data.id)).toBe(true);
  });

  test('never returns drafts', async () => {
    await Poem.deleteMany({});
    const author = await register();
    const pub = await seedPoem(author.user.id);
    await seedPoem(author.user.id, { status: 'draft' });

    for (let i = 0; i < 8; i++) {
      const res = await request(app).get('/api/v1/discover/random');
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(String(pub._id));
    }
  });

  test('empty corpus → 404 DISCOVER_EMPTY (distinct empty state)', async () => {
    await Poem.deleteMany({});
    const res = await request(app).get('/api/v1/discover/random');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DISCOVER_EMPTY');
  });
});

describe('Discovery auth surface (plan 53-54)', () => {
  test('discovery endpoints work without a token (optionalAuth)', async () => {
    const author = await register();
    await seedPoem(author.user.id, { moods: ['open'] });
    const res = await request(app).get('/api/v1/discover/mood/open');
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  test('invalid bearer on discovery → 401 (present but broken never downgrades)', async () => {
    const res = await request(app)
      .get('/api/v1/discover/mood/open')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });
});
