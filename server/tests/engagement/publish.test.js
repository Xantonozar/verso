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
    displayName: 'Poet',
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

function publish(token, poemId) {
  return request(app)
    .post(`/api/v1/poems/${poemId}/publish`)
    .set('Authorization', `Bearer ${token}`);
}

function unpublish(token, poemId) {
  return request(app)
    .delete(`/api/v1/poems/${poemId}/publish`)
    .set('Authorization', `Bearer ${token}`);
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

describe('POST /poems/:id/publish — deferred from Phase 2 (user decision)', () => {
  test('draft → 200 published, publishedAt set, private_draft visibility promotes to public', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken); // defaults: draft + private_draft

    const res = await publish(me.accessToken, poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.visibility).toBe('public');
    expect(res.body.data.publishedAt).toBeTruthy();
  });

  test('publish twice → 409 ALREADY_PUBLISHED', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await publish(me.accessToken, poem.id);

    const res = await publish(me.accessToken, poem.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_PUBLISHED');
  });

  test('whitespace-only content → 400 ValidationError with field detail', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken, { content: ' ' });

    const res = await publish(me.accessToken, poem.id);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toBe('Poem cannot be published');
    expect(res.body.error.details[0].field).toBe('content');
    expect(res.body.error.details[0].code).toBe('custom');

    const stored = await Poem.findById(poem.id).lean();
    expect(stored.status).toBe('draft'); // failed publish leaves the draft intact
  });

  test('non-owner → 403; unauthenticated → 401; removed → 404', async () => {
    const owner = await register();
    const other = await register();
    const poem = await createPoem(owner.accessToken);

    const forbidden = await publish(other.accessToken, poem.id);
    expect(forbidden.status).toBe(403);

    const anon = await request(app).post(`/api/v1/poems/${poem.id}/publish`);
    expect(anon.status).toBe(401);

    await Poem.updateOne({ _id: poem.id }, { $set: { status: 'removed' } });
    const gone = await publish(owner.accessToken, poem.id);
    expect(gone.status).toBe(404);
  });
});

describe('DELETE /poems/:id/publish — unpublish', () => {
  test('published → 200 back to draft; repeat → 409 NOT_PUBLISHED', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await publish(me.accessToken, poem.id);

    const res = await unpublish(me.accessToken, poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');

    const again = await unpublish(me.accessToken, poem.id);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOT_PUBLISHED');
  });

  test('republish after unpublish → 200 again', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await publish(me.accessToken, poem.id);
    await unpublish(me.accessToken, poem.id);

    const res = await publish(me.accessToken, poem.id);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
  });

  test('non-owner unpublish → 403', async () => {
    const owner = await register();
    const other = await register();
    const poem = await createPoem(owner.accessToken);
    await publish(owner.accessToken, poem.id);

    const res = await unpublish(other.accessToken, poem.id);
    expect(res.status).toBe(403);
  });
});
