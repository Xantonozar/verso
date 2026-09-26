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
const { Story } = require('../../src/modules/stories/story.model');
const { DiaryEntry } = require('../../src/modules/diary/diary.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `i${Date.now().toString(36)}${(seq++).toString(36)}`;

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

async function createPoem(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'First Light', content: 'dawn\nspills over', ...overrides });
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
    Story,
    DiaryEntry,
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

// ---------------------------------------------------------------------------
// GATE 4.2 — diary can never surface in mood/tag discovery (plan step 51).
// Three independent layers are asserted: physical storage, schema shape, and
// query/HTTP behaviour. Phase 5 (Discovery & Feed) adds the endpoint-level
// IXSCAN explain tests on top of the query-shape assertions here.
// ---------------------------------------------------------------------------
describe('GATE 4.2 — diary is structurally out of mood/tag discovery', () => {
  test('storage isolation: diary lives in its own collection, not poems', async () => {
    const author = await register();
    await postDiary(author.accessToken, { content: 'a diary row' });
    await createPoem(author.accessToken);

    expect(DiaryEntry.collection.name).not.toBe(Poem.collection.name);
    expect(await DiaryEntry.countDocuments()).toBe(1);
    expect(await Poem.countDocuments()).toBe(1);
  });

  test('schema isolation: DiaryEntry has no moods/tags/title/status/feltGood paths', async () => {
    const paths = Object.keys(DiaryEntry.schema.paths);
    for (const forbidden of ['moods', 'tags', 'title', 'status', 'feltGood', 'mood']) {
      expect(paths).not.toContain(forbidden);
    }
    // ...and the doc the API actually stores carries none of them either
    const author = await register();
    const entry = await postDiary(author.accessToken, { content: 'clean shape' });
    const stored = await DiaryEntry.findById(entry.id).lean();
    expect(Object.keys(stored).some((k) => ['moods', 'tags', 'title', 'status', 'feltGood'].includes(k))).toBe(
      false,
    );
  });

  test("query isolation: the mood/tag query shapes Phase 5 will use never match diary docs", async () => {
    const author = await register();
    // diary content deliberately mentions mood/tag words — text must not leak in
    await postDiary(author.accessToken, { content: 'joy and hope, a tag-worthy morning' });
    await postDiary(author.accessToken, { content: 'melancholy rain' });

    // The exact filter shapes a moods/tags feed issues against poems:
    const byMood = await Poem.find({ moods: { $in: ['joy'] } }).select('_id').lean();
    const byTag = await Poem.find({ tags: { $in: ['hope'] } }).lean();
    const diaryIds = (await DiaryEntry.find().select('_id').lean()).map((d) => String(d._id));

    expect(byMood).toHaveLength(0);
    expect(byTag).toHaveLength(0);
    const returned = [...byMood, ...byTag].map((d) => String(d._id));
    for (const id of diaryIds) expect(returned).not.toContain(id);

    // Inverse: the same shapes issued against the diary collection match nothing
    expect(await DiaryEntry.find({ moods: { $in: ['joy'] } })).toHaveLength(0);
    expect(await DiaryEntry.find({ tags: { $in: ['hope'] } })).toHaveLength(0);
    expect(await DiaryEntry.find({ title: { $exists: true } })).toHaveLength(0);
    expect(await DiaryEntry.find({ feltGood: { $exists: true } })).toHaveLength(0);
  });

  test('HTTP isolation: poem reads reject diary ids and vice versa', async () => {
    const author = await register();
    const entry = await postDiary(author.accessToken, { content: 'id smuggle attempt' });
    const poem = await createPoem(author.accessToken);

    const poemRoute = await request(app).get(`/api/v1/poems/${entry.id}`);
    expect(poemRoute.status).toBe(404);

    const diaryRoute = await request(app).get(`/api/v1/diary/${poem.id}`);
    expect(diaryRoute.status).toBe(404);
    expect(diaryRoute.body.error.code).toBe('TARGET_NOT_FOUND');
  });

  test('profile stories endpoint never surfaces diary entries (plan step 51)', async () => {
    const author = await register();
    const storyRes = await request(app)
      .post('/api/v1/stories')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ title: 'The Lighthouse' });
    expect(storyRes.status).toBe(201);
    const storyId = storyRes.body.data.id;
    const diary = await postDiary(author.accessToken, { content: 'not a story' });

    // as self (default story status is draft — self sees drafts + published)
    const res = await request(app)
      .get(`/api/v1/users/${author.user.id}/stories`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((s) => s.id);
    expect(ids).toContain(storyId);
    expect(ids).not.toContain(diary.id);
    expect(res.body.data.items).toHaveLength(1);
  });
});
