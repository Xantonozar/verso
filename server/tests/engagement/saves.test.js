'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Reaction } = require('../../src/modules/engagement/reaction.model');
const { FeltGoodRating } = require('../../src/modules/engagement/felt-good-rating.model');
const { Comment } = require('../../src/modules/engagement/comment.model');
const { Save } = require('../../src/modules/engagement/save.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Saver',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function createPoem(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'First Light', content: 'dawn\nspills over', ...overrides });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function createPublishedPoem(token) {
  const poem = await createPoem(token, { visibility: 'public' });
  const res = await request(app)
    .post(`/api/v1/poems/${poem.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function savePoem(token, poemId) {
  return request(app)
    .post(`/api/v1/poems/${poemId}/save`)
    .set('Authorization', `Bearer ${token}`);
}

async function unsavePoem(token, poemId) {
  return request(app)
    .delete(`/api/v1/poems/${poemId}/save`)
    .set('Authorization', `Bearer ${token}`);
}

async function stats(poemId) {
  const doc = await Poem.findById(poemId).select('stats').lean();
  return doc.stats;
}

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Follow,
    Poem,
    PoemVersion,
    Reaction,
    FeltGoodRating,
    Comment,
    Save,
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /poems/:id/save — idempotent toggle (plan step 49)', () => {
  test('first save → saved:true + saveCount 1', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await savePoem(reader.accessToken, poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.saved).toBe(true);
    expect(res.body.data.stats.saveCount).toBe(1);
    expect(await Save.countDocuments({ poemId: poem.id })).toBe(1);
    expect((await stats(poem.id)).saveCount).toBe(1);
  });

  test('repeat save → 200 saved:true, counter untouched (idempotent)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await savePoem(reader.accessToken, poem.id);
    const again = await savePoem(reader.accessToken, poem.id);

    expect(again.status).toBe(200);
    expect(again.body.data.saved).toBe(true);
    expect(again.body.data.stats.saveCount).toBe(1);
    expect(await Save.countDocuments({ poemId: poem.id })).toBe(1);
    expect((await stats(poem.id)).saveCount).toBe(1);
  });

  test('unauthenticated → 401; not viewable → 404', async () => {
    const author = await register();
    const stranger = await register();
    const draft = await createPoem(author.accessToken);

    expect((await request(app).post(`/api/v1/poems/${draft.id}/save`)).status).toBe(401);

    const res = await savePoem(stranger.accessToken, draft.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });
});

describe('DELETE /poems/:id/save — idempotent untoggle', () => {
  test('remove → saveCount 0; second remove → 200, counter never negative', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await savePoem(reader.accessToken, poem.id);

    const first = await unsavePoem(reader.accessToken, poem.id);
    expect(first.status).toBe(200);
    expect(first.body.data.saved).toBe(false);
    expect(first.body.data.stats.saveCount).toBe(0);

    const second = await unsavePoem(reader.accessToken, poem.id);
    expect(second.status).toBe(200);
    expect(second.body.data.saved).toBe(false);
    expect(second.body.data.stats.saveCount).toBe(0);
    expect((await stats(poem.id)).saveCount).toBe(0);
  });

  test('save → unsave → save cycle keeps the counter exact', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await savePoem(reader.accessToken, poem.id);
    await unsavePoem(reader.accessToken, poem.id);
    const res = await savePoem(reader.accessToken, poem.id);

    expect(res.body.data.saved).toBe(true);
    expect((await stats(poem.id)).saveCount).toBe(1);
    expect(await Save.countDocuments({ poemId: poem.id, userId: reader.user.id })).toBe(1);
  });
});
