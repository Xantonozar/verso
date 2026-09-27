'use strict';

/**
 * Anonymity regression suite (Phase 7, plan step 60 + progress 7.4).
 *
 * The invariant: the server ALWAYS stores the real authorId/userId, but no
 * payload handed to a non-owner/non-moderator may contain it — anywhere, at
 * any nesting depth. Every case below deep-scans the raw response body for
 * the real ids/usernames instead of checking one field, so a leak through
 * any serializer (poem, BFF, comment, reaction, diary, feed, discover,
 * collections) fails the suite.
 *
 * Search results will join this suite when the search endpoint ships (plan
 * §6) — there is no search route yet to scan.
 */

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Reaction } = require('../../src/modules/engagement/reaction.model');
const { Comment } = require('../../src/modules/engagement/comment.model');
const { DiaryEntry } = require('../../src/modules/diary/diary.model');
const { Collection } = require('../../src/modules/collections/collection.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Anon Tester',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function promoteToModerator(user) {
  await User.updateOne({ _id: user.user.id }, { $set: { 'roles.security': 'moderator' } });
}

async function createPoem(token, overrides = {}) {
  const res = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({
      title: 'First Light',
      content: 'dawn\nspills over',
      visibility: 'public',
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function publishPoem(token, poemId) {
  const res = await request(app)
    .post(`/api/v1/poems/${poemId}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

/** Every string at any depth of the parsed body — the leak surface. */
function deepStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => deepStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => deepStrings(v, out));
  return out;
}

/** No needle (real id/username) may appear anywhere in the payload. */
function expectNoLeak(body, needles, label) {
  const strings = deepStrings(body);
  for (const needle of needles) {
    expect({ label, needle, leaked: strings.includes(needle) }).toEqual({
      label,
      needle,
      leaked: false,
    });
  }
}

/** Control — proves the scanner would actually catch a leak. */
function expectPresent(body, needle, label) {
  const strings = deepStrings(body);
  expect({ label, needle, present: strings.includes(needle) }).toEqual({
    label,
    needle,
    present: true,
  });
}

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Follow,
    Poem,
    PoemVersion,
    Reaction,
    Comment,
    DiaryEntry,
    Collection,
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('poem detail strips identity (plan step 60)', () => {
  test('anonymous poem: reader sees no authorId/author/username; control proves the scanner', async () => {
    const author = await register();
    const reader = await register();
    const anon = await createPoem(author.accessToken, { anonymous: true });
    await publishPoem(author.accessToken, anon.id);
    const plain = await createPoem(author.accessToken, { anonymous: false });
    await publishPoem(author.accessToken, plain.id);

    const anonRes = await request(app)
      .get(`/api/v1/poems/${anon.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(anonRes.status).toBe(200);
    expect(anonRes.body.data.authorId).toBeUndefined();
    expect(anonRes.body.data.author ?? null).toBeNull();
    expect(anonRes.body.data.anonymous).toBe(true);
    expectNoLeak(
      anonRes.body,
      [author.user.id, author.user.username],
      'poem detail (anonymous, other reader)',
    );

    // Control: the same scanner detects the id on a non-anonymous poem.
    const plainRes = await request(app)
      .get(`/api/v1/poems/${plain.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(plainRes.status).toBe(200);
    expectPresent(plainRes.body, author.user.id, 'poem detail control');
  });

  test('anonymous poem: owner still sees their own identity', async () => {
    const author = await register();
    const anon = await createPoem(author.accessToken, { anonymous: true });
    await publishPoem(author.accessToken, anon.id);

    const res = await request(app)
      .get(`/api/v1/poems/${anon.id}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.authorId).toBe(author.user.id);
    expectPresent(res.body, author.user.id, 'poem detail (owner)');
  });

  test('anonymous poem: moderator sees the real author', async () => {
    const author = await register();
    const mod = await register();
    await promoteToModerator(mod);
    const anon = await createPoem(author.accessToken, { anonymous: true });
    await publishPoem(author.accessToken, anon.id);

    const res = await request(app)
      .get(`/api/v1/poems/${anon.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.authorId).toBe(author.user.id);
  });
});

describe('BFF mobile read model strips identity', () => {
  test('GET /mobile/poems/:id — reader no leak, owner sees, control passes', async () => {
    const author = await register();
    const reader = await register();
    const anon = await createPoem(author.accessToken, { anonymous: true });
    await publishPoem(author.accessToken, anon.id);

    const readerRes = await request(app)
      .get(`/api/v1/mobile/poems/${anon.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(readerRes.status).toBe(200);
    expect(readerRes.body.data.poem.authorId).toBeUndefined();
    expect(readerRes.body.data.poem.author ?? null).toBeNull();
    expectNoLeak(readerRes.body, [author.user.id, author.user.username], 'mobile poem (reader)');

    const ownerRes = await request(app)
      .get(`/api/v1/mobile/poems/${anon.id}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.body.data.poem.authorId).toBe(author.user.id);
  });
});

describe('comments strip identity (plan step 60)', () => {
  test('anonymous comment + reply: author of the poem sees no commenter id', async () => {
    const poemAuthor = await register();
    const commenter = await register();
    const poem = await createPoem(poemAuthor.accessToken, { anonymous: true });
    await publishPoem(poemAuthor.accessToken, poem.id);

    const top = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ targetType: 'poem', targetId: poem.id, content: 'quietly here', anonymous: true });
    expect(top.status).toBe(201);
    expect(top.body.data.authorId).toBe(commenter.user.id); // creator sees self

    const reply = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({
        targetType: 'poem',
        targetId: poem.id,
        parentCommentId: top.body.data.id,
        content: 'and again',
        anonymous: true,
      });
    expect(reply.status).toBe(201);

    const list = await request(app)
      .get('/api/v1/comments')
      .query({ targetType: 'poem', targetId: poem.id })
      .set('Authorization', `Bearer ${poemAuthor.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].authorId).toBeUndefined();
    expect(list.body.data.items[0].author).toBeNull();
    expect(list.body.data.items[0].replies[0].authorId).toBeUndefined();
    expectNoLeak(
      list.body,
      [commenter.user.id, commenter.user.username],
      'comment list (poem author reads)',
    );

    // Control: the commenter sees their own id in the same listing.
    const selfList = await request(app)
      .get('/api/v1/comments')
      .query({ targetType: 'poem', targetId: poem.id })
      .set('Authorization', `Bearer ${commenter.accessToken}`);
    expect(selfList.status).toBe(200);
    expectPresent(selfList.body, commenter.user.id, 'comment list control (self)');
  });

  test('anonymous comment: moderator sees the real commenter', async () => {
    const poemAuthor = await register();
    const commenter = await register();
    const mod = await register();
    await promoteToModerator(mod);
    const poem = await createPoem(poemAuthor.accessToken, { anonymous: true });
    await publishPoem(poemAuthor.accessToken, poem.id);
    await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ targetType: 'poem', targetId: poem.id, content: 'anon note', anonymous: true });

    const list = await request(app)
      .get('/api/v1/comments')
      .query({ targetType: 'poem', targetId: poem.id })
      .set('Authorization', `Bearer ${mod.accessToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].authorId).toBe(commenter.user.id);
  });
});

describe('reactions always store the real user, never echo it (plan step 60)', () => {
  test('anonymous reaction: response has no userId anywhere; DB keeps the real one', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPoem(author.accessToken, { anonymous: true });
    await publishPoem(author.accessToken, poem.id);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'loved', anonymous: true });
    expect(res.status).toBe(201);
    expect(res.body.data.reaction.anonymous).toBe(true);
    expectNoLeak(res.body, [reader.user.id, reader.user.username], 'reaction create');

    // Always store the real id, even when the payload must not echo it.
    const stored = await Reaction.find({ targetType: 'poem', type: 'loved' });
    expect(stored).toHaveLength(1);
    expect(String(stored[0].userId)).toBe(reader.user.id);
  });
});

describe('diary detail strips identity', () => {
  test('anonymous diary: reader sees no authorId; control passes', async () => {
    const author = await register();
    const reader = await register();

    const anon = await request(app)
      .post('/api/v1/diary')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ content: 'unsaid things accumulate', visibility: 'public', anonymous: true });
    expect(anon.status).toBe(201);
    const plain = await request(app)
      .post('/api/v1/diary')
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ content: 'said things too', visibility: 'public', anonymous: false });
    expect(plain.status).toBe(201);

    const anonRes = await request(app)
      .get(`/api/v1/diary/${anon.body.data.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(anonRes.status).toBe(200);
    expect(anonRes.body.data.authorId).toBeUndefined();
    expectNoLeak(anonRes.body, [author.user.id, author.user.username], 'diary detail (anonymous)');

    const plainRes = await request(app)
      .get(`/api/v1/diary/${plain.body.data.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(plainRes.status).toBe(200);
    expectPresent(plainRes.body, author.user.id, 'diary detail control');
  });
});

describe('list surfaces strip identity (feed / discover / collections)', () => {
  test('feed: anonymous poem carries no author id; control poem does', async () => {
    // Two authors: scanning a whole feed body must not trip over the
    // control item's legitimate author id.
    const anonAuthor = await register();
    const plainAuthor = await register();
    const reader = await register();
    const anon = await createPoem(anonAuthor.accessToken, { anonymous: true, moods: ['calm'] });
    await publishPoem(anonAuthor.accessToken, anon.id);
    const plain = await createPoem(plainAuthor.accessToken, { anonymous: false, moods: ['calm'] });
    await publishPoem(plainAuthor.accessToken, plain.id);

    for (const target of [anonAuthor, plainAuthor]) {
      const follow = await request(app)
        .post(`/api/v1/users/${target.user.id}/follow`)
        .set('Authorization', `Bearer ${reader.accessToken}`);
      expect(follow.status).toBe(201);
    }

    const feed = await request(app)
      .get('/api/v1/feed')
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(feed.status).toBe(200);
    expectNoLeak(
      feed.body,
      [anonAuthor.user.id, anonAuthor.user.username],
      'feed (anonymous item)',
    );
    expectPresent(feed.body, plainAuthor.user.id, 'feed control (non-anonymous item)');
  });

  test('discover by mood: anonymous poem carries no author id', async () => {
    const anonAuthor = await register();
    const plainAuthor = await register();
    const anon = await createPoem(anonAuthor.accessToken, { anonymous: true, moods: ['calm'] });
    await publishPoem(anonAuthor.accessToken, anon.id);
    const plain = await createPoem(plainAuthor.accessToken, { anonymous: false, moods: ['calm'] });
    await publishPoem(plainAuthor.accessToken, plain.id);

    const res = await request(app).get('/api/v1/discover/mood/calm');
    expect(res.status).toBe(200);
    expectNoLeak(
      res.body,
      [anonAuthor.user.id, anonAuthor.user.username],
      'discover mood (anonymous)',
    );
    expectPresent(res.body, plainAuthor.user.id, 'discover control (non-anonymous)');
  });

  test('collection detail: hydrated anonymous poem exposes no author', async () => {
    const anonAuthor = await register();
    const plainAuthor = await register();
    const reader = await register();
    const anon = await createPoem(anonAuthor.accessToken, { anonymous: true });
    await publishPoem(anonAuthor.accessToken, anon.id);
    const plain = await createPoem(plainAuthor.accessToken, { anonymous: false });
    await publishPoem(plainAuthor.accessToken, plain.id);

    const created = await request(app)
      .post('/api/v1/collections')
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ title: 'Quiet ones' });
    expect(created.status).toBe(201);
    const collectionId = created.body.data.id;
    for (const poemId of [anon.id, plain.id]) {
      const add = await request(app)
        .post(`/api/v1/collections/${collectionId}/poems`)
        .set('Authorization', `Bearer ${reader.accessToken}`)
        .send({ poemId });
      expect(add.status).toBe(201);
    }

    const detail = await request(app)
      .get(`/api/v1/collections/${collectionId}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(detail.status).toBe(200);
    const anonItem = detail.body.data.poems.find((p) => p.id === anon.id);
    expect(anonItem.author).toBeNull();
    expectNoLeak(
      anonItem,
      [anonAuthor.user.id, anonAuthor.user.username],
      'collection poem (anonymous)',
    );
    expectPresent(
      detail.body.data.poems.find((p) => p.id === plain.id),
      plainAuthor.user.id,
      'collection control (non-anonymous)',
    );
  });
});
