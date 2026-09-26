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

/** Tests own the DB — set lifecycle fields directly (no publish route yet). */
async function setPoemFields(id, fields) {
  await Poem.updateOne({ _id: id }, { $set: fields });
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem, PoemVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('GET /poems/:id — visibility matrix, fail-closed 404 (plan step 39)', () => {
  test('author reads own draft → 200 with author subset projection', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('First Light');
    expect(res.body.data.author.id).toBe(me.user.id);
    expect(res.body.data.author.username).toBe(me.user.username);
    expect(res.body.data.author.profilePhotoUrl).toBe('');
    expect(res.body.data.author).not.toHaveProperty('email');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  test("other user's draft → 404 (existence hidden)", async () => {
    const owner = await register();
    const stranger = await register();
    const poem = await createPoem(owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test('anonymous (no token) draft → 404', async () => {
    const owner = await register();
    const poem = await createPoem(owner.accessToken);
    const res = await request(app).get(`/api/v1/poems/${poem.id}`);
    expect(res.status).toBe(404);
  });

  test('published + public → 200 for anonymous reader', async () => {
    const owner = await register();
    const poem = await createPoem(owner.accessToken, { visibility: 'public' });
    await setPoemFields(poem.id, { status: 'published' });

    const res = await request(app).get(`/api/v1/poems/${poem.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.author.username).toBe(owner.user.username);
    expect(res.body.data.authorId).toBe(owner.user.id);
  });

  test('published + unlisted → 200 for anonymous reader (link-readable)', async () => {
    const owner = await register();
    const poem = await createPoem(owner.accessToken, { visibility: 'unlisted' });
    await setPoemFields(poem.id, { status: 'published' });

    const res = await request(app).get(`/api/v1/poems/${poem.id}`);
    expect(res.status).toBe(200);
  });

  test('published + followers → 200 for follower, 404 for non-follower and anonymous', async () => {
    const owner = await register();
    const follower = await register();
    const stranger = await register();

    const followRes = await request(app)
      .post(`/api/v1/users/${owner.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.accessToken}`);
    expect(followRes.status).toBe(201);

    const poem = await createPoem(owner.accessToken, { visibility: 'followers' });
    await setPoemFields(poem.id, { status: 'published' });

    const asFollower = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${follower.accessToken}`);
    expect(asFollower.status).toBe(200);

    const asStranger = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asStranger.status).toBe(404);

    const asAnonymous = await request(app).get(`/api/v1/poems/${poem.id}`);
    expect(asAnonymous.status).toBe(404);
  });

  test('published + private_draft → 404 for others, 200 for author', async () => {
    const owner = await register();
    const stranger = await register();
    const poem = await createPoem(owner.accessToken, { visibility: 'private_draft' });
    await setPoemFields(poem.id, { status: 'published' });

    const asStranger = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asStranger.status).toBe(404);

    const asAuthor = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asAuthor.status).toBe(200);
  });

  test('removed poem → author 200 (recoverable), moderator 200, stranger 404', async () => {
    const owner = await register();
    const mod = await register();
    const stranger = await register();
    await User.updateOne({ _id: mod.user.id }, { $set: { 'roles.security': 'moderator' } });

    const poem = await createPoem(owner.accessToken, { visibility: 'public' });
    await setPoemFields(poem.id, { status: 'removed' });

    const asStranger = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asStranger.status).toBe(404);

    const asAuthor = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asAuthor.status).toBe(200);
    expect(asAuthor.body.data.status).toBe('removed');

    const asModerator = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`);
    expect(asModerator.status).toBe(200);
  });

  test('anonymous + public poem hides author identity AND authorId', async () => {
    const owner = await register();
    const poem = await createPoem(owner.accessToken, { visibility: 'public', anonymous: true });
    await setPoemFields(poem.id, { status: 'published' });

    const asReader = await request(app).get(`/api/v1/poems/${poem.id}`);
    expect(asReader.status).toBe(200);
    expect(asReader.body.data.anonymous).toBe(true);
    expect(asReader.body.data.author).toBeUndefined();
    expect(asReader.body.data.authorId).toBeUndefined();

    const asAuthor = await request(app)
      .get(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asAuthor.body.data.author.id).toBe(owner.user.id);
    expect(asAuthor.body.data.authorId).toBe(owner.user.id);
  });

  test('unknown id → 404, invalid id → 400 params.id', async () => {
    const res404 = await request(app).get('/api/v1/poems/64b000000000000000000abc');
    expect(res404.status).toBe(404);
    expect(res404.body.error.code).toBe('POEM_NOT_FOUND');

    const res400 = await request(app).get('/api/v1/poems/not-an-id');
    expect(res400.status).toBe(400);
    expect(res400.body.error.details[0].field).toBe('params.id');
  });
});

describe('DELETE /poems/:id — soft delete via status: "removed" (plan step 38)', () => {
  test('owner delete → 200, document survives with status removed, reads 404', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken, { visibility: 'public' });
    await setPoemFields(poem.id, { status: 'published' });

    const del = await request(app)
      .delete(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data).toMatchObject({ deleted: true, status: 'removed' });

    // soft delete — recoverable, not a hard Mongo delete
    const persisted = await Poem.findById(poem.id).lean();
    expect(persisted).not.toBeNull();
    expect(persisted.status).toBe('removed');

    const read = await request(app).get(`/api/v1/poems/${poem.id}`);
    expect(read.status).toBe(404);
  });

  test('non-owner delete → 403 FORBIDDEN', async () => {
    const owner = await register();
    const attacker = await register();
    const poem = await createPoem(owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);
    expect(res.status).toBe(403);

    const persisted = await Poem.findById(poem.id).lean();
    expect(persisted.status).toBe('draft');
  });

  test('unauthenticated delete → 401', async () => {
    const owner = await register();
    const poem = await createPoem(owner.accessToken);
    const res = await request(app).delete(`/api/v1/poems/${poem.id}`);
    expect(res.status).toBe(401);
  });

  test('deleting an already-removed poem → 404 (idempotent visibility)', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);
    await setPoemFields(poem.id, { status: 'removed' });

    const res = await request(app)
      .delete(`/api/v1/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });
});
