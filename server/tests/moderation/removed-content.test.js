'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Story } = require('../../src/modules/stories/story.model');
const { StoryChapter } = require('../../src/modules/stories/story-chapter.model');
const { StoryVersion } = require('../../src/modules/stories/story-version.model');
const { Collection } = require('../../src/modules/collections/collection.model');
const { Comment } = require('../../src/modules/engagement/comment.model');
const { countPublicPublished } = require('../../src/modules/discover/discover.repository');
const { runTrendingRefresh } = require('../../src/modules/discover/discover.service');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 14 gate (plan step 91 split: excluded reads ship NOW, §6 search ships
 * with Phase 10's search work - "search leg deferred", same stance as the
 * anonymity suite): a soft-removed (deleted) poem/story must vanish from EVERY
 * public read surface while the author keeps recovery access.
 *
 * Positive controls prove each surface actually serves the item before the
 * delete, so "absent after" can never be a false pass from a broken surface.
 *
 * Surfaces: following feed, mood, tag, trending, random, collection hydrate,
 * mobile BFF, comments, author story list, direct get.
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

let author;
let follower;
let stranger;
let poemId;
let controlPoemId;
let storyId;
let collectionId;

async function register(displayName) {
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

function get(path, token) {
  const req = request(app).get(path);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

async function createPublishedPoem(token, { title, tags = [], moods = [] }) {
  const create = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, content: 'line one\nline two', visibility: 'public', tags, moods });
  expect(create.status).toBe(201);
  const pub = await request(app)
    .post(`/api/v1/poems/${create.body.data.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(pub.status).toBe(200);
  return pub.body.data.id;
}

const ids = (res) => {
  const data = (res.body ?? res).data ?? {};
  return (data.items || data.poems || []).map((it) => it.id);
};

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Follow,
    Poem,
    PoemVersion,
    Story,
    StoryChapter,
    StoryVersion,
    Collection,
    Comment,
  ]);

  author = await register('Author');
  follower = await register('Follower');
  stranger = await register('Stranger');

  poemId = await createPublishedPoem(author.accessToken, {
    title: 'The Vanishing',
    tags: ['unity'],
    moods: ['hope'],
  });
  controlPoemId = await createPublishedPoem(author.accessToken, {
    title: 'The Witness',
    tags: ['control'],
    moods: ['calm'],
  });

  // Story with one chapter (publish requires non-empty chapter content).
  const story = await request(app)
    .post('/api/v1/stories')
    .set('Authorization', `Bearer ${author.accessToken}`)
    .send({ title: 'A Long Departure', language: 'en' });
  expect(story.status).toBe(201);
  storyId = story.body.data.id;
  const chapter = await request(app)
    .post(`/api/v1/stories/${storyId}/chapters`)
    .set('Authorization', `Bearer ${author.accessToken}`)
    .send({ title: 'One', content: 'chapter body' });
  expect(chapter.status).toBe(201);
  const publish = await request(app)
    .post(`/api/v1/stories/${storyId}/publish`)
    .set('Authorization', `Bearer ${author.accessToken}`)
    .send({});
  expect(publish.status).toBe(200);

  // Public collection containing the doomed poem.
  const collection = await request(app)
    .post('/api/v1/collections')
    .set('Authorization', `Bearer ${author.accessToken}`)
    .send({ title: 'Favorites', visibility: 'public' });
  expect(collection.status).toBe(201);
  collectionId = collection.body.data.id;
  const added = await request(app)
    .post(`/api/v1/collections/${collectionId}/poems`)
    .set('Authorization', `Bearer ${author.accessToken}`)
    .send({ poemId });
  expect(added.status).toBe(201);

  // Live comment + follow edge + trending scores.
  const comment = await request(app)
    .post('/api/v1/comments')
    .set('Authorization', `Bearer ${stranger.accessToken}`)
    .send({ targetType: 'poem', targetId: poemId, content: 'haunting' });
  expect(comment.status).toBe(201);

  const follow = await request(app)
    .post(`/api/v1/users/${author.user.id}/follow`)
    .set('Authorization', `Bearer ${follower.accessToken}`);
  expect(follow.status).toBe(201);

  await runTrendingRefresh();
});

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('positive controls - every surface serves the poem before removal', () => {
  it('following feed contains it', async () => {
    const res = await get('/api/v1/feed', follower.accessToken);
    expect(res.status).toBe(200);
    expect(ids(res)).toContain(poemId);
  });

  it('mood and tag discovery contain it', async () => {
    const mood = await get('/api/v1/discover/mood/hope');
    expect(mood.status).toBe(200);
    expect(ids(mood)).toContain(poemId);

    const tag = await get('/api/v1/discover/tags/unity');
    expect(tag.status).toBe(200);
    expect(ids(tag)).toContain(poemId);
  });

  it('trending contains it and the public count is 2', async () => {
    const trending = await get('/api/v1/discover/trending');
    expect(trending.status).toBe(200);
    expect(ids(trending)).toContain(poemId);
    expect(await countPublicPublished()).toBe(2);
  });

  it('collection hydrate, mobile BFF, comments, and author story list serve it', async () => {
    const collection = await get(`/api/v1/collections/${collectionId}`, stranger.accessToken);
    expect(collection.status).toBe(200);
    expect(collection.body.data.poems.map((p) => p.id)).toContain(poemId);

    const bff = await get(`/api/v1/mobile/poems/${poemId}`, stranger.accessToken);
    expect(bff.status).toBe(200);
    expect(bff.body.data.poem.id).toBe(poemId);

    const comments = await get(
      `/api/v1/comments?targetType=poem&targetId=${poemId}`,
      stranger.accessToken,
    );
    expect(comments.status).toBe(200);
    expect(comments.body.data.items).toHaveLength(1);

    const stories = await get(`/api/v1/users/${author.user.id}/stories`, stranger.accessToken);
    expect(stories.status).toBe(200);
    expect(ids(stories)).toContain(storyId);
  });
});

describe('removed content disappears from every public read (gate 14.5)', () => {
  beforeAll(async () => {
    const delPoem = await request(app)
      .delete(`/api/v1/poems/${poemId}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expect(delPoem.status).toBe(200);
    const delStory = await request(app)
      .delete(`/api/v1/stories/${storyId}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expect(delStory.status).toBe(200);
  });

  it('following feed no longer contains it (control poem still there)', async () => {
    const res = await get('/api/v1/feed', follower.accessToken);
    expect(res.status).toBe(200);
    expect(ids(res)).not.toContain(poemId);
    expect(ids(res)).toContain(controlPoemId);
  });

  it('mood and tag discovery no longer contain it', async () => {
    const mood = await get('/api/v1/discover/mood/hope');
    expect(ids(mood)).not.toContain(poemId);

    const tag = await get('/api/v1/discover/tags/unity');
    expect(ids(tag)).not.toContain(poemId);
  });

  it('trending and the public count exclude it', async () => {
    const trending = await get('/api/v1/discover/trending');
    expect(ids(trending)).not.toContain(poemId);
    expect(await countPublicPublished()).toBe(1);
  });

  it('the random loop never surfaces it', async () => {
    for (let i = 0; i < 5; i += 1) {
      const res = await get('/api/v1/discover/random');
      expect(res.status).toBe(200);
      const item = res.body.data.poem;
      if (item) expect(item.id).not.toBe(poemId);
    }
  });

  it('collection hydrate drops it', async () => {
    const collection = await get(`/api/v1/collections/${collectionId}`, stranger.accessToken);
    expect(collection.status).toBe(200);
    expect(collection.body.data.poems.map((p) => p.id)).not.toContain(poemId);
  });

  it('mobile BFF 404s for strangers but keeps author recovery access', async () => {
    const strangerRead = await get(`/api/v1/mobile/poems/${poemId}`, stranger.accessToken);
    expect(strangerRead.status).toBe(404);
    expect(strangerRead.body.error.code).toBe('POEM_NOT_FOUND');

    const authorRead = await get(`/api/v1/mobile/poems/${poemId}`, author.accessToken);
    expect(authorRead.status).toBe(200);
  });

  it('direct get 404s for strangers while the author can still open the draft', async () => {
    const strangerRead = await get(`/api/v1/poems/${poemId}`, stranger.accessToken);
    expect(strangerRead.status).toBe(404);

    const anonymous = await get(`/api/v1/poems/${poemId}`);
    expect(anonymous.status).toBe(404);

    const authorRead = await get(`/api/v1/poems/${poemId}`, author.accessToken);
    expect(authorRead.status).toBe(200);
    expect(authorRead.body.data.id).toBe(poemId);
  });

  it('comments on the removed poem 404 instead of leaking discussion', async () => {
    const res = await get(
      `/api/v1/comments?targetType=poem&targetId=${poemId}`,
      stranger.accessToken,
    );
    expect(res.status).toBe(404);
  });

  it('author story list hides the removed story for everyone (control intact)', async () => {
    const strangerView = await get(`/api/v1/users/${author.user.id}/stories`, stranger.accessToken);
    expect(strangerView.status).toBe(200);
    expect(ids(strangerView)).not.toContain(storyId);

    const authorView = await get(`/api/v1/users/${author.user.id}/stories`, author.accessToken);
    expect(authorView.status).toBe(200);
    expect(ids(authorView)).not.toContain(storyId);
  });
});
