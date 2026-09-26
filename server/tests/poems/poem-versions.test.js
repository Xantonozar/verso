'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
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
    .send({ title: 'First Light', content: 'dawn spills over', ...overrides });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function editPoem(token, id, body) {
  const res = await request(app)
    .patch(`/api/v1/poems/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(200);
  return res.body.data;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem, PoemVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('GET /poems/:id/versions — paginated history (plan step 40)', () => {
  test('owner lists versions newest-first with version numbers', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await editPoem(me.accessToken, poem.id, { title: 'Second', content: 'v2 body' });
    await editPoem(me.accessToken, poem.id, { content: 'v3 body' });

    const res = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(res.body.data.items[0].content).toBe('v3 body');
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('cursor pagination: limit=1 pages through history, cursor ends with null', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await editPoem(me.accessToken, poem.id, { content: 'v2' });
    await editPoem(me.accessToken, poem.id, { content: 'v3' });

    const page1 = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions?limit=1`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.items[0].versionNumber).toBe(3);
    expect(page1.body.data.nextCursor).toBe('3');

    const page2 = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions?limit=1&cursor=${page1.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page2.body.data.items[0].versionNumber).toBe(2);
    expect(page2.body.data.nextCursor).toBe('2');

    const page3 = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions?limit=1&cursor=${page2.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page3.body.data.items[0].versionNumber).toBe(1);
    expect(page3.body.data.nextCursor).toBeNull();
  });

  test('non-owner → 403, unauthenticated → 401, unknown poem → 404', async () => {
    const owner = await register();
    const stranger = await register();
    const poem = await createPoem(owner.accessToken);

    const asStranger = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asStranger.status).toBe(403);

    const asAnonymous = await request(app).get(`/api/v1/poems/${poem.id}/versions`);
    expect(asAnonymous.status).toBe(401);

    const asUnknown = await request(app)
      .get('/api/v1/poems/64b000000000000000000abc/versions')
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asUnknown.status).toBe(404);
  });

  test('bad query params → 400 with query.* field details', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const badCursor = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions?cursor=abc`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(badCursor.status).toBe(400);
    expect(badCursor.body.error.details[0].field).toBe('query.cursor');

    const badLimit = await request(app)
      .get(`/api/v1/poems/${poem.id}/versions?limit=999`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(badLimit.status).toBe(400);
    expect(badLimit.body.error.details[0].field).toBe('query.limit');
  });
});

describe('PUT /poems/:id/draft — idempotent autosave (plan step 41)', () => {
  test('changed content → 200 changed:true, draftSavedAt set, NO version created', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'First Light (WIP)', content: 'edited in place' });

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(res.body.data.savedAt).toBeTruthy();

    expect(await PoemVersion.countDocuments({ poemId: poem.id })).toBe(1);
    const persisted = await Poem.findById(poem.id).lean();
    expect(persisted.content).toBe('edited in place');
    expect(persisted.draftSavedAt).toBeTruthy();
    // autosave never touches version history
    expect(String(persisted.currentVersionId)).toBe(poem.currentVersionId);
  });

  test('identical payload → 200 changed:false, no write, no version', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    const body = { title: 'First Light', content: 'edited body' };

    const first = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send(body);
    expect(first.body.data.changed).toBe(true);

    const second = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.data.changed).toBe(false);

    expect(await PoemVersion.countDocuments({ poemId: poem.id })).toBe(1);
  });

  test('partial patch (content only) preserves the title', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'just the body' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('First Light');
    expect(res.body.data.content).toBe('just the body');
  });

  test('non-owner autosave → 403 (assertOwner, moderators excluded too)', async () => {
    const owner = await register();
    const stranger = await register();
    const poem = await createPoem(owner.accessToken);

    const res = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${stranger.accessToken}`)
      .send({ content: 'hijack' });
    expect(res.status).toBe(403);
  });

  test('non-draft poem → 409 NOT_A_DRAFT (guard for post-publish world)', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await Poem.updateOne({ _id: poem.id }, { $set: { status: 'published' } });

    const res = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'nope' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_A_DRAFT');
  });

  test('unauthenticated → 401, unknown poem → 404, empty body → 400', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const anon = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .send({ content: 'x' });
    expect(anon.status).toBe(401);

    const unknown = await request(app)
      .put('/api/v1/poems/64b000000000000000000abc/draft')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'x' });
    expect(unknown.status).toBe(404);

    const empty = await request(app)
      .put(`/api/v1/poems/${poem.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(empty.status).toBe(400);
    expect(empty.body.error.details.some((d) => d.field === '(root)')).toBe(true);
  });
});
