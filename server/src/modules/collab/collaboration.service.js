'use strict';

const mongoose = require('mongoose');
const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { CollaborationPiece } = require('./collaboration-piece.model');
const { CollaborationSegment } = require('./collaboration-segment.model');
const { ReadingPath } = require('./reading-path.model');
const { User } = require('../users/user.model');

/**
 * Open/branching collaboration service (plan steps 64–65).
 *
 * Branch cap (plan step 64, §15): segment creation must check the parent's
 * `childCount` against the piece's cap WITHOUT a read-modify-write race
 * (§8.19). The claim is a single conditional update —
 *   updateOne({ _id: parentId, childCount: { $lt: cap } }, { $inc: { childCount: 1 } })
 * so MongoDB serializes competing writers: exactly one of two simultaneous
 * requests matches, the loser gets 409 (plan step 67 race test).
 *
 * Reading-path legality (plan step 65) is checked against the materialized
 * `ancestorPath` — forward (target descends from current) or backward (target
 * is an ancestor of current) — and updates only ever `$push` (append-only).
 */

const pieceNotFound = () =>
  new NotFoundError('Collaboration not found', { code: 'PIECE_NOT_FOUND' });
const segmentNotFound = () =>
  new NotFoundError('Segment not found', { code: 'SEGMENT_NOT_FOUND' });

const isObjectId = (v) => mongoose.isValidObjectId(v);

function serializeAuthor(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

async function hydrateAuthors(segments) {
  const authorIds = [...new Set(segments.map((s) => String(s.authorId)))];
  if (authorIds.length === 0) return new Map();
  const users = await User.find({ _id: { $in: authorIds } });
  return new Map(users.map((u) => [String(u._id), u]));
}

function serializeSegment(segment, author) {
  return {
    id: String(segment._id ?? segment.id),
    pieceId: String(segment.pieceId),
    parentId: segment.parentId == null ? null : String(segment.parentId),
    ancestorPath: (segment.ancestorPath ?? []).map(String),
    author: author ?? null,
    content: segment.content,
    childCount: segment.childCount ?? 0,
    depth: segment.depth ?? 0,
    createdAt: segment.createdAt,
  };
}

function serializePiece(piece) {
  return {
    id: String(piece._id ?? piece.id),
    creatorId: String(piece.creatorId),
    title: piece.title,
    mode: piece.mode,
    maxBranches: piece.maxBranches,
    status: piece.status,
    rootSegmentId: piece.rootSegmentId ? String(piece.rootSegmentId) : null,
    createdAt: piece.createdAt,
    updatedAt: piece.updatedAt,
  };
}

/** Branch cap for children of a parent in this piece (plan step 64). */
function childCap(piece) {
  return piece.mode === 'single_ending' ? 1 : piece.maxBranches;
}

async function createPiece(user, { title, mode, maxBranches, content }) {
  const piece = await CollaborationPiece.create({
    creatorId: user.id,
    title,
    mode,
    maxBranches: maxBranches ?? 5,
    status: 'open',
  });
  const root = await CollaborationSegment.create({
    pieceId: piece._id,
    parentId: null,
    ancestorPath: [],
    authorId: user.id,
    content,
    childCount: 0,
    depth: 0,
  });
  piece.rootSegmentId = root._id;
  await piece.save();
  return serializePiece(piece);
}

async function listPieces(query = {}) {
  const limit = query.limit ?? 20;
  const filter = {};
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const docs = await CollaborationPiece.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];
  return {
    items: page.map(serializePiece),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
  };
}

async function loadPiece(pieceId) {
  if (!isObjectId(pieceId)) throw pieceNotFound();
  const piece = await CollaborationPiece.findById(pieceId);
  if (!piece) throw pieceNotFound();
  return piece;
}

async function getPiece(pieceId) {
  const piece = await loadPiece(pieceId);
  const root = await CollaborationSegment.findById(piece.rootSegmentId);
  const authors = await hydrateAuthors(root ? [root] : []);
  return {
    piece: serializePiece(piece),
    rootSegment: root ? serializeSegment(root, serializeAuthor(authors.get(String(root.authorId)))) : null,
  };
}

/**
 * Create a child segment under `parentId` (plan step 64). Order of safety:
 * 1. load parent (404 if missing / wrong piece) — cheap pre-check
 * 2. atomic conditional $inc against the cap — race winner = matchedCount 1
 * 3. create the segment; if creation throws, release the claimed slot
 */
async function createSegment(pieceId, user, { parentId, content }) {
  const piece = await loadPiece(pieceId);

  if (!isObjectId(parentId)) throw segmentNotFound();
  const parent = await CollaborationSegment.findOne({ _id: parentId, pieceId: piece._id });
  if (!parent) throw segmentNotFound();

  const cap = childCap(piece);
  const claim = await CollaborationSegment.updateOne(
    { _id: parent._id, childCount: { $lt: cap } },
    { $inc: { childCount: 1 } },
  );
  if (claim.matchedCount === 0) {
    throw new ConflictError('Branch cap reached for this segment', {
      code: 'BRANCH_CAP_REACHED',
      details: { cap },
    });
  }

  let segment;
  try {
    segment = await CollaborationSegment.create({
      pieceId: piece._id,
      parentId: parent._id,
      ancestorPath: [...(parent.ancestorPath ?? []), parent._id],
      authorId: user.id,
      content,
      childCount: 0,
      depth: (parent.depth ?? 0) + 1,
    });
  } catch (err) {
    // Creation failed after the slot was claimed — give it back.
    await CollaborationSegment.updateOne({ _id: parent._id }, { $inc: { childCount: -1 } });
    throw err;
  }

  const authors = await hydrateAuthors([segment]);
  return serializeSegment(segment, serializeAuthor(authors.get(String(segment.authorId))));
}

/** One segment with its author (breadcrumb resume on the reader screen). */
async function getSegment(pieceId, segmentId) {
  const piece = await loadPiece(pieceId);
  if (!isObjectId(segmentId)) throw segmentNotFound();
  const segment = await CollaborationSegment.findOne({ _id: segmentId, pieceId: piece._id });
  if (!segment) throw segmentNotFound();
  const authors = await hydrateAuthors([segment]);
  return serializeSegment(segment, serializeAuthor(authors.get(String(segment.authorId))));
}

/** Branch picker payload: children of a segment (plan step 65). */
async function listChildren(pieceId, segmentId) {
  const piece = await loadPiece(pieceId);
  if (!isObjectId(segmentId)) throw segmentNotFound();
  const parent = await CollaborationSegment.findOne({ _id: segmentId, pieceId: piece._id });
  if (!parent) throw segmentNotFound();

  const children = await CollaborationSegment.find({
    pieceId: piece._id,
    parentId: parent._id,
  }).sort({ createdAt: 1 });
  const authors = await hydrateAuthors(children);
  return {
    parentId: String(parent._id),
    childCount: parent.childCount,
    cap: childCap(piece),
    items: children.map((c) => serializeSegment(c, serializeAuthor(authors.get(String(c.authorId))))),
  };
}

/**
 * Append-only reading-path upsert (plan step 65). A move is legal when the
 * target is the root (first step), descends from the current segment, or is
 * an ancestor of it (step back) — both checked through `ancestorPath`.
 * `visitedSegmentIds` only ever grows; re-issuing the current segment is a
 * no-op (idempotent).
 */
async function recordReadingPath(pieceId, user, { segmentId }) {
  const piece = await loadPiece(pieceId);
  if (!isObjectId(segmentId)) throw segmentNotFound();
  const target = await CollaborationSegment.findOne({ _id: segmentId, pieceId: piece._id });
  if (!target) throw segmentNotFound();

  const path = await ReadingPath.findOne({ userId: user.id, pieceId: piece._id });

  if (!path || path.currentSegmentId == null) {
    // First step must be the root.
    if (target.parentId != null) {
      throw new ValidationError('Reading path must start at the root segment', {
        code: 'PATH_MUST_START_AT_ROOT',
        details: [{ field: 'segmentId', message: 'must be the root segment', code: 'custom' }],
      });
    }
  } else {
    const currentId = path.currentSegmentId;
    if (String(target._id) === String(currentId)) {
      return serializeReadingPath(path); // already here — idempotent
    }
    // forward: current is an ancestor of target  |  backward: target is an ancestor of current
    const [forward, backward] = await Promise.all([
      CollaborationSegment.exists({ _id: target._id, ancestorPath: currentId }),
      CollaborationSegment.exists({ _id: currentId, ancestorPath: target._id }),
    ]);
    if (!forward && !backward) {
      throw new ValidationError('Segment is not on a connected reading path', {
        code: 'PATH_NOT_CONNECTED',
        details: [{ field: 'segmentId', message: 'walk edge by edge from your current position', code: 'custom' }],
      });
    }
  }

  const updated = await ReadingPath.findOneAndUpdate(
    { userId: user.id, pieceId: piece._id },
    {
      $set: { currentSegmentId: target._id },
      $push: { visitedSegmentIds: target._id },
      $setOnInsert: { userId: user.id, pieceId: piece._id },
    },
    { upsert: true, returnDocument: 'after' },
  );
  return serializeReadingPath(updated);
}

async function getReadingPath(pieceId, user) {
  const piece = await loadPiece(pieceId);
  const path = await ReadingPath.findOne({ userId: user.id, pieceId: piece._id });
  return path ? serializeReadingPath(path) : null;
}

function serializeReadingPath(path) {
  return {
    pieceId: String(path.pieceId),
    visitedSegmentIds: (path.visitedSegmentIds ?? []).map(String),
    currentSegmentId: path.currentSegmentId ? String(path.currentSegmentId) : null,
    updatedAt: path.updatedAt,
  };
}

module.exports = {
  createPiece,
  listPieces,
  getPiece,
  getSegment,
  createSegment,
  listChildren,
  recordReadingPath,
  getReadingPath,
  serializeSegment,
  serializePiece,
  childCap,
};
