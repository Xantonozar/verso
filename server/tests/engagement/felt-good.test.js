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
    displayName: 'Critic',
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

async function rate(token, poemId, body) {
  return request(app)
    .post(`/api/v1/poems/${poemId}/felt-good`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
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

describe('POST /poems/:id/felt-good — first rating (plan steps 45/47)', () => {
  test('score 0 and 100 (bounds) → 201, persisted', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const low = await rate(reader.accessToken, poem.id, { score: 0 });
    expect(low.status).toBe(201);
    expect(low.body.data.score).toBe(0);

    const reader2 = await register();
    const high = await rate(reader2.accessToken, poem.id, { score: 100, comment: 'stuck with me' });
    expect(high.status).toBe(201);
    expect(high.body.data.score).toBe(100);
    expect(high.body.data.comment).toBe('stuck with me');
    expect(await FeltGoodRating.countDocuments({ poemId: poem.id })).toBe(2);
  });

  test('duplicate POST → 409 ALREADY_RATED, one doc (step 47)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    expect((await rate(reader.accessToken, poem.id, { score: 70 })).status).toBe(201);
    const dup = await rate(reader.accessToken, poem.id, { score: 30 });

    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_RATED');
    expect(await FeltGoodRating.countDocuments({ poemId: poem.id })).toBe(1);
    const stored = await FeltGoodRating.findOne({ poemId: poem.id, userId: reader.user.id }).lean();
    expect(stored.score).toBe(70); // dup POST must not have overwritten
  });

  test('score 101 → 400 (server-side range check, slider bypassed)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await rate(reader.accessToken, poem.id, { score: 101 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toContain('score');
  });

  test('score -1 → 400; non-integer 50.5 → 400; missing score → 400', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    expect((await rate(reader.accessToken, poem.id, { score: -1 })).status).toBe(400);
    expect((await rate(reader.accessToken, poem.id, { score: 50.5 })).status).toBe(400);
    expect((await rate(reader.accessToken, poem.id, {})).status).toBe(400);
    expect(await FeltGoodRating.countDocuments({ poemId: poem.id })).toBe(0);
  });

  test('comment over 500 chars → 400', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await rate(reader.accessToken, poem.id, { score: 10, comment: 'x'.repeat(501) });
    expect(res.status).toBe(400);
  });

  test('unauthenticated → 401; not viewable target → 404', async () => {
    const author = await register();
    const stranger = await register();
    const poem = await createPoem(author.accessToken);

    const anon = await request(app).post(`/api/v1/poems/${poem.id}/felt-good`).send({ score: 50 });
    expect(anon.status).toBe(401);

    const forbidden = await rate(stranger.accessToken, poem.id, { score: 50 });
    expect(forbidden.status).toBe(404);
    expect(forbidden.body.error.code).toBe('POEM_NOT_FOUND');
  });
});

describe('PATCH /poems/:id/felt-good — update path instead of re-POST (step 47)', () => {
  test('PATCH updates the existing rating in place (still one doc)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await rate(reader.accessToken, poem.id, { score: 40, comment: 'first take' });
    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}/felt-good`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ score: 90 });

    expect(res.status).toBe(200);
    expect(res.body.data.score).toBe(90);
    expect(res.body.data.comment).toBe('first take'); // comment preserved when omitted
    expect(await FeltGoodRating.countDocuments({ poemId: poem.id, userId: reader.user.id })).toBe(1);

    const second = await request(app)
      .patch(`/api/v1/poems/${poem.id}/felt-good`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ score: 95, comment: 'second take' });
    expect(second.status).toBe(200);
    expect(second.body.data.score).toBe(95);
    expect(second.body.data.comment).toBe('second take');
    expect(await FeltGoodRating.countDocuments({ poemId: poem.id })).toBe(1);
  });

  test('PATCH with no prior rating → 404 FELT_GOOD_NOT_RATED', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}/felt-good`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ score: 60 });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('FELT_GOOD_NOT_RATED');
  });

  test('PATCH with out-of-range score → 400', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);
    await rate(reader.accessToken, poem.id, { score: 50 });

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}/felt-good`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ score: 200 });

    expect(res.status).toBe(400);
    const stored = await FeltGoodRating.findOne({ poemId: poem.id, userId: reader.user.id }).lean();
    expect(stored.score).toBe(50); // failed PATCH must not corrupt the rating
  });
});
