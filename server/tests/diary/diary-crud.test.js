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
const { DiaryEntry } = require('../../src/modules/diary/diary.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Diaryist',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function postDiary(token, body) {
  const res = await request(app)
    .post('/api/v1/diary')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(201);
  return res.body.data;
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
    DiaryEntry,
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /diary — one-liner create (plan step 50)', () => {
  test('requires auth → 401', async () => {
    const res = await request(app).post('/api/v1/diary').send({ content: 'hi' });
    expect(res.status).toBe(401);
  });

  test('valid line → 201 with trimmed content and public defaults', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, {
      content: '   today the rain stopped   ',
    });
    expect(entry.id).toMatch(/^[0-9a-f]{24}$/);
    expect(entry.content).toBe('today the rain stopped');
    expect(entry.visibility).toBe('public');
    expect(entry.anonymous).toBe(false);
    expect(entry.stats).toEqual({ reactionCount: 0, commentCount: 0 });
    expect(entry.authorId).toBe(author.user.id);

    const stored = await DiaryEntry.findById(entry.id).lean();
    expect(String(stored.authorId)).toBe(author.user.id);
    expect(stored.content).toBe('today the rain stopped');
  });

  test('anonymous: true accepted; response carries the flag', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, {
      content: 'a quiet thought',
      anonymous: true,
    });
    expect(entry.anonymous).toBe(true);
  });

  test('visibility followers accepted; private/unlisted rejected → 400', async () => {
    const author = await register();
    const okRes = await postDiary(author.accessToken, {
      content: 'for the circle',
      visibility: 'followers',
    });
    expect(okRes.visibility).toBe('followers');

    for (const visibility of ['private', 'unlisted', 'friends']) {
      const res = await request(app)
        .post('/api/v1/diary')
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ content: 'x', visibility });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('empty / whitespace-only content → 400', async () => {
    const author = await register();
    for (const content of ['', '   ', '\n\t']) {
      const res = await request(app)
        .post('/api/v1/diary')
        .set('Authorization', `Bearer ${author.accessToken}`)
        .send({ content });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  test('content boundary: 280 chars → 201, 281 chars → 400', async () => {
    const author = await register();
    const at280 = await postDiary(author.accessToken, { content: 'a'.repeat(280) });
    expect(at280.content).toHaveLength(280);

    const res = await request(app)
      .post('/api/v1/diary')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ content: 'a'.repeat(281) });
    expect(res.status).toBe(400);
  });
});

describe('GET /diary/:id — read with visibility matrix (plan step 50)', () => {
  test('public entry → 200 unauthenticated, author included', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, { content: 'open sky today' });

    const res = await request(app).get(`/api/v1/diary/${entry.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('open sky today');
    expect(res.body.data.author.username).toBe(author.user.username);
    expect(res.body.data.authorId).toBe(author.user.id);
  });

  test('followers entry → owner 200 / follower 200 / stranger 404 / anon 404', async () => {
    const owner = await register();
    const follower = await register();
    const stranger = await register();

    const follow = await request(app)
      .post(`/api/v1/users/${owner.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.accessToken}`);
    expect(follow.status).toBe(201);

    const entry = await postDiary(owner.accessToken, {
      content: 'circle only',
      visibility: 'followers',
    });

    const asOwner = await request(app)
      .get(`/api/v1/diary/${entry.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asOwner.status).toBe(200);

    const asFollower = await request(app)
      .get(`/api/v1/diary/${entry.id}`)
      .set('Authorization', `Bearer ${follower.accessToken}`);
    expect(asFollower.status).toBe(200);

    const asStranger = await request(app)
      .get(`/api/v1/diary/${entry.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asStranger.status).toBe(404);
    expect(asStranger.body.error.code).toBe('TARGET_NOT_FOUND');

    const anon = await request(app).get(`/api/v1/diary/${entry.id}`);
    expect(anon.status).toBe(404);
  });

  test('anonymous entry → identity hidden from stranger, visible to owner', async () => {
    const owner = await register();
    const stranger = await register();
    const entry = await postDiary(owner.accessToken, {
      content: 'anon line',
      anonymous: true,
    });

    const asStranger = await request(app)
      .get(`/api/v1/diary/${entry.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(asStranger.status).toBe(200);
    expect(asStranger.body.data.authorId).toBeUndefined();
    expect(asStranger.body.data.author).toBeUndefined();
    // hidden in the response only — authorship must remain for moderation
    const stored = await DiaryEntry.findById(entry.id).lean();
    expect(String(stored.authorId)).toBe(owner.user.id);

    const asOwner = await request(app)
      .get(`/api/v1/diary/${entry.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(asOwner.body.data.authorId).toBe(owner.user.id);
  });

  test('unknown diary id → 404 TARGET_NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/diary/507f1f77bcf86cd799439011');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND');
  });

  test('cross-collection ids fail both ways (discovery isolation)', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, { content: 'not a poem' });

    const poemRes = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ title: 'x', content: 'y\nz' });
    expect(poemRes.status).toBe(201);
    const poemId = poemRes.body.data.id;

    const poemReadsDiary = await request(app).get(`/api/v1/poems/${entry.id}`);
    expect(poemReadsDiary.status).toBe(404);

    const diaryReadsPoem = await request(app).get(`/api/v1/diary/${poemId}`);
    expect(diaryReadsPoem.status).toBe(404);
    expect(diaryReadsPoem.body.error.code).toBe('TARGET_NOT_FOUND');
  });
});

describe('diary has no felt-good / save / lifecycle routes (plan step 50)', () => {
  test('felt-good, save, patch, delete routes do not exist → 404', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, { content: 'route probe' });
    const tok = { Authorization: `Bearer ${author.accessToken}` };

    const probes = [
      request(app).post(`/api/v1/diary/${entry.id}/felt-good`).set(tok).send({ score: 80 }),
      request(app).post(`/api/v1/diary/${entry.id}/save`).set(tok),
      request(app).patch(`/api/v1/diary/${entry.id}`).set(tok).send({ content: 'edited' }),
      request(app).delete(`/api/v1/diary/${entry.id}`).set(tok),
    ];
    for (const probe of probes) {
      const res = await probe;
      expect(res.status).toBe(404);
    }

    expect(await FeltGoodRating.countDocuments({ targetId: entry.id })).toBe(0);
    expect(await Save.countDocuments({ targetId: entry.id })).toBe(0);
    const stored = await DiaryEntry.findById(entry.id).lean();
    expect(stored.content).toBe('route probe');
  });

  test('diary reactions route exists (contrast) → 201', async () => {
    const author = await register();
    const reader = await register();
    const entry = await postDiary(author.accessToken, { content: 'react to me' });
    const res = await request(app)
      .post(`/api/v1/diary/${entry.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'felt_this' });
    expect(res.status).toBe(201);
    expect(res.body.data.stats.reactionCount).toBe(1);
  });
});
