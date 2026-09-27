'use strict';

const mongoose = require('mongoose');
const { User } = require('../../src/modules/users/user.model');
const { CollaborationPiece } = require('../../src/modules/collab/collaboration-piece.model');
const { CollaborationSegment } = require('../../src/modules/collab/collaboration-segment.model');
const { ReadingPath } = require('../../src/modules/collab/reading-path.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 8 gate: `explain()` on the ancestorPath/children queries must win an
 * IXSCAN — never a COLLSCAN (plan §4 index list, §10.1). Seeds keep the
 * equality prefixes selective so the planner prefers the index (same
 * economics as tests/discover/explain.test.js).
 */

let mongod;
let authorId;
let pieceId;

async function planOf(query) {
  const explain = await query.explain('executionStats');
  const json = JSON.stringify(explain);
  return { json, hasIxScan: json.includes('IXSCAN'), hasCollScan: json.includes('COLLSCAN') };
}

beforeAll(async () => {
  mongod = await startTestDb([User, CollaborationPiece, CollaborationSegment, ReadingPath]);
  const user = await User.create({
    username: 'explainer',
    displayName: 'Explainer',
    email: 'explainer@example.com',
    passwordHash: 'x',
  });
  authorId = user._id;

  const piece = await CollaborationPiece.create({
    creatorId: authorId,
    title: 'Explain piece',
    mode: 'multi_ending',
    maxBranches: 5,
    status: 'open',
  });
  pieceId = piece._id;

  // 90 segments: one root + 9 parents × 9 children each, so both query
  // shapes have selective equality prefixes over a non-trivial corpus.
  const root = await CollaborationSegment.create({
    pieceId,
    parentId: null,
    ancestorPath: [],
    authorId,
    content: 'root',
    childCount: 9,
    depth: 0,
  });
  const parents = [];
  for (let i = 0; i < 9; i++) {
    parents.push(
      await CollaborationSegment.create({
        pieceId,
        parentId: root._id,
        ancestorPath: [root._id],
        authorId,
        content: `parent ${i}`,
        childCount: 9,
        depth: 1,
      }),
    );
  }
  for (const parent of parents) {
    for (let i = 0; i < 9; i++) {
      await CollaborationSegment.create({
        pieceId,
        parentId: parent._id,
        ancestorPath: [root._id, parent._id],
        authorId,
        content: `child ${i} of ${parent.id}`,
        childCount: 0,
        depth: 2,
      });
    }
  }
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('explain() — segment hot paths (Phase 8 gate)', () => {
  test('children query wins IXSCAN on { pieceId, parentId }', async () => {
    const root = await CollaborationSegment.findOne({ pieceId, parentId: null });
    const { hasIxScan, hasCollScan, json } = await planOf(
      CollaborationSegment.find({ pieceId, parentId: root._id }).sort({ createdAt: 1 }),
    );
    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('pieceId_1_parentId_1');
  });

  test('ancestorPath subtree query wins IXSCAN on { ancestorPath }', async () => {
    const parent = await CollaborationSegment.findOne({ pieceId, depth: 1 });
    const { hasIxScan, hasCollScan, json } = await planOf(
      CollaborationSegment.find({ ancestorPath: parent._id }),
    );
    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('ancestorPath_1');
  });

  test('reading-path lookup wins IXSCAN on { userId, pieceId }', async () => {
    // one path per piece (unique userId+pieceId): same reader across 40 pieces
    await ReadingPath.insertMany(
      Array.from({ length: 40 }, () => ({
        userId: authorId,
        pieceId: new mongoose.Types.ObjectId(),
        visitedSegmentIds: [],
        currentSegmentId: null,
      })),
    );
    await ReadingPath.create({ userId: authorId, pieceId, visitedSegmentIds: [], currentSegmentId: null });

    const { hasIxScan, hasCollScan, json } = await planOf(
      ReadingPath.find({ userId: authorId, pieceId }),
    );
    expect(hasIxScan).toBe(true);
    expect(hasCollScan).toBe(false);
    expect(json).toContain('userId_1_pieceId_1');
  });
});
