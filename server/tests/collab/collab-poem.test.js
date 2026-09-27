'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { CollabPoem } = require('../../src/modules/collab/collab-poem.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan step 63: fixed-turn collab poems — server-side turn/line validation,
 * append-only turns (order is server-derived), creator-only finish.
 */

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(displayName = 'Poet') {
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

function createPoem(token, body = { title: 'Relay', linesPerTurn: 2 }) {
  return request(app)
    .post('/api/v1/collab-poems')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function addTurn(token, id, body) {
  return request(app)
    .post(`/api/v1/collab-poems/${id}/turns`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, CollabPoem]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await CollabPoem.deleteMany({});
});

describe('CollabPoem create + read (plan step 63)', () => {
  test('requires auth, creates with defaults, detail round-trips', async () => {
    const unauth = await request(app).post('/api/v1/collab-poems').send({ title: 'X', linesPerTurn: 1 });
    expect(unauth.status).toBe(401);

    const me = await register();
    const res = await createPoem(me.accessToken);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Relay',
      linesPerTurn: 2,
      status: 'open',
      turnCount: 0,
      turns: [],
    });

    const detail = await request(app)
      .get(`/api/v1/collab-poems/${res.body.data.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.id).toBe(res.body.data.id);
    expect(detail.body.data.creatorId).toBe(me.user.id);
  });

  test('list pages with cursor, newest first', async () => {
    const me = await register();
    await createPoem(me.accessToken, { title: 'One', linesPerTurn: 1 });
    await createPoem(me.accessToken, { title: 'Two', linesPerTurn: 2 });

    const page = await request(app)
      .get('/api/v1/collab-poems?limit=1')
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(page.status).toBe(200);
    expect(page.body.data.items).toHaveLength(1);
    expect(page.body.data.items[0].title).toBe('Two');
    expect(page.body.data.nextCursor).toEqual(expect.any(String));

    const next = await request(app)
      .get(`/api/v1/collab-poems?limit=1&cursor=${encodeURIComponent(page.body.data.nextCursor)}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(next.status).toBe(200);
    expect(next.body.data.items[0].title).toBe('One');
    expect(next.body.data.nextCursor).toBeNull();
  });
});

describe('turn validation (plan step 63: never trust client counts)', () => {
  test('rejects wrong line count with field-level error', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await addTurn(me.accessToken, poem.body.data.id, { content: 'only one line' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('LINE_COUNT_MISMATCH');
    expect(res.body.error.details[0].field).toBe('content');
    expect(res.body.error.details[0].message).toContain('expected 2 lines, got 1');
  });

  test('accepts exact count; CRLF and one trailing newline do not count', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await addTurn(me.accessToken, poem.body.data.id, {
      content: 'first line\r\nsecond line\r\n',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.turnCount).toBe(1);
    expect(res.body.data.turns[0].order).toBe(0);
  });

  test('blank interior lines count (poetry), whitespace-only turn rejected', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const blank = await addTurn(me.accessToken, poem.body.data.id, { content: '   \n   ' });
    expect(blank.status).toBe(400);

    // interior blank line makes three lines against linesPerTurn: 3
    const three = await createPoem(me.accessToken, { title: 'Tercet', linesPerTurn: 3 });
    const ok = await addTurn(me.accessToken, three.body.data.id, { content: 'verse\n\nline' });
    expect(ok.status).toBe(201);
    expect(ok.body.data.turnCount).toBe(1);
  });

  test('order is server-derived: a client-supplied order is ignored', async () => {
    const me = await register();
    const poem = await createPoem(me.accessToken);

    const res = await addTurn(me.accessToken, poem.body.data.id, {
      content: 'a\nb',
      order: 99,
      turns: [{ order: 5 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.data.turns[0].order).toBe(0);
  });

  test('turns append: second writer gets order 1 with hydrated author', async () => {
    const me = await register('Alice');
    const other = await register('Bob');
    const poem = await createPoem(me.accessToken);

    await addTurn(me.accessToken, poem.body.data.id, { content: 'mine\nline' });
    const res = await addTurn(other.accessToken, poem.body.data.id, { content: 'yours\nline' });

    expect(res.status).toBe(201);
    expect(res.body.data.turnCount).toBe(2);
    expect(res.body.data.turns[1]).toMatchObject({ order: 1, lines: 'yours\nline' });
    expect(res.body.data.turns[1].author.username).toBe(other.user.username);
    expect(res.body.data.turns[0].author.username).toBe(me.user.username);
  });
});

describe('finish (creator-only, then the poem rejects turns)', () => {
  test('non-creator gets 403; creator finishes; later turn gets 409', async () => {
    const me = await register();
    const other = await register();
    const poem = await createPoem(me.accessToken);
    const id = poem.body.data.id;

    const forbidden = await request(app)
      .post(`/api/v1/collab-poems/${id}/finish`)
      .set('Authorization', `Bearer ${other.accessToken}`);
    expect(forbidden.status).toBe(403);

    const finished = await request(app)
      .post(`/api/v1/collab-poems/${id}/finish`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(finished.status).toBe(200);
    expect(finished.body.data.status).toBe('finished');

    const again = await request(app)
      .post(`/api/v1/collab-poems/${id}/finish`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(again.status).toBe(409);

    const lateTurn = await addTurn(other.accessToken, id, { content: 'too\nlate' });
    expect(lateTurn.status).toBe(409);
    expect(lateTurn.body.error.code).toBe('COLLAB_FINISHED');
  });

  test('missing poem 404s on turn and finish', async () => {
    const me = await register();
    const ghost = 'a'.repeat(24);
    expect((await addTurn(me.accessToken, ghost, { content: 'a\nb' })).status).toBe(404);
    expect(
      (await request(app)
        .post(`/api/v1/collab-poems/${ghost}/finish`)
        .set('Authorization', `Bearer ${me.accessToken}`)).status,
    ).toBe(404);
  });
});
