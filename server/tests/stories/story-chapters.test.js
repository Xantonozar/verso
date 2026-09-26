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

async function publishableStory(token) {
  const story = await createStory(token);
  await addChapter(token, story.id, {
    title: 'One',
    content: 'The beam swept the black water all night.',
  });
  await Story.updateOne({ _id: story.id }, { $set: { status: 'published' } });
  return story;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Story, StoryChapter, StoryVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /stories/:id/chapters — ordered chapter creation (plan 37B)', () => {
  test('sequential creates get numbers 1,2,3 and bump story.chapterCount', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);

    const c1 = await addChapter(me.accessToken, story.id, { title: 'One' });
    const c2 = await addChapter(me.accessToken, story.id, { title: 'Two' });
    const c3 = await addChapter(me.accessToken, story.id, { title: 'Three' });

    expect([c1.chapterNumber, c2.chapterNumber, c3.chapterNumber]).toEqual([1, 2, 3]);
    expect(c1.wordCount).toBe(0);

    const persisted = await Story.findById(story.id).lean();
    expect(persisted.chapterCount).toBe(3);
  });

  test('chapter create with content → wordCount + version 1 snapshotted', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, {
      title: 'Storm',
      content: 'Wind howled\nthrough the glass.',
    });

    expect(ch.wordCount).toBe(5);

    const versions = await StoryVersion.find({ chapterId: ch.id }).lean();
    expect(versions).toHaveLength(1);
    expect(versions[0].versionNumber).toBe(1);
    expect(versions[0].content).toBe('Wind howled\nthrough the glass.');
    expect(String(ch.currentVersionId)).toBe(String(versions[0]._id));
  });

  test('non-owner chapter create → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ title: 'Intruder' });
    expect(res.status).toBe(403);
    expect(await StoryChapter.countDocuments({ storyId: story.id })).toBe(0);
  });

  test('chapter create on removed story → 404', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    await request(app)
      .delete(`/api/v1/stories/${story.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'Ghost' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STORY_NOT_FOUND');
  });
});

describe('GET /stories/:id/chapters — paginated list, no content (plan 37B)', () => {
  test('published story → stranger gets ordered summaries without content', async () => {
    const owner = await register();
    const stranger = await register();
    const story = await createStory(owner.accessToken);
    await addChapter(owner.accessToken, story.id, { title: 'One', content: 'Secret body one.' });
    await addChapter(owner.accessToken, story.id, { title: 'Two', content: 'Secret body two.' });
    await Story.updateOne({ _id: story.id }, { $set: { status: 'published' } });

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(res.body.data.items[0].chapterNumber).toBe(1);
    expect(res.body.data.items[0].wordCount).toBe(3);
    expect(res.body.data.items[0]).not.toHaveProperty('content');
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('draft story → stranger 404 (visibility follows the story)', async () => {
    const owner = await register();
    const stranger = await register();
    const story = await createStory(owner.accessToken);
    await addChapter(owner.accessToken, story.id, { title: 'One', content: 'x' });

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(404);
  });

  test('cursor pagination: limit 2 → nextCursor → remaining page', async () => {
    const owner = await register();
    const story = await createStory(owner.accessToken);
    for (let i = 1; i <= 3; i++) {
      await addChapter(owner.accessToken, story.id, { title: `Ch ${i}`, content: `body ${i}` });
    }

    const page1 = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters?limit=2`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(page1.body.data.items.map((c) => c.chapterNumber)).toEqual([1, 2]);
    expect(page1.body.data.nextCursor).toBe('2');

    const page2 = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters?limit=2&cursor=${page1.body.data.nextCursor}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(page2.body.data.items.map((c) => c.chapterNumber)).toEqual([3]);
    expect(page2.body.data.nextCursor).toBeNull();
  });
});

describe('GET /stories/:id/chapters/:chapterId — full chapter read', () => {
  test('published → stranger 200 with content', async () => {
    const owner = await register();
    const stranger = await register();
    const story = await publishableStory(owner.accessToken);
    const [list] = (
      await request(app)
        .get(`/api/v1/stories/${story.id}/chapters`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
    ).body.data.items;

    const res = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters/${list.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.content).toBe('The beam swept the black water all night.');
    expect(res.body.data.chapterNumber).toBe(1);
  });

  test('draft → stranger 404, owner 200', async () => {
    const owner = await register();
    const stranger = await register();
    const story = await createStory(owner.accessToken);
    const ch = await addChapter(owner.accessToken, story.id, { title: 'One', content: 'draft body' });

    const theirs = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters/${ch.id}`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);
    expect(theirs.status).toBe(404);

    const mine = await request(app)
      .get(`/api/v1/stories/${story.id}/chapters/${ch.id}`)
      .set('Authorization', `Bearer ${owner.accessToken}`);
    expect(mine.status).toBe(200);
  });

  test("chapter from another story → 404 STORY_CHAPTER_NOT_FOUND", async () => {
    const me = await register();
    const storyA = await createStory(me.accessToken);
    const storyB = await createStory(me.accessToken);
    const chA = await addChapter(me.accessToken, storyA.id, { title: 'A', content: 'x' });

    const res = await request(app)
      .get(`/api/v1/stories/${storyB.id}/chapters/${chA.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('STORY_CHAPTER_NOT_FOUND');
  });
});

describe('PATCH /stories/:id/chapters/:chapterId — explicit save versions (plan 38B)', () => {
  test('edit → version 2, wordCount recomputed, history intact', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, {
      title: 'One',
      content: 'old words here',
    });

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}/chapters/${ch.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'First Light', content: 'rewritten\nwith more words' });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('First Light');
    expect(res.body.data.wordCount).toBe(4);

    const versions = await StoryVersion.find({ chapterId: ch.id })
      .sort({ versionNumber: 1 })
      .lean();
    expect(versions).toHaveLength(2);
    expect(versions[0].content).toBe('old words here');
    expect(versions[1].content).toBe('rewritten\nwith more words');
  });

  test('no-change edit → no new version', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'same body' });

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}/chapters/${ch.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ title: 'One', content: 'same body' });

    expect(res.status).toBe(200);
    expect(await StoryVersion.countDocuments({ chapterId: ch.id })).toBe(1);
  });

  test('non-owner edit → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const story = await createStory(owner.accessToken);
    const ch = await addChapter(owner.accessToken, story.id, { title: 'One', content: 'x' });

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}/chapters/${ch.id}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ content: 'hijacked' });
    expect(res.status).toBe(403);
    expect((await StoryChapter.findById(ch.id)).content).toBe('x');
  });

  test('empty body → 400 (root)', async () => {
    const me = await register();
    const story = await createStory(me.accessToken);
    const ch = await addChapter(me.accessToken, story.id, { title: 'One', content: 'x' });

    const res = await request(app)
      .patch(`/api/v1/stories/${story.id}/chapters/${ch.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === '(root)')).toBe(true);
  });
});

describe('POST /stories/:id/chapters/reorder — exact-set reorder (plan 37B)', () => {
  async function seedThree(token) {
    const story = await createStory(token);
    const a = await addChapter(token, story.id, { title: 'A', content: 'a' });
    const b = await addChapter(token, story.id, { title: 'B', content: 'b' });
    const c = await addChapter(token, story.id, { title: 'C', content: 'c' });
    return { story, a, b, c };
  }

  test('valid payload renumbers to match the given order', async () => {
    const me = await register();
    const { story, a, b, c } = await seedThree(me.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters/reorder`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ chapterIds: [c.id, a.id, b.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((ch) => [ch.chapterNumber, ch.title])).toEqual([
      [1, 'C'],
      [2, 'A'],
      [3, 'B'],
    ]);

    const persisted = await StoryChapter.findById(c.id).lean();
    expect(persisted.chapterNumber).toBe(1);
  });

  test('payload missing a chapter → 400 with chapterIds detail', async () => {
    const me = await register();
    const { story, a, b, c } = await seedThree(me.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters/reorder`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ chapterIds: [a.id, b.id] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d) => d.field === 'chapterIds')).toBe(true);
    expect(c).toBeTruthy();
  });

  test('payload with a foreign chapter id → 400 and numbers unchanged', async () => {
    const me = await register();
    const { story, a, b, c } = await seedThree(me.accessToken);
    const other = await seedThree(me.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters/reorder`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ chapterIds: [a.id, other.a.id, b.id, c.id] });

    expect(res.status).toBe(400);
    expect((await StoryChapter.findById(a.id)).chapterNumber).toBe(1);
    expect((await StoryChapter.findById(b.id)).chapterNumber).toBe(2);
  });

  test('duplicate ids → 400 (schema distinct)', async () => {
    const me = await register();
    const { story, a, b, c } = await seedThree(me.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters/reorder`)
      .set('Authorization', `Bearer ${me.accessToken}`)
      .send({ chapterIds: [a.id, a.id, b.id, c.id] });

    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'chapterIds')).toBe(true);
  });

  test('non-owner reorder → 403', async () => {
    const owner = await register();
    const attacker = await register();
    const { story, a, b, c } = await seedThree(owner.accessToken);

    const res = await request(app)
      .post(`/api/v1/stories/${story.id}/chapters/reorder`)
      .set('Authorization', `Bearer ${attacker.accessToken}`)
      .send({ chapterIds: [c.id, b.id, a.id] });
    expect(res.status).toBe(403);
    expect((await StoryChapter.findById(c.id)).chapterNumber).toBe(3);
  });
});
