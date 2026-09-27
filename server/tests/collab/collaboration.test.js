'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { CollaborationPiece } = require('../../src/modules/collab/collaboration-piece.model');
const { CollaborationSegment } = require('../../src/modules/collab/collaboration-segment.model');
const { ReadingPath } = require('../../src/modules/collab/reading-path.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Plan steps 64–65 + the step 67 race gate: materialized-path segment
 * creation, atomic childCount cap (§8.19 — conditional $inc, never
 * read-modify-write), branch-picker children endpoint, append-only
 * ReadingPath tracking.
 */

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `s${Date.now().toString(36)}${(seq++).toString(36)}`;

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

function createPiece(token, body) {
  return request(app)
    .post('/api/v1/collaborations')
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function addSegment(token, pieceId, body) {
  return request(app)
    .post(`/api/v1/collaborations/${pieceId}/segments`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function postPath(token, pieceId, segmentId) {
  return request(app)
    .post(`/api/v1/collaborations/${pieceId}/reading-path`)
    .set('Authorization', `Bearer ${token}`)
    .send({ segmentId });
}

async function makePiece(token, overrides = {}) {
  const res = await createPiece(token, {
    title: 'Branching tale',
    mode: 'single_ending',
    content: 'root verse\nsecond line',
    ...overrides,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, CollaborationPiece, CollaborationSegment, ReadingPath]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

beforeEach(async () => {
  await Promise.all([
    CollaborationPiece.deleteMany({}),
    CollaborationSegment.deleteMany({}),
    ReadingPath.deleteMany({}),
  ]);
});

describe('piece + root segment creation (plan step 64)', () => {
  test('creates piece with root segment (depth 0, empty path) and reads back', async () => {
    const me = await register();
    const unauth = await request(app)
      .post('/api/v1/collaborations')
      .send({ title: 'X', mode: 'single_ending', content: 'x' });
    expect(unauth.status).toBe(401);

    const piece = await makePiece(me.accessToken, { mode: 'multi_ending', maxBranches: 3 });
    expect(piece.mode).toBe('multi_ending');
    expect(piece.maxBranches).toBe(3);
    expect(piece.rootSegmentId).toEqual(expect.any(String));

    const detail = await request(app)
      .get(`/api/v1/collaborations/${piece.id}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.piece.id).toBe(piece.id);
    expect(detail.body.data.rootSegment).toMatchObject({
      parentId: null,
      depth: 0,
      childCount: 0,
      content: 'root verse\nsecond line',
    });
    expect(detail.body.data.rootSegment.ancestorPath).toEqual([]);
    expect(detail.body.data.rootSegment.author.username).toBe(me.user.username);
  });

  test('segment inherits materialized path and bumps parent childCount', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken);

    const res = await addSegment(me.accessToken, piece.id, {
      parentId: piece.rootSegmentId,
      content: 'branch one\nmore',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ depth: 1, childCount: 0 });
    expect(res.body.data.parentId).toBe(piece.rootSegmentId);
    expect(res.body.data.ancestorPath).toEqual([piece.rootSegmentId]);

    const root = await CollaborationSegment.findById(piece.rootSegmentId);
    expect(root.childCount).toBe(1);

    // deeper chain: ancestorPath grows, depth increments
    const deeper = await addSegment(me.accessToken, piece.id, {
      parentId: res.body.data.id,
      content: 'branch one continues\nline',
    });
    expect(deeper.status).toBe(201);
    expect(deeper.body.data.depth).toBe(2);
    expect(deeper.body.data.ancestorPath).toEqual([piece.rootSegmentId, res.body.data.id]);
  });

  test('single segment GET hydrates author (breadcrumb resume) and 404s cleanly', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken);

    const res = await request(app)
      .get(`/api/v1/collaborations/${piece.id}/segments/${piece.rootSegmentId}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: piece.rootSegmentId, depth: 0, parentId: null });
    expect(res.body.data.author.username).toBe(me.user.username);

    const ghost = await request(app)
      .get(`/api/v1/collaborations/${piece.id}/segments/${'d'.repeat(24)}`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(ghost.status).toBe(404);
    expect(ghost.body.error.code).toBe('SEGMENT_NOT_FOUND');
  });

  test('parent from another piece or missing → 404; no auth → 401', async () => {
    const me = await register();
    const pieceA = await makePiece(me.accessToken);
    const pieceB = await makePiece(me.accessToken, { title: 'Other' });

    const wrongPiece = await addSegment(me.accessToken, pieceA.id, {
      parentId: pieceB.rootSegmentId,
      content: 'sneaky\nline',
    });
    expect(wrongPiece.status).toBe(404);
    expect(wrongPiece.body.error.code).toBe('SEGMENT_NOT_FOUND');

    const missing = await addSegment(me.accessToken, pieceA.id, {
      parentId: 'b'.repeat(24),
      content: 'ghost\nline',
    });
    expect(missing.status).toBe(404);

    const unauth = await request(app)
      .post(`/api/v1/collaborations/${pieceA.id}/segments`)
      .send({ parentId: pieceA.rootSegmentId, content: 'x\ny' });
    expect(unauth.status).toBe(401);
  });
});

describe('branch cap, single_ending (plan step 64: exactly one child)', () => {
  test('second child of the same parent is rejected with 409, counter intact', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken, { mode: 'single_ending' });

    const first = await addSegment(me.accessToken, piece.id, {
      parentId: piece.rootSegmentId,
      content: 'only child\nline',
    });
    expect(first.status).toBe(201);

    const second = await addSegment(me.accessToken, piece.id, {
      parentId: piece.rootSegmentId,
      content: 'rival child\nline',
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe('BRANCH_CAP_REACHED');

    const root = await CollaborationSegment.findById(piece.rootSegmentId);
    expect(root.childCount).toBe(1);
    expect(await CollaborationSegment.countDocuments({ pieceId: piece.id })).toBe(2);
  });
});

describe('branch cap, multi_ending (plan step 64: configured max)', () => {
  test('allows maxBranches children, then 409 on the next', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken, { mode: 'multi_ending', maxBranches: 2 });

    for (let i = 0; i < 2; i++) {
      const res = await addSegment(me.accessToken, piece.id, {
        parentId: piece.rootSegmentId,
        content: `variant ${i}\nline`,
      });
      expect(res.status).toBe(201);
    }

    const overflow = await addSegment(me.accessToken, piece.id, {
      parentId: piece.rootSegmentId,
      content: 'too many\nline',
    });
    expect(overflow.status).toBe(409);
    expect(overflow.body.error.details.cap).toBe(2);

    const root = await CollaborationSegment.findById(piece.rootSegmentId);
    expect(root.childCount).toBe(2);
    expect(await CollaborationSegment.countDocuments({ pieceId: piece.id })).toBe(3);
  });
});

describe('race gate (plan step 67): two simultaneous creates at the cap', () => {
  test('single_ending from an empty parent: exactly one succeeds', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken, { mode: 'single_ending' });

    const [a, b] = await Promise.all([
      addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'racer A\nline' }),
      addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'racer B\nline' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const root = await CollaborationSegment.findById(piece.rootSegmentId);
    expect(root.childCount).toBe(1);
    expect(await CollaborationSegment.countDocuments({ pieceId: piece.id })).toBe(2);
  });

  test('multi_ending at cap-1: exactly one of the pair wins the last slot', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken, { mode: 'multi_ending', maxBranches: 3 });

    // fill two of three slots sequentially
    for (let i = 0; i < 2; i++) {
      const res = await addSegment(me.accessToken, piece.id, {
        parentId: piece.rootSegmentId,
        content: `filler ${i}\nline`,
      });
      expect(res.status).toBe(201);
    }

    const [a, b] = await Promise.all([
      addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'final slot one\nx' }),
      addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'final slot two\nx' }),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);

    const root = await CollaborationSegment.findById(piece.rootSegmentId);
    expect(root.childCount).toBe(3);
    expect(await CollaborationSegment.countDocuments({ pieceId: piece.id })).toBe(4);
  });
});

describe('segment-children endpoint (plan step 65: branch picker)', () => {
  test('lists siblings in creation order with cap metadata', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken, { mode: 'multi_ending', maxBranches: 4 });
    await addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'first fork\nx' });
    await addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'second fork\nx' });

    const res = await request(app)
      .get(`/api/v1/collaborations/${piece.id}/segments/${piece.rootSegmentId}/children`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ parentId: piece.rootSegmentId, childCount: 2, cap: 4 });
    expect(res.body.data.items.map((c) => c.content)).toEqual(['first fork\nx', 'second fork\nx']);
    expect(res.body.data.items[0].author.username).toBe(me.user.username);

    const ghost = await request(app)
      .get(`/api/v1/collaborations/${piece.id}/segments/${'c'.repeat(24)}/children`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(ghost.status).toBe(404);
  });
});

describe('ReadingPath tracking (plan step 65: append-only)', () => {
  test('must start at root, walks forward/backward, appends only, idempotent at current', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken);
    const child = (
      await addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'branch\nx' })
    ).body.data;

    const badStart = await postPath(me.accessToken, piece.id, child.id);
    expect(badStart.status).toBe(400);
    expect(badStart.body.error.code).toBe('PATH_MUST_START_AT_ROOT');

    const atRoot = await postPath(me.accessToken, piece.id, piece.rootSegmentId);
    expect(atRoot.status).toBe(200);
    expect(atRoot.body.data.visitedSegmentIds).toEqual([piece.rootSegmentId]);
    expect(atRoot.body.data.currentSegmentId).toBe(piece.rootSegmentId);

    const forward = await postPath(me.accessToken, piece.id, child.id);
    expect(forward.body.data.visitedSegmentIds).toEqual([piece.rootSegmentId, child.id]);

    // idempotent: re-posting the current segment does not grow the path
    const again = await postPath(me.accessToken, piece.id, child.id);
    expect(again.body.data.visitedSegmentIds).toHaveLength(2);
    expect(again.body.data.currentSegmentId).toBe(child.id);

    const back = await postPath(me.accessToken, piece.id, piece.rootSegmentId);
    expect(back.body.data.visitedSegmentIds).toEqual([piece.rootSegmentId, child.id, piece.rootSegmentId]);
    expect(back.body.data.currentSegmentId).toBe(piece.rootSegmentId);

    const get = await request(app)
      .get(`/api/v1/collaborations/${piece.id}/reading-path`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(get.status).toBe(200);
    expect(get.body.data.visitedSegmentIds).toHaveLength(3);
  });

  test('sibling jump (disconnected) is rejected', async () => {
    const me = await register();
    const piece = await makePiece(me.accessToken, { mode: 'multi_ending' });
    const a = (
      await addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'A\nx' })
    ).body.data;
    const b = (
      await addSegment(me.accessToken, piece.id, { parentId: piece.rootSegmentId, content: 'B\nx' })
    ).body.data;

    await postPath(me.accessToken, piece.id, piece.rootSegmentId);
    await postPath(me.accessToken, piece.id, a.id); // now at A

    const jump = await postPath(me.accessToken, piece.id, b.id); // A → B skips the root
    expect(jump.status).toBe(400);
    expect(jump.body.error.code).toBe('PATH_NOT_CONNECTED');
  });

  test('segment from another piece → 404; fresh reader sees null path', async () => {
    const me = await register();
    const pieceA = await makePiece(me.accessToken);
    const pieceB = await makePiece(me.accessToken, { title: 'Other' });

    const get = await request(app)
      .get(`/api/v1/collaborations/${pieceB.id}/reading-path`)
      .set('Authorization', `Bearer ${me.accessToken}`);
    expect(get.status).toBe(200);
    expect(get.body.data).toBeNull();

    const wrong = await postPath(me.accessToken, pieceB.id, pieceA.rootSegmentId);
    expect(wrong.status).toBe(404);
  });
});
