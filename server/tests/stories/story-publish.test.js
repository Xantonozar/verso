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

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Story, StoryChapter, StoryVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /stories/:id/publish — validation + transition (plan 42B)', () => {
  test('no chapters → 400 with chapters detail', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d) => d.field === 'chapters')).toBe(true);
    expect((await Story.findById(story.id)).status).toBe('draft');
  });

  test('chapter with empty content → 400 naming the chapter', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'full body' });
    await addChapter(me.accessToken, story.id, { title: 'Two', content: '   ' });

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    expect(res.status).toBe(400);
    const detail = res.body.error.details.find((d) => d.field === 'chapters.1');
    expect(detail).toBeTruthy();
    expect(detail.message).toContain('chapter 2');
    expect((await Story.findById(story.id)).status).toBe('draft');
  });

  test('valid story → 200 published, publishedAt set, metadata version snapshotted', async () => {
    const me = await register();
    const stranger = await register();
    const story = await createStory(me.accessToken, { synopsis: 'Public now.' });
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'The story begins.' });
    const versionsBefore = await StoryVersion.countDocuments({ storyId: story.id });

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.publishedAt).toBeTruthy();
    expect(await StoryVersion.countDocuments({ storyId: story.id })).toBe(versionsBefore + 1);

    const read = await request(app)
      .get(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(read.status).toBe(200);
    expect(read.body.data.status).toBe('published');
  });

  test('publish twice → 409 ALREADY_PUBLISHED', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });

    const first = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(first.status).toBe(200);

    const second = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('ALREADY_PUBLISHED');
  });

  test('non-owner publish → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);
    await addChapter(owner.accessToken, story.id, { title: 'One', content: 'body' });

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({});
    expect(res.status).toBe(403);
    expect((await Story.findById(story.id)).status).toBe('draft');
  });

  test('publish removed story → 404', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(404);
  });

  test('editing metadata while published keeps status (explicit save allowed)', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'Edited after publish.' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.synopsis).toBe('Edited after publish.');
  });
});

describe('POST /stories/:id/unpublish — revert transition (plan 37B)', () => {
  test('published → draft; stranger loses access', async () => {
    const me = await register();
    const stranger = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/unpublish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');

    const read = await request(app)
      .get(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(read.status).toBe(404);
  });

  test("unpublish to: 'private_draft' → private_draft status", async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/unpublish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ to: 'private_draft' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('private_draft');
  });

  test('unpublish a draft → 409 NOT_PUBLISHED', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/unpublish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_PUBLISHED');
  });

  test('unpublish invalid target → 400 field to', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/unpublish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ to: 'published' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'to')).toBe(true);
  });

  test('non-owner unpublish → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);
    await addChapter(owner.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({});

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/unpublish`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({});
    expect(res.status).toBe(403);
    expect((await Story.findById(story.id)).status).toBe('published');
  });
});
