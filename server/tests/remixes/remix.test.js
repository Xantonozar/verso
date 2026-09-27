'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Remix } = require('../../src/modules/remixes/remix.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan step 70: remixes — the original must exist and be publicly readable
 * (published AND public/unlisted, requester-independent); one flow creates
 * the new poem (author = remixer, published) and the attribution link, and
 * `GET /poems/:id` exposes `remixOf` for the reader's attribution card.
 */

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(displayName = 'Poet') {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName,
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function seedPoem(authorId, overrides = {}) {
  return Poem.create({
    authorId,
    title: 'Original title',
    content: 'original words that matter',
    status: 'published',
    visibility: 'public',
    publishedAt: new Date(),
    ...overrides,
  });
}

function postRemix(token, body) {
  return request(app)
    .post('/api/v1/remixes')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function remixBody(original, overrides = {}) {
  return {
    originalPoemId: String(original._id),
    title: 'Remixed title',
    content: 'remixed words that matter',
    ...overrides,
  };
}

let alice;
let bob;
let original;

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Poem, PoemVersion, Remix]);
  alice = await register('Alice');
  bob = await register('Bob');
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Poem.deleteMany({}), PoemVersion.deleteMany({}), Remix.deleteMany({})]);
  original = await seedPoem(alice.user.id, { title: 'First draft of dusk' });
});

describe('POST /remixes (plan step 70)', () => {
  test('requires auth; creates a published poem by the remixer plus the link', async () => {
    const unauth = await request(app).post('/api/v1/remixes').send(remixBody(original));
    expect(unauth.status).toBe(401);

    const res = await postRemix(bob.accessToken, remixBody(original, { language: 'en' }));
    expect(res.status).toBe(201);
    expect(res.body.data.remix).toMatchObject({
      originalPoemId: String(original._id),
      remixPoemId: expect.any(String),
    });
    expect(res.body.data.poem).toMatchObject({
      id: res.body.data.remix.remixPoemId,
      authorId: bob.user.id,
      title: 'Remixed title',
      content: 'remixed words that matter',
      status: 'published',
      visibility: 'public',
    });

    // Reader attribution: the new poem points back, the original stays clean.
    const readRemix = await request(app)
      .get(`/api/v1/poems/${res.body.data.poem.id}`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    expect(readRemix.body.data.remixOf).toBe(String(original._id));

    const readOriginal = await request(app).get(`/api/v1/poems/${original._id}`);
    expect(readOriginal.body.data.remixOf).toBeNull();
    expect(readOriginal.body.data.title).toBe('First draft of dusk');
    expect(await Remix.countDocuments({})).toBe(1);
  });

  test('rejects an unknown original with 404 POEM_NOT_FOUND', async () => {
    const res = await postRemix(bob.accessToken, remixBody({ _id: 'a'.repeat(24) }));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
  });

  test('rejects originals that are not publicly readable, even to followers', async () => {
    const draft = await seedPoem(alice.user.id, { status: 'draft' });
    const draftRes = await postRemix(bob.accessToken, remixBody(draft));
    expect(draftRes.status).toBe(400);
    expect(draftRes.body.error.code).toBe('ORIGINAL_NOT_PUBLIC');

    const followersOnly = await seedPoem(alice.user.id, { visibility: 'followers' });
    // Bob follows Alice — still not publicly readable (requester-independent).
    await request(app)
      .post(`/api/v1/users/${alice.user.id}/follow`)
      .set('Authorization', `Bearer ${bob.accessToken}`);
    const followersRes = await postRemix(bob.accessToken, remixBody(followersOnly));
    expect(followersRes.status).toBe(400);
    expect(followersRes.body.error.code).toBe('ORIGINAL_NOT_PUBLIC');

    const privateDraft = await seedPoem(alice.user.id, { visibility: 'private_draft' });
    const privateRes = await postRemix(bob.accessToken, remixBody(privateDraft));
    expect(privateRes.status).toBe(400);
    expect(privateRes.body.error.code).toBe('ORIGINAL_NOT_PUBLIC');
  });

  test('allows an unlisted original and honors poem input fields', async () => {
    const unlisted = await seedPoem(alice.user.id, { visibility: 'unlisted' });
    const res = await postRemix(
      bob.accessToken,
      remixBody(unlisted, {
        authorNote: 'after the original',
        moods: ['wistful'],
        tags: ['dusk'],
        visibility: 'followers',
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data.poem).toMatchObject({
      authorNote: 'after the original',
      moods: ['wistful'],
      tags: ['dusk'],
      visibility: 'followers',
      status: 'published',
    });
  });

  test('validates the body: blank content and bad ids are 400', async () => {
    const blank = await postRemix(
      bob.accessToken,
      remixBody(original, { content: '   ' }),
    );
    expect(blank.status).toBe(400);

    const noTitle = await postRemix(
      bob.accessToken,
      remixBody(original, { title: '' }),
    );
    expect(noTitle.status).toBe(400);

    const badId = await postRemix(bob.accessToken, { ...remixBody(original), originalPoemId: 'nope' });
    expect(badId.status).toBe(400);
  });

  test('multiple remixed variants of the same original are allowed', async () => {
    const one = await postRemix(bob.accessToken, remixBody(original));
    const two = await postRemix(alice.accessToken, remixBody(original, { title: 'Another cut' }));
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(await Remix.countDocuments({ originalPoemId: original._id })).toBe(2);
  });
});
