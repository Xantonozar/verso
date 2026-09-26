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
    .send({
      title: 'First Light',
      content: 'dawn\nspills over\nthe windowsill',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem, PoemVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /poems — create in draft status (plan step 36)', () => {
  test('valid body → 201, draft + private_draft defaults, version 1 snapshotted', async () => {
    const me = await register();
    const data = await createPoem(me.accessToken);

    expect(data.status).toBe('draft');
    expect(data.visibility).toBe('private_draft');
    expect(data.title).toBe('First Light');
    expect(data.content).toContain('windowsill');
    expect(data.currentVersionId).toBeTruthy();
    expect(data.stats).toEqual({ reads: 0, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 });
    expect(data.authorId).toBe(me.user.id);

    const versions = await PoemVersion.find({ poemId: data.id }).lean();
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].content).toBe(data.content);
  });

  test('missing title AND content → 400 field-level VALIDATION_ERROR', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ authorNote: 'no title or body' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'content']));
    expect(res.body.error.details[0].message).toBeTruthy();
  });

  test('blank title → 400 with title detail', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: '   ', content: 'a line' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'title')).toBe(true);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(app).post('/api/v1/poems').send({ title: 'x', content: 'y' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('privileged fields in body are stripped (no mass-assign)', async () => {
    const other = await register();
    const me = await register();
    const data = await createPoem(me.accessToken, {
      status: 'published',
      stats: { reads: 99999 },
      authorId: other.user.id,
      currentVersionId: '64b0000000000000000000ff',
    });

    expect(data.status).toBe('draft');
    expect(data.stats.reads).toBe(0);
    expect(data.authorId).toBe(me.user.id);

    const persisted = await Poem.findById(data.id).lean();
    expect(persisted.status).toBe('draft');
    expect(persisted.authorId.toString()).toBe(me.user.id);
    expect(persisted.stats.reads).toBe(0);
  });
});

describe('PATCH /poems/:id — edit with version history (plan step 37)', () => {
  test('owner edit → 200, new version, cache + currentVersionId updated, v1 intact', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    const v1 = await PoemVersion.find({ poemId: poem.id }).lean();

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'Second Light', content: 'rewritten\nstanzas' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Second Light');
    expect(res.body.data.currentVersionId).not.toBe(poem.currentVersionId);

    const versions = await PoemVersion.find({ poemId: poem.id }).sort({ versionNumber: 1 }).lean();
    expect(versions).toHaveLength(2);
    expect(versions[1].versionNumber).toBe(2);
    expect(versions[1].content).toBe('rewritten\nstanzas');
    // history is never destructively mutated
    expect(versions[0].title).toBe(v1[0].title);
    expect(versions[0].content).toBe(v1[0].content);

    const persisted = await Poem.findById(poem.id).lean();
    expect(persisted.title).toBe('Second Light');
    expect(String(persisted.currentVersionId)).toBe(String(versions[1]._id));
  });

  test('non-owner edit → 403 FORBIDDEN', async () => {
    const owner = await register();
    const attacker = await register();
    const poem = await createPoem(owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ content: 'hijacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const persisted = await Poem.findById(poem.id).lean();
    expect(persisted.content).toBe(poem.content);
  });

  test('moderator edit → 200 (ownership helper allows owner OR moderator)', async () => {
    const owner = await register();
    const mod = await register();
    await User.updateOne({ _id: mod.user.id }, { $set: { 'roles.security': 'moderator' } });
    const poem = await createPoem(owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`)
      .send({ content: 'moderated edit' });

    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('moderated edit');
  });

  test('unauthenticated edit → 401', async () => {
    const owner = await register();
    const poem = await createPoem(owner.accessToken);
    const res = await request(app).patch(`/api/v1/poems/${poem.id}`).send({ content: 'x' });
    expect(res.status).toBe(401);
  });

  test('edit unknown poem → 404 POEM_NOT_FOUND', async () => {
    const me = await register();
    const res = await request(app)
      .patch('/api/v1/poems/64b000000000000000000abc')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test('metadata-only edit (tags) → no redundant version created', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ tags: ['haiku', 'dawn'] });

    expect(res.status).toBe(200);
    expect(res.body.data.tags).toEqual(['haiku', 'dawn']);
    expect(await PoemVersion.countDocuments({ poemId: poem.id })).toBe(1);
  });

  test('empty body → 400 with (root) detail', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === '(root)')).toBe(true);
  });

  test('privileged fields in patch are ignored (status/authorId/stats)', async () => {
    const other = await register();
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await request(app)
      .patch(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'Kept', status: 'published', authorId: other.user.id, stats: { reads: 5 } });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.authorId).toBe(me.user.id);

    const persisted = await Poem.findById(poem.id).lean();
    expect(persisted.status).toBe('draft');
    expect(persisted.authorId.toString()).toBe(me.user.id);
    expect(persisted.stats.reads).toBe(0);
  });

  test('invalid id param → 400 params.id', async () => {
    const me = await register();
    const res = await request(app)
      .patch('/api/v1/poems/not-an-id')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('params.id');
  });
});
