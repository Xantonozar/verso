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

const uniq = () => `e${Date.now().toString(36)}${(seq++).toString(36)}`;

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

async function react(token, diaryId, body) {
  return request(app)
    .post(`/api/v1/diary/${diaryId}/reactions`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function comment(token, body) {
  return request(app)
    .post('/api/v1/comments')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function diaryStats(diaryId) {
  const doc = await DiaryEntry.findById(diaryId).select('stats').lean();
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
    DiaryEntry,
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('diary reactions — same contract as poems (plan step 50)', () => {
  test('POST → 201 and $inc reactionCount; duplicate → 409 ALREADY_REACTED', async () => {
    const author = await register();
    const reader = await register();
    const entry = await postDiary(author.accessToken, { content: 'react me' });

    const first = await react(reader.accessToken, entry.id, { type: 'beautiful' });
    expect(first.status).toBe(201);
    expect(first.body.data.reaction.type).toBe('beautiful');
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 1, commentCount: 0 });

    const dup = await react(reader.accessToken, entry.id, { type: 'beautiful' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_REACTED');
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 1, commentCount: 0 });

    const otherType = await react(reader.accessToken, entry.id, { type: 'loved' });
    expect(otherType.status).toBe(201);
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 2, commentCount: 0 });
  });

  test('DELETE is idempotent and never double-decrements', async () => {
    const author = await register();
    const reader = await register();
    const entry = await postDiary(author.accessToken, { content: 'toggle me' });
    await react(reader.accessToken, entry.id, { type: 'hurt' });

    const removed = await request(app)
      .delete(`/api/v1/diary/${entry.id}/reactions/hurt`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.removed).toBe(true);
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 0, commentCount: 0 });

    const again = await request(app)
      .delete(`/api/v1/diary/${entry.id}/reactions/hurt`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(again.status).toBe(200);
    expect(again.body.data.removed).toBe(false);
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 0, commentCount: 0 });
  });

  test('unknown diary id → 404 TARGET_NOT_FOUND, no reaction row', async () => {
    const reader = await register();
    const res = await react(reader.accessToken, '507f1f77bcf86cd799439011', { type: 'loved' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND');
    expect(
      await Reaction.countDocuments({
        targetType: 'diary',
        targetId: '507f1f77bcf86cd799439011',
      }),
    ).toBe(0);
  });

  test('followers-only entry, non-follower → 404 (fail closed, not 403)', async () => {
    const owner = await register();
    const stranger = await register();
    const entry = await postDiary(owner.accessToken, {
      content: 'locked line',
      visibility: 'followers',
    });

    const res = await react(stranger.accessToken, entry.id, { type: 'felt_this' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND');
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 0, commentCount: 0 });
  });

  test('unauthenticated reaction → 401', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, { content: 'auth gate' });
    const res = await request(app)
      .post(`/api/v1/diary/${entry.id}/reactions`)
      .send({ type: 'loved' });
    expect(res.status).toBe(401);
  });
});

describe('diary comments — generic /comments with diary targets (plan step 50)', () => {
  test('create → 201, commentCount on the diary doc, list shows it, delete decrements', async () => {
    const author = await register();
    const reader = await register();
    const entry = await postDiary(author.accessToken, { content: 'discuss me' });

    const created = await comment(reader.accessToken, {
      targetType: 'diary',
      targetId: entry.id,
      content: 'a quiet resonance',
    });
    expect(created.status).toBe(201);
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 0, commentCount: 1 });

    const list = await request(app)
      .get('/api/v1/comments')
      .query({ targetType: 'diary', targetId: entry.id });
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].content).toBe('a quiet resonance');

    const del = await request(app)
      .delete(`/api/v1/comments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(del.status).toBe(200);
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 0, commentCount: 0 });
  });

  test('comment on unknown diary id → 404 TARGET_NOT_FOUND', async () => {
    const reader = await register();
    const res = await comment(reader.accessToken, {
      targetType: 'diary',
      targetId: '507f1f77bcf86cd799439011',
      content: 'ghost',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND');
  });

  test('comment on followers-only diary from stranger → 404 TARGET_NOT_FOUND', async () => {
    const owner = await register();
    const stranger = await register();
    const entry = await postDiary(owner.accessToken, {
      content: 'closed circle',
      visibility: 'followers',
    });
    const res = await comment(stranger.accessToken, {
      targetType: 'diary',
      targetId: entry.id,
      content: 'let me in',
    });
    expect(res.status).toBe(404);
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 0, commentCount: 0 });
  });
});

describe('engagement counters stay poem-only where they must (plan step 50)', () => {
  test('diary reaction does NOT touch any poem stats', async () => {
    const author = await register();
    const reader = await register();

    const poemRes = await request(app)
      .post('/api/v1/poems')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ title: 'untouched', content: 'still\nwater' });
    expect(poemRes.status).toBe(201);
    const poemId = poemRes.body.data.id;

    const entry = await postDiary(author.accessToken, { content: 'separate counters' });
    await react(reader.accessToken, entry.id, { type: 'powerful' });
    await comment(reader.accessToken, {
      targetType: 'diary',
      targetId: entry.id,
      content: 'note',
    });

    const poem = await Poem.findById(poemId).select('stats').lean();
    expect(poem.stats).toMatchObject({ reactionCount: 0, commentCount: 0 });
    expect(await diaryStats(entry.id)).toEqual({ reactionCount: 1, commentCount: 1 });
    expect(await Reaction.countDocuments({ targetType: 'poem' })).toBe(0);
  });
});
