'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { DiaryEntry } = require('../../src/modules/diary/diary.model');
const { Collection } = require('../../src/modules/collections/collection.model');
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
    displayName: 'Curator',
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
  return Poem.create({
    authorId,
    title: `C${i.toString(36)}`,
    content: `a curated line ${i} settles into someone's reading list for the evening`,
    status: 'published',
    visibility: 'public',
    publishedAt: new Date(),
    ...overrides,
  });
}

async function makeCollection(token, body = { title: 'Night reads' }) {
  const res = await request(app)
    .post('/api/v1/collections')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.data;
}

function addPoem(token, collectionId, poemId) {
  return request(app)
    .post(`/api/v1/collections/${collectionId}/poems`)
    .set('Authorization', `Bearer ${token}`)
    .send({ poemId });
}

function getCollection(token, id) {
  const r = request(app).get(`/api/v1/collections/${id}`);
  if (token) r.set('Authorization', `Bearer ${token}`);
  return r;
}

/** createdAt is immutable on mongoose docs — set it via the native driver. */
async function setCreatedAt(id, iso) {
  await Collection.collection.updateOne({ _id: id }, { $set: { createdAt: new Date(iso) } });
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow, Poem, DiaryEntry, Collection]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /collections — create (plan 58)', () => {
  test('401 without a token', async () => {
    const res = await request(app).post('/api/v1/collections').send({ title: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('201 with defaults: public, empty poemIds, trimmed title', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/collections')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: '  Quiet hours  ' });

    expect(res.status).toBe(201);
    expect(res.body.data.title).toBe('Quiet hours');
    expect(res.body.data.visibility).toBe('public');
    expect(res.body.data.description).toBe('');
    expect(res.body.data.poemIds).toEqual([]);
    expect(res.body.data.poemCount).toBe(0);
    expect(res.body.data.ownerId).toBe(me.user.id);
  });

  test('400 on empty title with field-level details', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/collections')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: '   ' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].field).toBe('title');
  });

  test('400 on visibility outside public/followers/private', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/collections')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'ok', visibility: 'unlisted' });

    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('visibility');
  });
});

describe('GET /collections — list mine (plan 59)', () => {
  test('401 without a token', async () => {
    const res = await request(app).get('/api/v1/collections');
    expect(res.status).toBe(401);
  });

  test('returns only the requester\u2019s collections', async () => {
    const me = await register();
    const other = await register();
    const mineA = await makeCollection(me.accessToken, { title: 'Mine A' });
    const mineB = await makeCollection(me.accessToken, { title: 'Mine B' });
    await makeCollection(other.accessToken, { title: 'Not mine' });

    const res = await request(app)
      .get('/api/v1/collections')
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((c) => c.id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(mineA.id);
    expect(ids).toContain(mineB.id);
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('cursor pagination: limit 2 then the rest, no overlap', async () => {
    const me = await register();
    const a = await makeCollection(me.accessToken, { title: 'Page A' });
    const b = await makeCollection(me.accessToken, { title: 'Page B' });
    const c = await makeCollection(me.accessToken, { title: 'Page C' });
    await setCreatedAt(a.id, '2026-01-01T00:00:00.000Z');
    await setCreatedAt(b.id, '2026-01-02T00:00:00.000Z');
    await setCreatedAt(c.id, '2026-01-03T00:00:00.000Z');

    const first = await request(app)
      .get('/api/v1/collections?limit=2')
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(first.status).toBe(200);
    expect(first.body.data.items.map((x) => x.id)).toEqual([c.id, b.id]);
    const { nextCursor } = first.body.data;
    expect(nextCursor).toBeTruthy();

    const second = await request(app)
      .get(`/api/v1/collections?limit=2&cursor=${encodeURIComponent(nextCursor)}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(second.status).toBe(200);
    expect(second.body.data.items.map((x) => x.id)).toEqual([a.id]);
    expect(second.body.data.nextCursor).toBeNull();
  });
});

describe('GET /collections/:id — visibility matrix (same as poem/diary)', () => {
  test('public: stranger and anonymous both read it', async () => {
    const owner = await register();
    const stranger = await register();
    const col = await makeCollection(owner.accessToken, { title: 'Public shelf' });

    const authed = await getCollection(stranger.accessToken, col.id);
    expect(authed.status).toBe(200);
    expect(authed.body.data.id).toBe(col.id);

    const anon = await getCollection(null, col.id);
    expect(anon.status).toBe(200);
  });

  test('private: stranger 404 (existence hidden), owner 200', async () => {
    const owner = await register();
    const stranger = await register();
    const col = await makeCollection(owner.accessToken, {
      title: 'Secret shelf',
      visibility: 'private',
    });

    const denied = await getCollection(stranger.accessToken, col.id);
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('COLLECTION_NOT_FOUND');

    const anon = await getCollection(null, col.id);
    expect(anon.status).toBe(404);

    const mine = await getCollection(owner.accessToken, col.id);
    expect(mine.status).toBe(200);
  });

  test('followers: follower reads, non-follower 404', async () => {
    const owner = await register();
    const follower = await register();
    const stranger = await register();
    await follow(follower.accessToken, owner.user.id);
    const col = await makeCollection(owner.accessToken, {
      title: 'Followers shelf',
      visibility: 'followers',
    });

    expect((await getCollection(follower.accessToken, col.id)).status).toBe(200);
    expect((await getCollection(stranger.accessToken, col.id)).status).toBe(404);
    expect((await getCollection(null, col.id)).status).toBe(404);
  });

  test('invalid id format 400', async () => {
    const me = await register();
    const res = await getCollection(me.accessToken, 'not-an-id');
    expect(res.status).toBe(400);
  });
});

describe('GET /collections/:id — poem hydration', () => {
  test('hydrates poems in poemIds order with type/author, batched', async () => {
    const me = await register();
    const col = await makeCollection(me.accessToken);
    const a = await seedPoem(me.user.id, { title: 'First in list' });
    const b = await seedPoem(me.user.id, { title: 'Second in list' });
    expect((await addPoem(me.accessToken, col.id, a.id)).status).toBe(201);
    expect((await addPoem(me.accessToken, col.id, b.id)).status).toBe(201);

    const res = await getCollection(me.accessToken, col.id);

    expect(res.status).toBe(200);
    expect(res.body.data.poems.map((p) => p.id)).toEqual([String(a._id), String(b._id)]);
    expect(res.body.data.poems[0].type).toBe('poem');
    expect(res.body.data.poems[0].author.id).toBe(me.user.id);
    expect(res.body.data.poemCount).toBe(2);
  });

  test('anonymous poem hides its author from other viewers', async () => {
    const me = await register();
    const viewer = await register();
    const col = await makeCollection(me.accessToken, { title: 'Anon shelf', visibility: 'public' });
    const anon = await seedPoem(me.user.id, { anonymous: true, title: 'Signed nobody' });
    await addPoem(me.accessToken, col.id, anon.id);

    const res = await getCollection(viewer.accessToken, col.id);

    expect(res.status).toBe(200);
    expect(res.body.data.poems).toHaveLength(1);
    expect(res.body.data.poems[0].anonymous).toBe(true);
    expect(res.body.data.poems[0].author).toBeNull();
  });

  test('poem that becomes unviewable drops out for strangers, stays for owner', async () => {
    const me = await register();
    const stranger = await register();
    const col = await makeCollection(me.accessToken, { title: 'Draft shelf', visibility: 'public' });
    const poem = await seedPoem(me.user.id, { title: 'Will be unpublished' });
    await addPoem(me.accessToken, col.id, poem.id);
    await Poem.collection.updateOne(
      { _id: poem._id },
      { $set: { status: 'draft', visibility: 'private_draft' } },
    );

    const ownerView = await getCollection(me.accessToken, col.id);
    expect(ownerView.body.data.poems).toHaveLength(1);

    const strangerView = await getCollection(stranger.accessToken, col.id);
    expect(strangerView.status).toBe(200);
    expect(strangerView.body.data.poems).toEqual([]);
    expect(strangerView.body.data.poemCount).toBe(1); // membership, not visibility
  });
});

describe('POST /collections/:id/poems — add (plan 59)', () => {
  test('401 without a token', async () => {
    const owner = await register();
    const col = await makeCollection(owner.accessToken);
    const poem = await seedPoem(owner.user.id);
    const res = await request(app)
      .post(`/api/v1/collections/${col.id}/poems`)
      .send({ poemId: poem.id });
    expect(res.status).toBe(401);
  });

  test('non-owner of a viewable collection 403, private stays 404', async () => {
    const owner = await register();
    const stranger = await register();
    const poem = await seedPoem(owner.user.id);
    const shared = await makeCollection(owner.accessToken, { title: 'Public' });
    const secret = await makeCollection(owner.accessToken, {
      title: 'Private',
      visibility: 'private',
    });

    const forbidden = await addPoem(stranger.accessToken, shared.id, poem.id);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const hidden = await addPoem(stranger.accessToken, secret.id, poem.id);
    expect(hidden.status).toBe(404);
  });

  test('nonexistent collection 404', async () => {
    const me = await register();
    const poem = await seedPoem(me.user.id);
    const res = await addPoem(me.accessToken, '0'.repeat(24), poem.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COLLECTION_NOT_FOUND');
  });

  test('nonexistent poem and diary id both 404 POEM_NOT_FOUND', async () => {
    const me = await register();
    const col = await makeCollection(me.accessToken);

    const ghost = await addPoem(me.accessToken, col.id, '0'.repeat(24));
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('POEM_NOT_FOUND');

    const diary = await DiaryEntry.create({ authorId: me.user.id, content: 'one line' });
    const asPoem = await addPoem(me.accessToken, col.id, String(diary._id));
    expect(asPoem.status).toBe(404);
    expect(asPoem.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test("another author's private draft 404, own draft 201", async () => {
    const me = await register();
    const other = await register();
    const col = await makeCollection(me.accessToken);

    const theirs = await seedPoem(other.user.id, {
      status: 'draft',
      visibility: 'private_draft',
      publishedAt: null,
    });
    expect((await addPoem(me.accessToken, col.id, theirs.id)).status).toBe(404);

    const mine = await seedPoem(me.user.id, { status: 'draft', visibility: 'private_draft' });
    const okRes = await addPoem(me.accessToken, col.id, mine.id);
    expect(okRes.status).toBe(201);
    expect(okRes.body.data.poemIds).toContain(String(mine._id));
    expect(okRes.body.data.poemCount).toBe(1);
  });

  test('success adds a stranger\u2019s public poem; duplicate 409', async () => {
    const me = await register();
    const poet = await register();
    const col = await makeCollection(me.accessToken);
    const poem = await seedPoem(poet.user.id);

    const first = await addPoem(me.accessToken, col.id, poem.id);
    expect(first.status).toBe(201);
    expect(first.body.data.poemIds).toEqual([String(poem._id)]);

    const dup = await addPoem(me.accessToken, col.id, poem.id);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('POEM_IN_COLLECTION');
  });
});

describe('DELETE /collections/:id/poems/:poemId — remove (plan 59)', () => {
  test('owner removes: 204 and the poem is gone from the list', async () => {
    const me = await register();
    const col = await makeCollection(me.accessToken);
    const poem = await seedPoem(me.user.id);
    await addPoem(me.accessToken, col.id, poem.id);

    const res = await request(app)
      .delete(`/api/v1/collections/${col.id}/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(204);

    const after = await getCollection(me.accessToken, col.id);
    expect(after.body.data.poemIds).toEqual([]);
    expect(after.body.data.poemCount).toBe(0);
  });

  test('poem not in the collection 404 POEM_NOT_IN_COLLECTION', async () => {
    const me = await register();
    const col = await makeCollection(me.accessToken);
    const poem = await seedPoem(me.user.id);

    const res = await request(app)
      .delete(`/api/v1/collections/${col.id}/poems/${poem.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_IN_COLLECTION');
  });

  test('non-owner 403; invalid poem id 400', async () => {
    const owner = await register();
    const stranger = await register();
    const col = await makeCollection(owner.accessToken);
    const poem = await seedPoem(owner.user.id);
    await addPoem(owner.accessToken, col.id, poem.id);

    const forbidden = await request(app)
      .delete(`/api/v1/collections/${col.id}/poems/${poem.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(forbidden.status).toBe(403);
    expect(forbidden.body.error.code).toBe('FORBIDDEN');

    const badId = await request(app)
      .delete(`/api/v1/collections/${col.id}/poems/nope`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(badId.status).toBe(400);
  });
});
