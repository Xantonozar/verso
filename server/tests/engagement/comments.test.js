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
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Commenter',
    email: `${id}@example.com`,
    password: 'Password1',
  });
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

async function createPublishedPoem(token) {
  const poem = await createPoem(token, { visibility: 'public' });
  const res = await request(app)
    .post(`/api/v1/poems/${poem.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data;
}

async function comment(token, body) {
  return request(app)
    .post('/api/v1/comments')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

async function listComments(query, token) {
  const req = request(app).get('/api/v1/comments').query(query);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req;
}

async function stats(poemId) {
  const doc = await Poem.findById(poemId).select('stats').lean();
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
  ]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /comments — create (plan step 45)', () => {
  test('top-level comment → 201, commentCount $inc', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'this one stayed with me',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.parentCommentId).toBeNull();
    expect(res.body.data.content).toBe('this one stayed with me');
    expect(res.body.data.authorId).toBe(reader.user.id);
    expect(res.body.data.author.username).toBe(reader.user.username);
    expect((await stats(poem.id)).commentCount).toBe(1);
  });

  test('reply → 201, parent link, commentCount 2', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const top = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'top level',
    });
    const reply = await comment(author.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      parentCommentId: top.body.data.id,
      content: 'thank you',
    });

    expect(reply.status).toBe(201);
    expect(reply.body.data.parentCommentId).toBe(top.body.data.id);
    expect((await stats(poem.id)).commentCount).toBe(2);
  });

  test('reply to a reply → 400 REPLY_DEPTH (2-level threads only)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const top = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'top',
    });
    const reply = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      parentCommentId: top.body.data.id,
      content: 'reply',
    });
    const nested = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      parentCommentId: reply.body.data.id,
      content: 'too deep',
    });

    expect(nested.status).toBe(400);
    expect(nested.body.error.code).toBe('REPLY_DEPTH');
  });

  test('reply whose parent belongs to another poem → 404 COMMENT_NOT_FOUND', async () => {
    const author = await register();
    const reader = await register();
    const poemA = await createPublishedPoem(author.accessToken);
    const poemB = await createPublishedPoem(author.accessToken);

    const parentOnA = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poemA.id,
      content: 'on A',
    });
    const res = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poemB.id,
      parentCommentId: parentOnA.body.data.id,
      content: 'cross-post',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('COMMENT_NOT_FOUND');
  });

  test('empty content → 400; over 500 chars → 400', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const empty = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: '   ',
    });
    expect(empty.status).toBe(400);

    const long = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'x'.repeat(501),
    });
    expect(long.status).toBe(400);
  });

  test('unauthenticated → 401', async () => {
    const author = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post('/api/v1/comments')
      .send({ targetType: 'poem', targetId: poem.id, content: 'hi' });
    expect(res.status).toBe(401);
  });

  test('comment on a removed poem → 404 POEM_NOT_FOUND (plan step 49)', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);
    await Poem.updateOne({ _id: poem.id }, { $set: { status: 'removed' } });

    const res = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'still here?',
    });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('POEM_NOT_FOUND');
    expect(await Comment.countDocuments({ targetId: poem.id })).toBe(0);
    expect((await stats(poem.id)).commentCount).toBe(0);
  });

  test("comment on a hidden poem (non-owner) → 404", async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);
    await Poem.updateOne({ _id: poem.id }, { $set: { status: 'hidden' } });

    const res = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'hey',
    });
    expect(res.status).toBe(404);
  });

  test("comment on someone else's draft → 404 (owner can comment on own draft)", async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPoem(author.accessToken);

    const stranger = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'peeking',
    });
    expect(stranger.status).toBe(404);

    const own = await comment(author.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'note to self',
    });
    expect(own.status).toBe(201);
  });

  test('unknown diary id → 404 TARGET_NOT_FOUND', async () => {
    const reader = await register();
    const res = await comment(reader.accessToken, {
      targetType: 'diary',
      targetId: '507f1f77bcf86cd799439011',
      content: 'soon',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('TARGET_NOT_FOUND');
  });
});

describe('GET /comments — paginated nested thread (plan step 48)', () => {
  test('top-level page asc + embedded replies + replyCount, batched authors', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const first = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'first',
    });
    await comment(author.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      parentCommentId: first.body.data.id,
      content: 'author reply',
    });
    await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'second',
    });

    const page1 = await listComments({ targetType: 'poem', targetId: poem.id, limit: '1' });
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.items[0].content).toBe('first');
    expect(page1.body.data.items[0].replyCount).toBe(1);
    expect(page1.body.data.items[0].replies).toHaveLength(1);
    expect(page1.body.data.items[0].replies[0].content).toBe('author reply');
    expect(page1.body.data.items[0].author.username).toBe(reader.user.username);
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await listComments({
      targetType: 'poem',
      targetId: poem.id,
      limit: '1',
      cursor: page1.body.data.nextCursor,
    });
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.items[0].content).toBe('second');
    expect(page2.body.data.items[0].replyCount).toBe(0);
    expect(page2.body.data.nextCursor).toBeNull();
  });

  test('anonymous comment hides authorId from others but not from the author', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'whisper',
      anonymous: true,
    });

    const asStranger = await listComments(
      { targetType: 'poem', targetId: poem.id },
      author.accessToken,
    );
    expect(asStranger.body.data.items[0].authorId).toBeUndefined();
    expect(asStranger.body.data.items[0].author).toBeNull();
    expect(asStranger.body.data.items[0].anonymous).toBe(true);

    const asSelf = await listComments(
      { targetType: 'poem', targetId: poem.id },
      reader.accessToken,
    );
    expect(asSelf.body.data.items[0].authorId).toBe(reader.user.id);
  });

  test('removed comment disappears from the thread', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'keep me',
    });
    const gone = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'delete me',
    });

    const del = await request(app)
      .delete(`/api/v1/comments/${gone.body.data.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(del.status).toBe(200);

    const page = await listComments({ targetType: 'poem', targetId: poem.id });
    const contents = page.body.data.items.map((c) => c.content);
    expect(contents).toContain('keep me');
    expect(contents).not.toContain('delete me');
    expect((await stats(poem.id)).commentCount).toBe(1);
  });

  test('list on a removed poem → 404', async () => {
    const author = await register();
    const poem = await createPublishedPoem(author.accessToken);
    await Poem.updateOne({ _id: poem.id }, { $set: { status: 'removed' } });

    const res = await listComments({ targetType: 'poem', targetId: poem.id });
    expect(res.status).toBe(404);
  });

  test('unauthenticated list on a public poem → 200', async () => {
    const author = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const res = await listComments({ targetType: 'poem', targetId: poem.id });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });
});

describe('DELETE /comments/:id — authz + counters (plan step 45)', () => {
  test('owner delete → soft-remove + commentCount decrement; repeat → 404 no double decrement', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const c = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'temp',
    });

    const del = await request(app)
      .delete(`/api/v1/comments/${c.body.data.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(del.status).toBe(200);
    expect(del.body.data.status).toBe('removed');
    expect((await stats(poem.id)).commentCount).toBe(0);

    const again = await request(app)
      .delete(`/api/v1/comments/${c.body.data.id}`)
      .set('Authorization', `Bearer ${reader.accessToken}`);
    expect(again.status).toBe(404);
    expect((await stats(poem.id)).commentCount).toBe(0);

    const stored = await Comment.findById(c.body.data.id).lean();
    expect(stored.status).toBe('removed');
  });

  test("someone else's comment → 403 FORBIDDEN", async () => {
    const author = await register();
    const reader = await register();
    const other = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const c = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'mine',
    });
    const res = await request(app)
      .delete(`/api/v1/comments/${c.body.data.id}`)
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(res.status).toBe(403);
    expect((await stats(poem.id)).commentCount).toBe(1);
  });

  test('moderator can delete any comment', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const c = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'reportable',
    });
    const mod = await register();
    await User.updateOne({ _id: mod.user.id }, { $set: { 'roles.security': 'moderator' } });

    const res = await request(app)
      .delete(`/api/v1/comments/${c.body.data.id}`)
      .set('Authorization', `Bearer ${mod.accessToken}`);
    expect(res.status).toBe(200);
    expect((await stats(poem.id)).commentCount).toBe(0);
  });

  test('reply deletion decrements the counter too', async () => {
    const author = await register();
    const reader = await register();
    const poem = await createPublishedPoem(author.accessToken);

    const top = await comment(reader.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      content: 'top',
    });
    const reply = await comment(author.accessToken, {
      targetType: 'poem',
      targetId: poem.id,
      parentCommentId: top.body.data.id,
      content: 'reply',
    });
    expect((await stats(poem.id)).commentCount).toBe(2);

    await request(app)
      .delete(`/api/v1/comments/${reply.body.data.id}`)
      .set('Authorization', `Bearer ${author.accessToken}`);
    expect((await stats(poem.id)).commentCount).toBe(1);
  });
});
