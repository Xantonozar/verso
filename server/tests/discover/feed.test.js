'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
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

async function follow(followerToken, targetId) {
  const res = await request(app)
    .post(`/api/v1/users/${targetId}/follow`)
    .set('Authorization', `Bearer ${followerToken}`);
  expect(res.status).toBe(201);
}

async function seedPoem(authorId, overrides = {}) {
  const i = seedCount++;
  const poem = await Poem.create({
    authorId,
    title: `F${i.toString(36)}`,
    content: `following feed line ${i} drifts past the window like slow weather`,
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

function feed(token, query = '') {
  const r = request(app).get(`/api/v1/feed${query}`);
  return token ? r.set('Authorization', `Bearer ${token}`) : r;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem, DiaryEntry]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('GET /feed — following feed (plan 53.2)', () => {
  test('401 without a token', async () => {
    const res = await feed(null);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('no follows → empty page (distinct "nothing here yet" state)', async () => {
    const me = await register();
    const res = await feed(me.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('shows followed authors only, never strangers', async () => {
    const me = await register();
    const followed = await register();
    const stranger = await register();
    await follow(me.accessToken, followed.user.id);
    const theirs = await seedPoem(followed.user.id);
    const strangerPoem = await seedPoem(stranger.user.id);

    const res = await feed(me.accessToken);

    expect(res.status).toBe(200);
    const titles = res.body.data.items.map((p) => p.title);
    expect(titles).toContain(theirs.title);
    expect(titles).not.toContain(strangerPoem.title);
    expect(res.body.data.items[0].type).toBe('poem');
  });

  test('includes followers-only poems, excludes unlisted/private/draft', async () => {
    const me = await register();
    const followed = await register();
    await follow(me.accessToken, followed.user.id);
    const publicPoem = await seedPoem(followed.user.id, { visibility: 'public' });
    const followersPoem = await seedPoem(followed.user.id, { visibility: 'followers' });
    await seedPoem(followed.user.id, { visibility: 'unlisted' });
    await seedPoem(followed.user.id, { visibility: 'private_draft' });
    await seedPoem(followed.user.id, { status: 'draft' });

    const res = await feed(me.accessToken);

    const titles = res.body.data.items.map((p) => p.title);
    expect(titles).toContain(publicPoem.title);
    expect(titles).toContain(followersPoem.title);
    expect(titles).toHaveLength(2);
  });

  test('cursor pagination follows createdAt desc', async () => {
    const me = await register();
    const followed = await register();
    await follow(me.accessToken, followed.user.id);
    const a = await seedPoem(followed.user.id);
    const b = await seedPoem(followed.user.id);
    const c = await seedPoem(followed.user.id);

    const page1 = await feed(me.accessToken, '?limit=2');
    expect(page1.body.data.items.map((p) => p.title)).toEqual([c.title, b.title]);
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await feed(
      me.accessToken,
      `?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
    );
    expect(page2.body.data.items.map((p) => p.title)).toEqual([a.title]);
    expect(page2.body.data.nextCursor).toBeNull();
  });

  test('batch-loads authors across a page (one author per item, §8.4)', async () => {
    const me = await register();
    const a1 = await register();
    const a2 = await register();
    await follow(me.accessToken, a1.user.id);
    await follow(me.accessToken, a2.user.id);
    const p1 = await seedPoem(a1.user.id);
    const p2 = await seedPoem(a2.user.id);

    const res = await feed(me.accessToken);

    const byTitle = new Map(res.body.data.items.map((i) => [i.title, i]));
    expect(byTitle.get(p1.title).author.username).toBe(a1.user.username);
    expect(byTitle.get(p2.title).author.username).toBe(a2.user.username);
    expect(byTitle.get(p1.title).author.displayName).toBe('Writer');
    expect(byTitle.get(p1.title).author.id).toBe(a1.user.id);
  });

  test('anonymous followed poem: author null but still listed', async () => {
    const me = await register();
    const followed = await register();
    await follow(me.accessToken, followed.user.id);
    const anon = await seedPoem(followed.user.id, { anonymous: true });

    const res = await feed(me.accessToken);
    const item = res.body.data.items.find((i) => i.title === anon.title);
    expect(item).toBeTruthy();
    expect(item.author).toBeNull();
    expect(item.anonymous).toBe(true);
  });

  test('diary entries never appear in the following feed', async () => {
    const me = await register();
    const followed = await register();
    await follow(me.accessToken, followed.user.id);
    await seedPoem(followed.user.id);
    await DiaryEntry.create({
      authorId: followed.user.id,
      content: 'diary line that must never appear in the feed',
      visibility: 'public',
      status: 'published',
    });

    const res = await feed(me.accessToken);
    expect(res.body.data.items.every((i) => i.type === 'poem')).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('must never appear in the feed');
  });
});
