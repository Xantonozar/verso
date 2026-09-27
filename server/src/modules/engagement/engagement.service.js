'use strict';

const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { assertOwnerOrModerator, isModerator } = require('../../middleware/authz');
const { logger } = require('../../config/logger');
const { User } = require('../users/user.model');
const poemService = require('../poems/poem.service');
const poemRepo = require('../poems/poem.repository');
const diaryService = require('../diary/diary.service');
const engagementRepo = require('./engagement.repository');

/**
 * Engagement service (plan steps 45–49):
 * - reactions: unique per (target, user, type) → clean 409 ALREADY_REACTED;
 *   DELETE is idempotent (toggle back is always safe).
 * - Felt Good: unique per (poem, user) → 409 on repeat POST, PATCH updates;
 *   score 0–100 re-validated here even though zod already range-checks.
 * - saves: idempotent toggle — counts only move on a real state change.
 * - comments: 2-level threads, soft-delete, target must be viewable
 *   (commenting on a removed poem is a fail-closed 404).
 * Every poem.stats movement goes through poemRepo.incStats ($inc-only, step 46).
 */

const AUTHOR_FIELDS = 'username displayName profilePhotoUrl';

const poemNotFound = () =>
  new NotFoundError('Poem not found', { code: 'POEM_NOT_FOUND' });

/** Viewable-target gate shared by every write. Removed → 404, never 403. */
async function loadPoemTarget(poemId, requester) {
  const poem = await poemRepo.findById(poemId, {
    select: 'authorId status visibility stats',
  });
  if (!poem || poem.status === 'removed') throw poemNotFound();
  if (!(await poemService.canView(poem, requester))) throw poemNotFound();
  return poem;
}

/** Any engagement target (plan step 50): poems + diary, fail-closed 404s. */
async function loadTarget(targetType, targetId, requester) {
  if (targetType === 'poem') return loadPoemTarget(targetId, requester);
  if (targetType === 'diary') return diaryService.loadTarget(targetId, requester);
  // collabSegment resolver lands with Phase 8
  throw new NotFoundError('Comment target not found', { code: 'TARGET_NOT_FOUND' });
}

/**
 * Stats dispatch — the ONLY counters that move for engagement writes. Every
 * implementation is $inc-only (plan step 46 rule; diary mirrors it).
 */
async function incStats(targetType, id, delta) {
  if (targetType === 'poem') return poemRepo.incStats(id, delta);
  if (targetType === 'diary') return diaryService.incStats(id, delta);
  return null;
}

function assertScore(score) {
  if (!Number.isInteger(score) || score < 0 || score > 100) {
    throw new ValidationError('Validation failed', {
      code: 'VALIDATION_ERROR',
      details: [
        { field: 'score', message: 'must be an integer between 0 and 100', code: 'custom' },
      ],
    });
  }
}

function serializeReaction(doc) {
  return {
    id: String(doc._id),
    targetType: doc.targetType,
    targetId: String(doc.targetId),
    type: doc.type,
    anonymous: Boolean(doc.anonymous),
    createdAt: doc.createdAt,
  };
}

function serializeRating(doc) {
  return {
    id: String(doc._id),
    poemId: String(doc.poemId),
    score: doc.score,
    comment: doc.comment || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function serializeAuthor(user) {
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

/**
 * Comment serialization — anonymous authors hide their id/name from everyone
 * except themselves and moderators (mirrors the poem rule; asserted by
 * tests/anonymous/anonymity.test.js).
 */
function serializeComment(doc, { author = null, requester = null } = {}) {
  const isSelf = requester?.id != null && String(doc.authorId) === String(requester.id);
  const hideIdentity = Boolean(doc.anonymous) && !isSelf && !isModerator(requester);

  const out = {
    id: String(doc._id),
    targetType: doc.targetType,
    targetId: String(doc.targetId),
    parentCommentId: doc.parentCommentId ? String(doc.parentCommentId) : null,
    anonymous: Boolean(doc.anonymous),
    content: doc.content,
    createdAt: doc.createdAt,
  };
  if (!hideIdentity) {
    out.authorId = String(doc.authorId);
    if (author) out.author = serializeAuthor(author);
  } else {
    out.author = null;
  }
  return out;
}

// --- reactions ---

async function addReaction(targetType, targetId, user, body) {
  const target = await loadTarget(targetType, targetId, user);
  const query = { targetType, targetId: target._id, userId: user.id, type: body.type };

  if (await engagementRepo.findReaction(query)) {
    throw new ConflictError('You already reacted with this type', { code: 'ALREADY_REACTED' });
  }

  let doc;
  try {
    doc = await engagementRepo.createReaction({
      ...query,
      anonymous: body.anonymous ?? false,
    });
  } catch (err) {
    // unique-index race (plan step 47): duplicate → clean 409, not E11000
    if (err?.code === 11000) {
      throw new ConflictError('You already reacted with this type', { code: 'ALREADY_REACTED' });
    }
    throw err;
  }

  const stats = await incStats(targetType, target._id, { reactionCount: 1 });
  logger.info({ targetType, targetId: String(target._id), userId: user.id, type: body.type }, 'reaction added');
  return { reaction: serializeReaction(doc), stats };
}

async function removeReaction(targetType, targetId, user, type) {
  const target = await loadTarget(targetType, targetId, user);
  const res = await engagementRepo.deleteReaction({
    targetType,
    targetId: target._id,
    userId: user.id,
    type,
  });

  let stats = target.stats;
  if (res.deletedCount === 1) {
    stats = await incStats(targetType, target._id, { reactionCount: -1 });
    logger.info({ targetType, targetId: String(target._id), userId: user.id, type }, 'reaction removed');
  }
  // idempotent: removing an absent reaction succeeds and never double-decrements
  return { removed: res.deletedCount === 1, type, stats };
}

// --- felt good ---

async function ratePoem(poemId, user, body) {
  const poem = await loadPoemTarget(poemId, user);
  assertScore(body.score);

  if (await engagementRepo.findRating(poem._id, user.id)) {
    throw new ConflictError('You have already rated this poem', { code: 'ALREADY_RATED' });
  }

  let doc;
  try {
    doc = await engagementRepo.createRating({
      poemId: poem._id,
      userId: user.id,
      score: body.score,
      comment: body.comment ?? '',
    });
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError('You have already rated this poem', { code: 'ALREADY_RATED' });
    }
    throw err;
  }

  logger.info({ poemId: String(poem._id), userId: user.id, score: body.score }, 'felt-good rated');
  return serializeRating(doc);
}

async function updateRating(poemId, user, body) {
  const poem = await loadPoemTarget(poemId, user);
  assertScore(body.score);

  const existing = await engagementRepo.findRating(poem._id, user.id);
  if (!existing) {
    throw new NotFoundError('You have not rated this poem yet', {
      code: 'FELT_GOOD_NOT_RATED',
    });
  }

  const updated = await engagementRepo.updateRating(poem._id, user.id, {
    score: body.score,
    comment: body.comment ?? existing.comment ?? '',
  });
  logger.info({ poemId: String(poem._id), userId: user.id, score: body.score }, 'felt-good updated');
  return serializeRating(updated);
}

// --- saves ---

async function savePoem(poemId, user) {
  const poem = await loadPoemTarget(poemId, user);

  if (await engagementRepo.findSave(user.id, poem._id)) {
    // idempotent re-tap: state already saved, counter untouched
    return { saved: true, stats: poem.stats };
  }

  try {
    await engagementRepo.createSave(user.id, poem._id);
  } catch (err) {
    if (err?.code !== 11000) throw err;
    return { saved: true, stats: poem.stats };
  }

  const stats = await poemRepo.incStats(poem._id, { saveCount: 1 });
  logger.info({ poemId: String(poem._id), userId: user.id }, 'poem saved');
  return { saved: true, stats };
}

async function unsavePoem(poemId, user) {
  const poem = await loadPoemTarget(poemId, user);
  const res = await engagementRepo.deleteSave(user.id, poem._id);

  let stats = poem.stats;
  if (res.deletedCount === 1) {
    stats = await poemRepo.incStats(poem._id, { saveCount: -1 });
    logger.info({ poemId: String(poem._id), userId: user.id }, 'poem unsaved');
  }
  return { saved: false, stats };
}

// --- comments ---

async function createComment(user, body) {
  const target = await loadTarget(body.targetType, body.targetId, user);

  if (body.parentCommentId) {
    const parent = await engagementRepo.findCommentById(body.parentCommentId, {
      select: 'targetType targetId parentCommentId status',
    });
    const parentMatches =
      parent &&
      parent.targetType === body.targetType &&
      String(parent.targetId) === String(body.targetId);
    if (!parentMatches || parent.status !== 'active') {
      throw new NotFoundError('Parent comment not found', { code: 'COMMENT_NOT_FOUND' });
    }
    if (parent.parentCommentId) {
      throw new ValidationError('Replies can only be added to top-level comments', {
        code: 'REPLY_DEPTH',
        details: [
          {
            field: 'parentCommentId',
            message: 'replies must target a top-level comment',
            code: 'custom',
          },
        ],
      });
    }
  }

  const doc = await engagementRepo.createComment({
    targetType: body.targetType,
    targetId: target._id,
    authorId: user.id,
    anonymous: body.anonymous ?? false,
    parentCommentId: body.parentCommentId ?? null,
    content: body.content,
  });

  if (body.targetType === 'poem' || body.targetType === 'diary') {
    await incStats(body.targetType, target._id, { commentCount: 1 });
  }
  logger.info({ commentId: String(doc._id), userId: user.id }, 'comment created');
  // requester identity from loadUser is enough to render the new row at once
  const authorLite = user.username
    ? {
        _id: user.id,
        username: user.username,
        displayName: user.displayName,
        profilePhotoUrl: user.profilePhotoUrl || '',
      }
    : null;
  return serializeComment(doc, { author: authorLite, requester: user });
}

/**
 * Threaded list: one page of top-level comments + ONE grouped aggregate for
 * all their replies (§8.4 — no per-comment queries) + ONE user lookup for
 * every author on the page.
 */
async function listComments(requester, { targetType, targetId, cursor, limit = 20 } = {}) {
  await loadTarget(targetType, targetId, requester);

  const rows = await engagementRepo.listTopLevelComments({
    targetType,
    targetId,
    after: cursor,
    limit: limit + 1,
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const repliesMap =
    page.length > 0
      ? await engagementRepo.listRepliesGrouped({
          targetType,
          targetId,
          parentIds: page.map((c) => c._id),
        })
      : new Map();

  const authorIds = new Set();
  for (const c of page) {
    authorIds.add(String(c.authorId));
    const grouped = repliesMap.get(String(c._id));
    for (const r of grouped?.docs ?? []) authorIds.add(String(r.authorId));
  }
  const users = await User.find({ _id: { $in: [...authorIds] } })
    .select(AUTHOR_FIELDS)
    .lean();
  const userMap = new Map(users.map((u) => [String(u._id), u]));

  const items = page.map((c) => {
    const grouped = repliesMap.get(String(c._id)) ?? { count: 0, docs: [] };
    return {
      ...serializeComment(c, {
        author: userMap.get(String(c.authorId)) ?? null,
        requester,
      }),
      replyCount: grouped.count,
      replies: grouped.docs.map((r) =>
        serializeComment(r, {
          author: userMap.get(String(r.authorId)) ?? null,
          requester,
        }),
      ),
    };
  });

  return {
    items,
    nextCursor:
      hasMore && items.length > 0
        ? new Date(items[items.length - 1].createdAt).toISOString()
        : null,
  };
}

async function deleteComment(commentId, user) {
  const comment = await engagementRepo.findCommentById(commentId, {
    select: 'authorId targetType targetId status',
  });
  if (!comment || comment.status !== 'active') {
    throw new NotFoundError('Comment not found', { code: 'COMMENT_NOT_FOUND' });
  }
  assertOwnerOrModerator(comment, user);

  const flipped = await engagementRepo.softDeleteComment(comment._id);
  if (flipped && (comment.targetType === 'poem' || comment.targetType === 'diary')) {
    await incStats(comment.targetType, comment.targetId, { commentCount: -1 });
  }
  logger.info({ commentId, userId: user.id }, 'comment removed (soft)');
  return { id: commentId, deleted: true, status: 'removed' };
}

// --- mobile BFF ---

/**
 * GET /mobile/poems/:id (deferred from Phase 2 by user decision): poem + author
 * (via poemService — one visibility matrix) + per-type reaction counts + Felt
 * Good summary + the requester's own engagement state in a single round-trip.
 */
async function getMobilePoem(poemId, requester) {
  const poem = await poemService.getPoem(poemId, requester);

  const [reactionCounts, feltGood] = await Promise.all([
    engagementRepo.reactionCountsByType({ targetType: 'poem', targetId: poemId }),
    engagementRepo.feltGoodSummary(poemId),
  ]);

  let viewer = null;
  if (requester?.id) {
    const [mine, saved, rating] = await Promise.all([
      engagementRepo.listMyReactionTypes({ targetType: 'poem', targetId: poemId, userId: requester.id }),
      engagementRepo.findSave(requester.id, poemId),
      engagementRepo.findRating(poemId, requester.id),
    ]);
    viewer = {
      reactions: mine,
      saved: Boolean(saved),
      feltGood: rating ? { score: rating.score, comment: rating.comment || '' } : null,
    };
  }

  return { poem, reactionCounts, feltGood, viewer };
}

module.exports = {
  addReaction,
  removeReaction,
  ratePoem,
  updateRating,
  savePoem,
  unsavePoem,
  createComment,
  listComments,
  deleteComment,
  getMobilePoem,
};
