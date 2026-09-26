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
  const res = await request(app)
    .post(`/api/v1/poems/${poem.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data;
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

describe('POST /poems/:id/reactions — create (plan steps 45/47)', () => {
  test('valid type → 201, reactionCount $inc to 1', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'loved' });

    expect(res.status).toBe(201);
    expect(res.body.data.reaction.type).toBe('loved');
    expect(res.body.data.stats.reactionCount).toBe(1);
    expect(await Reaction.countDocuments({ targetId: poem.id })).toBe(1);
    expect((await stats(poem.id)).reactionCount).toBe(1);
  });

  test('duplicate type → 409 ALREADY_REACTED, single doc, counter untouched (step 47)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const first = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'dark' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'dark' });

    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_REACTED');
    expect(await Reaction.countDocuments({ targetId: poem.id })).toBe(1);
    expect((await stats(poem.id)).reactionCount).toBe(1);
  });

  test('same user, different type → 201 (reactions are multi-select)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    for (const type of ['loved', 'hurt']) {
      const res = await request(app)
        .post(`/api/v1/poems/${poem.id}/reactions`)
        .set('Authorization', `Bearer ${reader.accessToken}`)
        .send({ type });
      expect(res.status).toBe(201);
    }
    expect(await Reaction.countDocuments({ targetId: poem.id })).toBe(2);
    expect((await stats(poem.id)).reactionCount).toBe(2);
  });

  test('invalid type → 400 field-level VALIDATION_ERROR', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'meh' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toContain('type');
  });

  test('unauthenticated → 401', async () => {
    const author = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app).post(`/api/v1/poems/${poem.id}/reactions`).send({ type: 'loved' });
    expect(res.status).toBe(401);
  });

  test("someone else's draft → 404 POEM_NOT_FOUND (fail-closed)", async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'loved' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test('removed poem → 404 POEM_NOT_FOUND', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);
    await Poem.updateOne({ _id: poem.id }, { $set: { status: 'removed' } });

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'loved' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test('owner may react to their own draft', async () => {
    const author = await register();
    const poem = await createPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ type: 'felt_this' });

    expect(res.status).toBe(201);
  });
});

describe('DELETE /poems/:id/reactions/:type — idempotent toggle (plan step 49)', () => {
  test('remove → 200 removed:true + counter; second remove → 200 removed:false, no double decrement', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'beautiful' });

    const first = await request(app)
      .delete(`/api/v1/poems/${poem.id}/reactions/beautiful`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(first.status).toBe(200);
    expect(first.body.data.removed).toBe(true);
    expect(first.body.data.stats.reactionCount).toBe(0);

    const second = await request(app)
      .delete(`/api/v1/poems/${poem.id}/reactions/beautiful`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(second.status).toBe(200);
    expect(second.body.data.removed).toBe(false);
    expect(second.body.data.stats.reactionCount).toBe(0);
    expect((await stats(poem.id)).reactionCount).toBe(0);
  });

  test('full toggle cycle: add → remove → add again → 201', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'powerful' });
    await request(app)
      .delete(`/api/v1/poems/${poem.id}/reactions/powerful`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    const again = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'powerful' });

    expect(again.status).toBe(201);
    expect((await stats(poem.id)).reactionCount).toBe(1);
  });

  test('unknown reaction type on the delete path → 400', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .delete(`/api/v1/poems/${poem.id}/reactions/nope`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(res.status).toBe(400);
  });
});
