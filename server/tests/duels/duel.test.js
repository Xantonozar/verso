'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Duel } = require('../../src/modules/duels/duel.model');
const { DuelVote } = require('../../src/modules/duels/duel-vote.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan step 68: duels — server-derived poet links, public-readability pairing,
 * deadline-derived effective status, atomic deadline-guarded `$inc` with
 * unique-index rollback (votes stay exact under races).
 */

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `d${Date.now().toString(36)}${(seq++).toString(36)}`;
const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

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

async function seedPoem(authorId, overrides = {}) {
  return Poem.create({
    authorId,
    title: 'Seed poem',
    content: 'seed words here',
    status: 'published',
    visibility: 'public',
    publishedAt: new Date(),
    ...overrides,
  });
}

function createDuel(token, body) {
  return request(app)
    .post('/api/v1/duels')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function voteOn(token, id, votedFor) {
  return request(app)
    .post(`/api/v1/duels/${id}/vote`)
    .set('Authorization', `Bearer ${token}`)
    .send({ votedFor });
}

function getDuel(id, token) {
  const req = request(app).get(`/api/v1/duels/${id}`);
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
}

let alice;
let bob;
let poemA;
let poemB;

/** Pairing body: both poems published/public, deadlines configurable. */
function duelBody(overrides = {}) {
  return {
    theme: 'Dusk',
    poemAId: String(poemA._id),
    poemBId: String(poemB._id),
    submissionDeadline: iso(60_000),
    votingDeadline: iso(120_000),
    ...overrides,
  };
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Poem, PoemVersion, Duel, DuelVote]);
  alice = await register('Alice');
  bob = await register('Bob');
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([Duel.deleteMany({}), DuelVote.deleteMany({}), Poem.deleteMany({})]);
  poemA = await seedPoem(alice.user.id, { title: 'Aurora' });
  poemB = await seedPoem(bob.user.id, { title: 'Moonfall' });
});

describe('POST /duels (plan step 68)', () => {
  test('requires auth; derives poets and open status from the poems/deadlines', async () => {
    const unauth = await request(app).post('/api/v1/duels').send(duelBody());
    expect(unauth.status).toBe(401);

    const res = await createDuel(alice.accessToken, duelBody());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      theme: 'Dusk',
      poetAId: alice.user.id,
      poetBId: bob.user.id,
      poemAId: String(poemA._id),
      poemBId: String(poemB._id),
      status: 'open',
      votes: { poemA: 0, poemB: 0 },
    });
  });

  test('rejects a poem that is missing, a draft, or not publicly readable', async () => {
    const missing = await createDuel(alice.accessToken, duelBody({ poemBId: 'a'.repeat(24) }));
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('POEM_NOT_FOUND');

    const draft = await seedPoem(bob.user.id, { status: 'draft' });
    const draftRes = await createDuel(alice.accessToken, duelBody({ poemBId: String(draft._id) }));
    expect(draftRes.status).toBe(400);
    expect(draftRes.body.error.code).toBe('POEM_NOT_PUBLIC');

    const hidden = await seedPoem(bob.user.id, { visibility: 'followers' });
    const hiddenRes = await createDuel(alice.accessToken, duelBody({ poemBId: String(hidden._id) }));
    expect(hiddenRes.status).toBe(400);
    expect(hiddenRes.body.error.code).toBe('POEM_NOT_PUBLIC');
  });

  test('rejects same poem, same poet, and deadline inversions at the schema', async () => {
    const samePoem = await createDuel(
      alice.accessToken,
      duelBody({ poemBId: String(poemA._id) }),
    );
    expect(samePoem.status).toBe(400);
    expect(samePoem.body.error.details.some((d) => d.field === 'poemBId')).toBe(true);

    const twin = await seedPoem(alice.user.id, { title: 'Twin' });
    const samePoet = await createDuel(
      alice.accessToken,
      duelBody({ poemBId: String(twin._id) }),
    );
    expect(samePoet.status).toBe(400);
    expect(samePoet.body.error.code).toBe('DUEL_SAME_POET');

    const inverted = await createDuel(
      alice.accessToken,
      duelBody({ submissionDeadline: iso(120_000), votingDeadline: iso(60_000) }),
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.details.some((d) => d.field === 'votingDeadline')).toBe(true);
  });
});

describe('duel detail + list (plan step 68)', () => {
  test('detail hydrates both poems, derives status, carries myVote', async () => {
    const created = await createDuel(
      alice.accessToken,
      duelBody({ submissionDeadline: iso(-1_000), votingDeadline: iso(60_000) }),
    );
    expect(created.body.data.status).toBe('voting');

    await voteOn(alice.accessToken, created.body.data.id, 'A');
    const detail = await getDuel(created.body.data.id, alice.accessToken);
    expect(detail.status).toBe(200);
    expect(detail.body.data).toMatchObject({ status: 'voting', myVote: 'A' });
    expect(detail.body.data.poemA).toMatchObject({
      id: String(poemA._id),
      title: 'Aurora',
    });
    expect(detail.body.data.poemA.content).toBe('seed words here');
    expect(detail.body.data.poemA.author.username).toBe(alice.user.username);

    const anon = await getDuel(created.body.data.id);
    expect(anon.status).toBe(200);
    expect(anon.body.data.myVote).toBeNull();
  });

  test('list pages with cursor, newest first, effective status per row', async () => {
    const first = await createDuel(alice.accessToken, duelBody({ theme: 'Older' }));
    await new Promise((r) => setTimeout(r, 5));
    const second = await createDuel(
      alice.accessToken,
      duelBody({ theme: 'Newer', submissionDeadline: iso(-1_000), votingDeadline: iso(60_000) }),
    );

    const page1 = await request(app).get('/api/v1/duels?limit=1');
    expect(page1.status).toBe(200);
    expect(page1.body.data.items).toHaveLength(1);
    expect(page1.body.data.items[0].theme).toBe('Newer');
    expect(page1.body.data.items[0].status).toBe('voting');
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await request(app).get(
      `/api/v1/duels?limit=1&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`,
    );
    expect(page2.body.data.items[0].id).toBe(first.body.data.id);
    expect(page2.body.data.items[0].theme).toBe('Older');
    expect(second.body.data.theme).toBe('Newer');
  });

  test('unknown duel is 404 DUEL_NOT_FOUND', async () => {
    const res = await getDuel('b'.repeat(24));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('DUEL_NOT_FOUND');
  });
});

describe('POST /duels/:id/vote — window + atomicity (plan step 68)', () => {
  async function votingDuel() {
    const res = await createDuel(
      alice.accessToken,
      duelBody({ submissionDeadline: iso(-1_000), votingDeadline: iso(60_000) }),
    );
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  test('rejects before the window opens and after it closes', async () => {
    const early = await createDuel(alice.accessToken, duelBody()); // still 'open'
    const earlyVote = await voteOn(alice.accessToken, early.body.data.id, 'A');
    expect(earlyVote.status).toBe(409);
    expect(earlyVote.body.error.code).toBe('DUEL_VOTING_NOT_OPEN');

    const closed = await createDuel(
      alice.accessToken,
      duelBody({ submissionDeadline: iso(-5_000), votingDeadline: iso(-1_000) }),
    );
    expect(closed.body.data.status).toBe('closed');
    const closedVote = await voteOn(alice.accessToken, closed.body.data.id, 'A');
    expect(closedVote.status).toBe(409);
    expect(closedVote.body.error.code).toBe('DUEL_CLOSED');
  });

  test('votes once; duplicate rolls the $inc back so counts stay exact', async () => {
    const id = await votingDuel();

    const first = await voteOn(alice.accessToken, id, 'A');
    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({
      myVote: 'A',
      status: 'voting',
      votes: { poemA: 1, poemB: 0 },
    });

    const dup = await voteOn(alice.accessToken, id, 'B');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_VOTE');

    const detail = await getDuel(id);
    expect(detail.body.data.votes).toEqual({ poemA: 1, poemB: 0 });
  });

  test('race: two different voters in parallel both land, counts exact', async () => {
    const id = await votingDuel();
    const [a, b] = await Promise.all([
      voteOn(alice.accessToken, id, 'A'),
      voteOn(bob.accessToken, id, 'B'),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);

    const detail = await getDuel(id);
    expect(detail.body.data.votes).toEqual({ poemA: 1, poemB: 1 });
  });

  test('race: same voter twice in parallel yields exactly one vote', async () => {
    const id = await votingDuel();
    const [r1, r2] = await Promise.all([
      voteOn(alice.accessToken, id, 'A'),
      voteOn(alice.accessToken, id, 'B'),
    ]);
    expect([r1.status, r2.status].sort((x, y) => x - y)).toEqual([201, 409]);

    const detail = await getDuel(id);
    expect(detail.body.data.votes.poemA + detail.body.data.votes.poemB).toBe(1);
    expect(detail.body.data.myVote).toBeNull(); // anonymous read
  });

  test('validates body and auth', async () => {
    const id = await votingDuel();
    const unauth = await request(app)
      .post(`/api/v1/duels/${id}/vote`)
      .send({ votedFor: 'A' });
    expect(unauth.status).toBe(401);

    const bad = await voteOn(alice.accessToken, id, 'C');
    expect(bad.status).toBe(400);

    const unknown = await voteOn(alice.accessToken, 'c'.repeat(24), 'A');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('DUEL_NOT_FOUND');
  });
});
