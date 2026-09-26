'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Story } = require('../../src/modules/stories/story.model');
const { StoryChapter } = require('../../src/modules/stories/story-chapter.model');
const { StoryVersion } = require('../../src/modules/stories/story-version.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Writer',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function createStory(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/stories')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'The Lighthouse', ...overrides });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function addChapter(token, storyId, body = {}) {
  const res = await request(app)
    .post(`/api/v1/stories/${storyId}/chapters`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Chapter One', ...body });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function patchChapter(token, storyId, chapterId, body) {
  const res = await request(app)
    .patch(`/api/v1/stories/${storyId}/chapters/${chapterId}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
  expect(res.status).toBe(200);
  return res.body.data;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Story, StoryChapter, StoryVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('GET /stories/:id/versions — metadata history (plan 37B)', () => {
  test('newest first with pagination cursor', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'Second title' });
    await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'Third title' });

    const page1 = await request(app)
      .get(`/api/v1/stories/${story.id}/versions?limit=2`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page1.status).toBe(200);
    expect(page1.body.data.items.map((v) => v.title)).toEqual(['Third title', 'Second title']);
    expect(page1.body.data.items[0].chapterId).toBeNull();
    expect(page1.body.data.nextCursor).toBe('2');

    const page2 = await request(app)
      .get(`/api/v1/stories/${story.id}/versions?limit=2&cursor=${page1.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page2.body.data.items.map((v) => v.title)).toEqual(['The Lighthouse']);
    expect(page2.body.data.nextCursor).toBeNull();
  });

  test('metadata list excludes chapter versions', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await patchChapter(me.accessToken, story.id, ch.id, { content: 'body v2' });

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/versions`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1); // only story v1
    expect(res.body.data.items.every((v) => v.chapterId === null)).toBe(true);
  });

  test('non-owner → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/versions`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);
    expect(res.status).toBe(403);
  });

  test('versions of removed story → 404', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/versions`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(404);
  });

  test('invalid chapterId query → 400', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/versions?chapterId=nope`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('query.chapterId');
  });
});

describe('GET /stories/:id/versions?chapterId= — per-chapter history (plan 35B)', () => {
  test('each chapter has its own independent sequence', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const chA = await addChapter(me.accessToken, story.id, { title: 'A', content: 'a1' });
    const chB = await addChapter(me.accessToken, story.id, { title: 'B', content: 'b1' });
    await patchChapter(me.accessToken, story.id, chA.id, { content: 'a2' });
    await patchChapter(me.accessToken, story.id, chA.id, { content: 'a3' });

    const resA = await request(app)
      .get(`/api/v1/stories/${story.id}/versions?chapterId=${chA.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(resA.status).toBe(200);
    expect(resA.body.data.items.map((v) => v.versionNumber)).toEqual([3, 2, 1]);
    expect(resA.body.data.items[0].content).toBe('a3');
    expect(resA.body.data.items.every((v) => v.chapterId === chA.id)).toBe(true);

    const resB = await request(app)
      .get(`/api/v1/stories/${story.id}/versions?chapterId=${chB.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(resB.status).toBe(200);
    expect(resB.body.data.items.map((v) => v.versionNumber)).toEqual([1]);
    expect(resB.body.data.items[0].content).toBe('b1');
  });

  test('chapter autosaves never appear in chapter history', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'v1 body' });

    for (const content of ['wip 1', 'wip 2', 'wip 3']) {
      await request(app)
        .put(`/api/v1/stories/${story.id}/chapters/${ch.id}/draft`)
        .set('Authorization', `Bearer ${me.accessToken}`)
        .send({ content });
    }

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/versions?chapterId=${ch.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].content).toBe('v1 body');
  });
});
