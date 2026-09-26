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

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Story, StoryChapter, StoryVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /stories — create in draft status (plan 35B)', () => {
  test('valid body → 201, draft status, version 1 metadata snapshot', async () => {
    const me = await register();
    const data = await createStory(me.accessToken, { synopsis: 'A keeper and a storm.' });

    expect(data.status).toBe('draft');
    expect(data.title).toBe('The Lighthouse');
    expect(data.synopsis).toBe('A keeper and a storm.');
    expect(data.chapterCount).toBe(0);
    expect(data.coverUrl).toBe('');
    expect(data.tags).toEqual([]);
    expect(data.currentVersionId).toBeTruthy();
    expect(data.authorId).toBe(me.user.id);
    expect(data.stats).toEqual({
      reads: 0,
      reactionCount: 0,
      commentCount: 0,
      saveCount: 0,
      shareCount: 0,
    });

    const versions = await StoryVersion.find({ storyId: data.id }).lean();
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].chapterId).toBeUndefined();
    expect(versions[0].synopsis).toBe('A keeper and a storm.');
  });

  test('missing title → 400 field-level VALIDATION_ERROR', async () => {
    const me = await register();
    const res = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ synopsis: 'no title' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d) => d.field === 'title')).toBe(true);
  });

  test('unauthenticated → 401', async () => {
    const res = await request(app).post('/api/v1/stories').send({ title: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('privileged fields in body are stripped (no mass-assign)', async () => {
    const other = await register();
    const me = await register();
    const data = await createStory(me.accessToken, {
      status: 'published',
      chapterCount: 99,
      authorId: other.user.id,
      stats: { reads: 5000 },
      currentVersionId: '64b0000000000000000000ff',
    });

    expect(data.status).toBe('draft');
    expect(data.chapterCount).toBe(0);
    expect(data.authorId).toBe(me.user.id);
    expect(data.stats.reads).toBe(0);

    const persisted = await Story.findById(data.id).lean();
    expect(persisted.status).toBe('draft');
    expect(persisted.authorId.toString()).toBe(me.user.id);
  });
});

describe('GET /stories/:id — visibility matrix (plan 36B)', () => {
  async function seedWithStatus(status, owner) {
    const story = await createStory(owner.accessToken);
    await Story.updateOne({ _id: story.id }, { $set: { status } });
    return story;
  }

  test('draft → owner 200, stranger 404 STORY_NOT_FOUND (fail-closed)', async () => {
    const owner = await register();
    const stranger = await register();
    const story = await createStory(owner.accessToken);

    const mine = await request(app)
      .get(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.author.username).toBe(owner.user.username);

    const theirs = await request(app)
      .get(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error.code).toBe('STORY_NOT_FOUND');

    const anon = await request(app).get(`/api/v1/stories/${story.id}`);
    expect(anon.status).toBe(404);
  });

  test('published → stranger 200 with author', async () => {
    const owner = await register();
    const stranger = await register();
    const story = await seedWithStatus('published', owner);

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
    expect(res.body.data.author.id).toBe(owner.user.id);
  });

  test('unlisted → direct link readable by stranger', async () => {
    const owner = await register();
    const story = await seedWithStatus('unlisted', owner);

    const res = await request(app).get(`/api/v1/stories/${story.id}`);
    expect(res.status).toBe(200);
  });

  test('private_draft and under_review → stranger 404', async () => {
    const owner = await register();
    for (const status of ['private_draft', 'under_review']) {
      const story = await seedWithStatus(status, owner);
      const res = await request(app).get(`/api/v1/stories/${story.id}`);
      expect(res.status).toBe(404);
    }
  });

  test('removed → stranger 404, owner still 200 (recovery)', async () => {
    const owner = await register();
    const story = await createStory(owner.accessToken);

    const del = await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe('removed');

    const stranger = await request(app).get(`/api/v1/stories/${story.id}`);
    expect(stranger.status).toBe(404);

    const mine = await request(app)
      .get(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.status).toBe('removed');
  });

  test('invalid id → 400 params.id', async () => {
    const me = await register();
    const res = await request(app)
      .get('/api/v1/stories/not-an-id')
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('params.id');
  });
});

describe('PATCH /stories/:id — metadata edit with version history (plan 37B)', () => {
  test('owner edit → 200, new metadata version, currentVersionId rotated', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'The Lighthouse, Revised', synopsis: 'Revised synopsis.' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('The Lighthouse, Revised');
    expect(res.body.data.currentVersionId).not.toBe(story.currentVersionId);

    const versions = await StoryVersion.find({ storyId: story.id })
      .sort({ versionNumber: 1 })
      .lean();
    expect(versions).toHaveLength(2);
    expect(versions[1].versionNumber).toBe(2);
    expect(versions[1].title).toBe('The Lighthouse, Revised');
    expect(versions[1].synopsis).toBe('Revised synopsis.');
    // history is never destructively mutated
    expect(versions[0].title).toBe('The Lighthouse');
  });

  test('non-owner edit → 403 FORBIDDEN', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ title: 'Hijacked' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await Story.findById(story.id)).title).toBe('The Lighthouse');
  });

  test('moderator edit → 200', async () => {
    const owner = await register();
    const mod = await register();
    await User.updateOne({ _id: mod.user.id }, { $set: { 'roles.security': 'moderator' } });
    const story = await createStory(owner.accessToken);

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`)
      .send({ synopsis: 'Moderator edit.' });

    expect(res.status).toBe(200);
    expect(res.body.data.synopsis).toBe('Moderator edit.');
  });

  test('language-only edit → no redundant version; tags edit → version', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ language: 'bn' });
    expect(await StoryVersion.countDocuments({ storyId: story.id })).toBe(1);

    await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ tags: ['storm', 'sea'] });
    expect(await StoryVersion.countDocuments({ storyId: story.id })).toBe(2);
  });

  test('privileged fields in patch are ignored (status/authorId/chapterCount/stats)', async () => {
    const other = await register();
    const me = await register();
    const story = await createStory(me.accessToken);

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({
        title: 'Kept',
        status: 'published',
        authorId: other.user.id,
        chapterCount: 42,
        stats: { reads: 9 },
      });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('draft');
    expect(res.body.data.chapterCount).toBe(0);
    expect(res.body.data.authorId).toBe(me.user.id);

    const persisted = await Story.findById(story.id).lean();
    expect(persisted.status).toBe('draft');
    expect(persisted.stats.reads).toBe(0);
  });

  test('empty body → 400 with (root) detail', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === '(root)')).toBe(true);
  });

  test('edit removed story → 404 even for owner', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'Zombie edit' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STORY_NOT_FOUND');
  });
});

describe('DELETE /stories/:id — soft delete (plan 37B)', () => {
  test('owner delete → removed; second delete → 404', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    const res = await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: story.id, deleted: true, status: 'removed' });

    const persisted = await Story.findById(story.id).lean();
    expect(persisted.status).toBe('removed');

    const again = await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(again.status).toBe(404);
  });

  test('non-owner delete → 403 and story survives', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);

    const res = await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);
    expect(res.status).toBe(403);

    expect((await Story.findById(story.id)).status).toBe('draft');
  });
});
