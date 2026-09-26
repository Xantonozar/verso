'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Story } = require('../../src/modules/stories/story.model');
const { StoryChapter } = require('../../src/modules/stories/story-chapter.model');
const { StoryVersion } = require('../../src/modules/stories/story-version.model');
const { serializeFeedItem } = require('../../src/serializers/feed-item.serializer');
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

/** Seed with explicit ascending createdAt so cursor pagination is deterministic. */
async function seedStory(authorId, i, { status = 'draft', ...overrides } = {}) {
  const story = await Story.create({
    authorId,
    title: `Story ${i}`,
    status,
    ...overrides,
  });
  await Story.updateOne(
    { _id: story._id },
    { $set: { createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)) } },
  );
  return String(story._id);
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Story, StoryChapter, StoryVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('GET /users/:id/stories — profile story list (plan 41B, profile scope)', () => {
  test('self sees drafts + published, never removed', async () => {
    const me = await register();
    await seedStory(me.user.id, 1, { status: 'draft' });
    await seedStory(me.user.id, 2, { status: 'published' });
    await seedStory(me.user.id, 3, { status: 'removed' });

    const res = await request(app)
      .get(`/api/v1/users/${me.user.id}/stories`)
      .set('Authorization', `Bearer ${me.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((s) => s.title)).toEqual(['Story 2', 'Story 1']);
    expect(res.body.data.items[0].status).toBe('published');
    expect(res.body.data.items[1].status).toBe('draft');
    expect(res.body.data.nextCursor).toBeNull();
  });

  test('stranger sees only published (draft, unlisted, removed excluded)', async () => {
    const author = await register();
    const stranger = await register();
    await seedStory(author.user.id, 1, { status: 'draft' });
    await seedStory(author.user.id, 2, { status: 'published' });
    await seedStory(author.user.id, 3, { status: 'unlisted' });
    await seedStory(author.user.id, 4, { status: 'removed' });

    const res = await request(app)
      .get(`/api/v1/users/${author.user.id}/stories`)
      .set('Authorization', `Bearer ${stranger.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.map((s) => s.title)).toEqual(['Story 2']);
    expect(res.body.data.items[0]).not.toHaveProperty('content');
    expect(res.body.data.items[0].chapterCount).toBe(0);
  });

  test('unauthenticated profile list works (public surface)', async () => {
    const author = await register();
    await seedStory(author.user.id, 1, { status: 'published' });

    const res = await request(app).get(`/api/v1/users/${author.user.id}/stories`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
  });

  test('cursor pagination follows createdAt desc', async () => {
    const me = await register();
    await seedStory(me.user.id, 1, { status: 'published' });
    await seedStory(me.user.id, 2, { status: 'published' });
    await seedStory(me.user.id, 3, { status: 'published' });

    const page1 = await request(app)
      .get(`/api/v1/users/${me.user.id}/stories?limit=2`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page1.body.data.items.map((s) => s.title)).toEqual(['Story 3', 'Story 2']);
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await request(app)
      .get(
        `/api/v1/users/${me.user.id}/stories?limit=2&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
      )
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page2.body.data.items.map((s) => s.title)).toEqual(['Story 1']);
    expect(page2.body.data.nextCursor).toBeNull();
  });

  test('unknown author → 404 USER_NOT_FOUND', async () => {
    const res = await request(app).get('/api/v1/users/64b0000000000000000000ff/stories');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });

  test('invalid id → 400 params.id', async () => {
    const res = await request(app).get('/api/v1/users/not-an-id/stories');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('params.id');
  });
});

describe('Mixed-feed serializer — unambiguous item typing (plan 41B)', () => {
  const author = { id: 'u1', username: 'writer', displayName: 'Writer', profilePhotoUrl: '' };

  test('poem item: type=poem, content excerpt, moods present, no chapter fields', () => {
    const item = serializeFeedItem(
      'poem',
      {
        _id: 'p1',
        title: 'First Light',
        content: 'dawn spills over the windowsill and the kettle sings softly',
        status: 'published',
        language: 'en',
        moods: ['tender'],
        tags: ['morning'],
        anonymous: false,
        publishedAt: '2026-01-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        stats: { reads: 3 },
      },
      author,
    );

    expect(item.type).toBe('poem');
    expect(item.id).toBe('p1');
    expect(item.excerpt).toBe('dawn spills over the windowsill and the kettle sings softly');
    expect(item.moods).toEqual(['tender']);
    expect(item.author.username).toBe('writer');
    expect(item).not.toHaveProperty('chapterCount');
    expect(item).not.toHaveProperty('synopsis');
  });

  test('story item: type=story, synopsis excerpt, chapterCount, no poem fields', () => {
    const item = serializeFeedItem(
      'story',
      {
        _id: 's1',
        title: 'The Lighthouse',
        synopsis: 'A keeper, a storm, and a light that must not fail.',
        coverUrl: 'https://cdn.example/cover.png',
        chapterCount: 12,
        status: 'published',
        language: 'en',
        tags: ['sea'],
        publishedAt: '2026-02-01T00:00:00.000Z',
        createdAt: '2026-02-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
        stats: { reads: 9 },
      },
      author,
    );

    expect(item.type).toBe('story');
    expect(item.id).toBe('s1');
    expect(item.excerpt).toBe('A keeper, a storm, and a light that must not fail.');
    expect(item.chapterCount).toBe(12);
    expect(item.coverUrl).toBe('https://cdn.example/cover.png');
    expect(item).not.toHaveProperty('moods');
    expect(item).not.toHaveProperty('anonymous');
  });

  test('long text is truncated with an ellipsis at 200 chars', () => {
    const long = 'x'.repeat(250);
    const item = serializeFeedItem(
      'poem',
      { _id: 'p2', title: 't', content: long, status: 'published' },
      null,
    );
    expect(item.excerpt).toHaveLength(201);
    expect(item.excerpt.endsWith('…')).toBe(true);
    expect(item.author).toBeNull();
  });

  test('diary item type is supported (Phase 4-ready)', () => {
    const item = serializeFeedItem(
      'diary',
      {
        _id: 'd1',
        title: '',
        content: 'quiet day, rain on the roof',
        status: 'published',
        mood: 'calm',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
      null,
    );
    expect(item.type).toBe('diary');
    expect(item.mood).toBe('calm');
    expect(item.excerpt).toBe('quiet day, rain on the roof');
  });

  test('unknown type throws (no silent ambiguity)', () => {
    expect(() => serializeFeedItem('video', { _id: 'x' }, null)).toThrow('Unknown feed item type');
  });
});
