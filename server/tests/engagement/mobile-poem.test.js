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
    displayName: 'Reader',
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
  const res = await publish(token, poem.id);
  expect(res.status).toBe(200);
  return res.body.data;
}

function publish(token, poemId) {
  return request(app)
    .post(`/api/v1/poems/${poemId}/publish`)
    .set('Authorization', `Bearer ${token}`);
}

function getMobile(token, poemId) {
  const req = request(app).get(`/api/v1/mobile/poems/${poemId}`);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
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

describe('GET /mobile/poems/:id — BFF read model (deferred from Phase 2, user decision)', () => {
  test('anonymous request → poem + author + counts, viewer null', async () => {
    const author = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await getMobile(null, poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.poem.id).toBe(poem.id);
    expect(res.body.data.poem.author.username).toBe(author.user.username);
    expect(res.body.data.poem.content).toContain('dawn');
    expect(res.body.data.reactionCounts).toEqual({});
    expect(res.body.data.feltGood).toEqual({ average: null, count: 0 });
    expect(res.body.data.viewer).toBeNull();
  });

  test('aggregates reactions, saves, and felt-good + requester state in one call', async () => {
    const author = await register();
    const reader = await register();
    const other = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'loved' });
    await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ type: 'loved' });
    await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ type: 'dark' });
    await request(app)
      .post(`/api/v1/poems/${poem.id}/save`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    await request(app)
      .post(`/api/v1/poems/${poem.id}/felt-good`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ score: 80 });
    await request(app)
      .post(`/api/v1/poems/${poem.id}/felt-good`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .send({ score: 60 });

    const res = await getMobile(reader.accessToken, poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.poem.stats.reactionCount).toBe(3);
    expect(res.body.data.poem.stats.saveCount).toBe(1);
    expect(res.body.data.poem.stats.commentCount).toBe(0);
    expect(res.body.data.reactionCounts).toEqual({ loved: 2, dark: 1 });
    expect(res.body.data.feltGood).toEqual({ average: 70, count: 2 });
    expect(res.body.data.viewer.reactions).toEqual(['loved']);
    expect(res.body.data.viewer.saved).toBe(true);
    expect(res.body.data.viewer.feltGood).toEqual({ score: 80, comment: '' });
  });

  test('signed-in viewer with no engagement → empty viewer state', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await getMobile(reader.accessToken, poem.id);
    expect(res.body.data.viewer).toEqual({
      reactions: [],
      saved: false,
      feltGood: null,
    });
  });

  test("someone else's draft → 404 POEM_NOT_FOUND", async () => {
    const author = await register();
    const stranger = await register();
    const draft = await createPoem(author.accessToken);

    const res = await getMobile(stranger.accessToken, draft.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test('owner reading own draft → 200 with viewer state', async () => {
    const author = await register();
    const draft = await createPoem(author.accessToken);

    const res = await getMobile(author.accessToken, draft.id);
    expect(res.status).toBe(200);
    expect(res.body.data.poem.status).toBe('draft');
    expect(res.body.data.viewer.saved).toBe(false);
  });

  test('anonymous poem hides authorId from non-owner viewers', async () => {
    const author = await register();
    const stranger = await register();
    const poem = await createPublishedPoem(author.accessToken);
    await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ anonymous: true });

    const asStranger = await getMobile(stranger.accessToken, poem.id);
    expect(asStranger.status).toBe(200);
    expect(asStranger.body.data.poem.authorId).toBeUndefined();
    expect(asStranger.body.data.poem.author).toBeUndefined();

    const asOwner = await getMobile(author.accessToken, poem.id);
    expect(asOwner.body.data.poem.authorId).toBe(author.user.id);
  });

  test('nonexistent id → 404', async () => {
    const res = await getMobile(null, '507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });
});
