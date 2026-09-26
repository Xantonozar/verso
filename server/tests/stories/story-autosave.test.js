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

describe('PUT /stories/:id/draft — metadata autosave (plan 38B)', () => {
  test('changed payload → changed: true + draftSavedAt set, no new version', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const versionsBefore = await StoryVersion.countDocuments({ storyId: story.id });

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'Half-written idea', tags: ['wip'] });

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(res.body.data.synopsis).toBe('Half-written idea');
    expect(res.body.data.savedAt).toBeTruthy();
    expect(await StoryVersion.countDocuments({ storyId: story.id })).toBe(versionsBefore);
    expect((await Story.findById(story.id)).draftSavedAt).toBeTruthy();
  });

  test('identical payload again → changed: false, stable savedAt (idempotent)', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    const first = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'Half-written idea' });
    const savedAt = first.body.data.savedAt;

    const second = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'Half-written idea' });

    expect(second.status).toBe(200);
    expect(second.body.data.changed).toBe(false);
    expect(second.body.data.savedAt).toEqual(savedAt);
  });

  test('many autosaves → still only version 1 in history', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    for (const synopsis of ['a', 'ab', 'abc', 'abcd']) {
      await request(app)
        .put(`/api/v1/stories/${story.id}/draft`)
        .set('Authorization', `Bearer ${me.accessToken}`)
        .send({ synopsis });
    }

    expect(await StoryVersion.countDocuments({ storyId: story.id })).toBe(1);
    expect((await Story.findById(story.id)).synopsis).toBe('abcd');
  });

  test('empty body → 400', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === '(root)')).toBe(true);
  });

  test('published story → 409 NOT_A_DRAFT (explicit save is the published path)', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'nope' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_A_DRAFT');
  });

  test('non-owner autosave → 403 (owner-only, moderators do not ghost-edit)', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ synopsis: 'hijack' });
    expect(res.status).toBe(403);
    expect((await Story.findById(story.id)).synopsis).toBe('');
  });

  test('autosave removed story → 404', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'ghost' });
    expect(res.status).toBe(404);
  });
});

describe('PUT /stories/:id/chapters/:chapterId/draft — chapter autosave (plan 38B)', () => {
  test('changed → changed: true, wordCount + draftSavedAt updated, no new version', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'start' });
    const versionsBefore = await StoryVersion.countDocuments({ chapterId: ch.id });

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/chapters/${ch.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'The lighthouse keeper counted\nthe waves' });

    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(res.body.data.savedAt).toBeTruthy();

    const persisted = await StoryChapter.findById(ch.id).lean();
    expect(persisted.wordCount).toBe(6);
    expect(persisted.draftSavedAt).toBeTruthy();
    expect(await StoryVersion.countDocuments({ chapterId: ch.id })).toBe(versionsBefore);
  });

  test('identical payload → changed: false (idempotent)', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'same' });

    const first = await request(app)
      .put(`/api/v1/stories/${story.id}/chapters/${ch.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'same' });
    const second = await request(app)
      .put(`/api/v1/stories/${story.id}/chapters/${ch.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'same' });

    expect(first.body.data.changed).toBe(false);
    expect(second.body.data.changed).toBe(false);
    expect(second.body.data.savedAt).toEqual(first.body.data.savedAt);
    expect(await StoryVersion.countDocuments({ chapterId: ch.id })).toBe(1);
  });

  test('published story → 409 NOT_A_DRAFT', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'body' });
    await request(app)
      .post(`/api/v1/stories/${story.id}/publish`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/chapters/${ch.id}/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'nope' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_A_DRAFT');
  });

  test('non-owner chapter autosave → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);
    const ch = await addChapter(owner.accessToken, story.id, { title: 'One', content: 'safe' });

    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/chapters/${ch.id}/draft`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ content: 'hijacked' });
    expect(res.status).toBe(403);
    expect((await StoryChapter.findById(ch.id)).content).toBe('safe');
  });

  test('unknown chapter → 404 STORY_CHAPTER_NOT_FOUND', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const res = await request(app)
      .put(`/api/v1/stories/${story.id}/chapters/64b0000000000000000000ff/draft`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ content: 'x' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STORY_CHAPTER_NOT_FOUND');
  });
});
