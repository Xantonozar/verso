'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Prompt } = require('../../src/modules/prompts/prompt.model');
const { PromptSubmission } = require('../../src/modules/prompts/prompt-submission.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan step 69: weekly prompts — current-prompt selection (weekOf <= now),
 * submission entry point (own + published, unique per (prompt, user) → 409),
 * batch-hydrated submissions list that drops rows the requester cannot view.
 * GET /poems/mine (prompt-submission picker) is covered here too.
 */

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `p${Date.now().toString(36)}${(seq++).toString(36)}`;
const DAY = 86_400_000;

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
    title: 'Seed poem',
    content: 'seed words here',
    status: 'published',
    visibility: 'public',
    publishedAt: new Date(),
    ...overrides,
  });
}

async function seedPrompt(overrides = {}) {
  return Prompt.create({
    text: 'Write about rain',
    weekOf: new Date(Date.now() - 2 * DAY),
    ...overrides,
  });
}

function submitPoem(token, promptId, poemId) {
  return request(app)
    .post(`/api/v1/prompts/${promptId}/submissions`)
    .set('Authorization', `Bearer ${token}`)
    .send({ poemId });
}

function current(token) {
  const req = request(app).get('/api/v1/prompts/current');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

function submissionsList(promptId, query = '') {
  return request(app).get(`/api/v1/prompts/${promptId}/submissions${query}`);
}

let alice;
let bob;
let poemAlice;
let poemBob;

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Poem,
    PoemVersion,
    Prompt,
    PromptSubmission,
  ]);
  alice = await register('Alice');
  bob = await register('Bob');
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Prompt.deleteMany({}), PromptSubmission.deleteMany({}), Poem.deleteMany({})]);
  poemAlice = await seedPoem(alice.user.id, { title: 'Mine' });
  poemBob = await seedPoem(bob.user.id, { title: 'Theirs' });
});

describe('GET /prompts/current (plan step 69)', () => {
  test('404 NO_PROMPT when no prompt covers the current week', async () => {
    const none = await current();
    expect(none.status).toBe(404);
    expect(none.body.error.code).toBe('NO_PROMPT');

    await seedPrompt({ text: 'Future prompt', weekOf: new Date(Date.now() + DAY) });
    const futureOnly = await current();
    expect(futureOnly.status).toBe(404);
    expect(futureOnly.body.error.code).toBe('NO_PROMPT');
  });

  test('returns the newest prompt whose weekOf is in the past', async () => {
    await seedPrompt({ text: 'Older week', weekOf: new Date(Date.now() - 9 * DAY) });
    const active = await seedPrompt({
      text: 'Current week',
      weekOf: new Date(Date.now() - 2 * DAY),
    });
    await seedPrompt({ text: 'Next week', weekOf: new Date(Date.now() + 5 * DAY) });

    const res = await current();
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: String(active._id),
      text: 'Current week',
      mySubmission: null,
    });
  });

  test('with a session, includes my submission once submitted', async () => {
    const prompt = await seedPrompt();
    await submitPoem(alice.accessToken, String(prompt._id), String(poemAlice._id));

    const mine = await current(alice.accessToken);
    expect(mine.body.data.mySubmission).toMatchObject({
      promptId: String(prompt._id),
      poemId: String(poemAlice._id),
    });

    const others = await current(bob.accessToken);
    expect(others.body.data.mySubmission).toBeNull();
  });
});

describe('POST /prompts/:id/submissions (plan step 69)', () => {
  test('accepts the caller\'s own published poem; duplicates are 409', async () => {
    const prompt = await seedPrompt();

    const unauth = await request(app)
      .post(`/api/v1/prompts/${prompt._id}/submissions`)
      .send({ poemId: String(poemAlice._id) });
    expect(unauth.status).toBe(401);

    const res = await submitPoem(alice.accessToken, String(prompt._id), String(poemAlice._id));
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      promptId: String(prompt._id),
      poemId: String(poemAlice._id),
    });

    const dup = await submitPoem(alice.accessToken, String(prompt._id), String(poemAlice._id));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_SUBMITTED');
    expect(await PromptSubmission.countDocuments({ promptId: prompt._id })).toBe(1);
  });

  test('rejects other people\'s poems, drafts, and unknown ids', async () => {
    const prompt = await seedPrompt();

    const foreign = await submitPoem(bob.accessToken, String(prompt._id), String(poemAlice._id));
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('FORBIDDEN');

    const draft = await seedPoem(alice.user.id, { status: 'draft' });
    const draftRes = await submitPoem(
      alice.accessToken,
      String(prompt._id),
      String(draft._id),
    );
    expect(draftRes.status).toBe(400);
    expect(draftRes.body.error.code).toBe('POEM_NOT_PUBLISHED');

    const noPrompt = await submitPoem(alice.accessToken, 'd'.repeat(24), String(poemAlice._id));
    expect(noPrompt.status).toBe(404);
    expect(noPrompt.body.error.code).toBe('PROMPT_NOT_FOUND');

    const noPoem = await submitPoem(alice.accessToken, String(prompt._id), 'e'.repeat(24));
    expect(noPoem.status).toBe(404);
    expect(noPoem.body.error.code).toBe('POEM_NOT_FOUND');
  });
});

describe('GET /prompts/:id/submissions (plan step 69)', () => {
  test('404 for an unknown prompt; empty page otherwise', async () => {
    const missing = await submissionsList('f'.repeat(24));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('PROMPT_NOT_FOUND');

    const prompt = await seedPrompt();
    const empty = await submissionsList(String(prompt._id));
    expect(empty.status).toBe(200);
    expect(empty.body.data.items).toEqual([]);
    expect(empty.body.data.nextCursor).toBeNull();
  });

  test('hydrates poems as feed items with batched authors, anonymous stripped', async () => {
    const prompt = await seedPrompt();
    const anon = await seedPoem(alice.user.id, { title: 'Veil', anonymous: true });
    // One submission per (prompt, user): Alice submits her anonymous poem,
    // Bob submits his — the unique index rejects a second row per user.
    await submitPoem(alice.accessToken, String(prompt._id), String(anon._id));
    await submitPoem(bob.accessToken, String(prompt._id), String(poemBob._id));

    const res = await submissionsList(String(prompt._id));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);

    const byPoem = new Map(res.body.data.items.map((i) => [i.poemId, i]));
    const theirs = byPoem.get(String(poemBob._id));
    expect(theirs.poem).toMatchObject({
      type: 'poem',
      id: String(poemBob._id),
      title: 'Theirs',
      status: 'published',
    });
    expect(theirs.poem.excerpt).toContain('seed words');
    expect(theirs.poem.author.username).toBe(bob.user.username);

    const hidden = byPoem.get(String(anon._id));
    expect(hidden.poem.title).toBe('Veil');
    expect(hidden.poem.author).toBeNull();
    expect('authorId' in hidden.poem).toBe(false);
  });

  test('drops submissions whose poem is no longer viewable by the requester', async () => {
    const prompt = await seedPrompt();
    await submitPoem(alice.accessToken, String(prompt._id), String(poemAlice._id));
    await submitPoem(bob.accessToken, String(prompt._id), String(poemBob._id));

    // Alice unpublishes after submitting — strangers no longer see it.
    await Poem.updateOne({ _id: poemAlice._id }, { $set: { status: 'draft' } });

    const asBob = await submissionsList(String(prompt._id));
    expect(asBob.body.data.items).toHaveLength(1);
    expect(asBob.body.data.items[0].poemId).toBe(String(poemBob._id));

    // The author still sees their own row (canView: owner).
    const asAlice = await submissionsList(
      String(prompt._id),
      `?limit=10`,
    ).set('Authorization', `Bearer ${alice.accessToken}`);
    expect(asAlice.body.data.items).toHaveLength(2);
  });

  test('pages with a cursor', async () => {
    const prompt = await seedPrompt();
    await submitPoem(alice.accessToken, String(prompt._id), String(poemAlice._id));
    await new Promise((r) => setTimeout(r, 5));
    await submitPoem(bob.accessToken, String(prompt._id), String(poemBob._id));

    const page1 = await submissionsList(String(prompt._id), '?limit=1');
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.items[0].poemId).toBe(String(poemBob._id));
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await submissionsList(
      String(prompt._id),
      `?limit=1&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
    );
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.items[0].poemId).toBe(String(poemAlice._id));
    expect(page2.body.data.nextCursor).toBeNull();
  });
});

describe('GET /poems/mine — prompt submission picker (Phase 9)', () => {
  test('requires auth', async () => {
    const res = await request(app).get('/api/v1/poems/mine');
    expect(res.status).toBe(401);
  });

  test('returns only the caller\'s poems, newest first, status filterable', async () => {
    await Poem.deleteMany({}); // drop the beforeEach fixtures for exact titles
    await seedPoem(bob.user.id, { title: 'Not mine' });
    await seedPoem(alice.user.id, { title: 'Older own', createdAt: new Date(Date.now() - 1000) });
    await seedPoem(alice.user.id, { title: 'Newer own' });
    await seedPoem(alice.user.id, { title: 'My draft', status: 'draft' });

    const res = await request(app)
      .get('/api/v1/poems/mine')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i) => i.title)).toEqual([
      'My draft',
      'Newer own',
      'Older own',
    ]);
    expect(res.body.data.items.every((i) => i.type === 'poem')).toBe(true);

    const publishedOnly = await request(app)
      .get('/api/v1/poems/mine?status=published')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(publishedOnly.body.data.items.map((i) => i.title)).toEqual([
      'Newer own',
      'Older own',
    ]);
  });

  test('pages with a cursor', async () => {
    await Poem.deleteMany({}); // drop the beforeEach fixtures for exact titles
    await seedPoem(alice.user.id, { title: 'First', createdAt: new Date(Date.now() - 2000) });
    await seedPoem(alice.user.id, { title: 'Second', createdAt: new Date(Date.now() - 1000) });

    const page1 = await request(app)
      .get('/api/v1/poems/mine?limit=1')
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.items[0].title).toBe('Second');
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(
        `/api/v1/poems/mine?limit=1&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${alice.accessToken}`);
    expect(page2.body.data.items[0].title).toBe('First');
    expect(page2.body.data.nextCursor).toBeNull();
  });
});
