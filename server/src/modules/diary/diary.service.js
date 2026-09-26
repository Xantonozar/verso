'use strict';

const { NotFoundError } = require('../../errors');
const { isModerator } = require('../../middleware/authz');
const { logger } = require('../../config/logger');
const { User } = require('../users/user.model');
const { Follow } = require('../users/follow.model');
const diaryRepo = require('./diary.repository');

/**
 * Diary service (plan step 50): create + read with the same visibility matrix
 * poems use (owner/moderator always, public everyone, followers needs an edge).
 * There is no felt-good/save wiring here on purpose — diary is
 * reactions/comments only, and the routes simply do not exist (plan step 50).
 */

const AUTHOR_FIELDS = 'username displayName profilePhotoUrl';

const notFound = () =>
  new NotFoundError('Diary entry not found', { code: 'TARGET_NOT_FOUND' });

async function canView(entry, requester) {
  if (requester?.id != null && String(entry.authorId) === String(requester.id)) return true;
  if (isModerator(requester)) return true;
  if (entry.visibility === 'public') return true;
  if (entry.visibility === 'followers') {
    if (!requester?.id) return false;
    return Boolean(
      await Follow.exists({ followerId: requester.id, followingId: entry.authorId }),
    );
  }
  return false;
}

/**
 * Viewable-target gate for every engagement write/read against a diary id —
 * missing OR not-viewable fails closed as 404 TARGET_NOT_FOUND (existence is
 * never leaked as 403).
 */
async function loadTarget(id, requester) {
  const entry = await diaryRepo.findById(id, {
    // content/timestamps included so the same gate result can serialize the
    // full entry for GET; engagement writes only use the view fields
    select: 'content authorId visibility anonymous stats createdAt updatedAt',
  });
  if (!entry) throw notFound();
  if (!(await canView(entry, requester))) throw notFound();
  return entry;
}

function serializeAuthor(user) {
  return {
    id: String(user._id ?? user.id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

/**
 * Anonymous entries hide their author id/name from everyone except the owner
 * and moderators (mirrors the poem rule; full anonymity hardening is Phase 7).
 */
function serialize(entry, author = null, requester = null) {
  const viewerIsAuthor = requester?.id != null && String(entry.authorId) === String(requester.id);
  const hideIdentity = Boolean(entry.anonymous) && !viewerIsAuthor && !isModerator(requester);

  const out = {
    id: String(entry._id),
    content: entry.content,
    visibility: entry.visibility,
    anonymous: Boolean(entry.anonymous),
    stats: entry.stats ?? { reactionCount: 0, commentCount: 0 },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  if (!hideIdentity) {
    out.authorId = String(entry.authorId);
    if (author) out.author = author;
  }
  return out;
}

async function createDiary(user, body) {
  const entry = await diaryRepo.create({
    authorId: user.id,
    content: body.content,
    visibility: body.visibility ?? 'public',
    anonymous: body.anonymous ?? false,
  });
  logger.info({ diaryId: String(entry._id), userId: user.id }, 'diary entry created');
  const author = user.username
    ? serializeAuthor({
        _id: user.id,
        username: user.username,
        displayName: user.displayName,
        profilePhotoUrl: user.profilePhotoUrl || '',
      })
    : null;
  return serialize(entry, author, user);
}

async function getDiary(id, requester) {
  const entry = await loadTarget(id, requester);
  let author = null;
  const viewerIsAuthor = requester?.id != null && String(entry.authorId) === String(requester.id);
  const hideIdentity = Boolean(entry.anonymous) && !viewerIsAuthor && !isModerator(requester);
  if (!hideIdentity) {
    const doc = await User.findById(entry.authorId).select(AUTHOR_FIELDS).lean();
    if (doc) author = serializeAuthor(doc);
  }
  return serialize(entry, author, requester);
}

/** Stats dispatch target for the engagement module ($inc-only, see repository). */
async function incStats(id, delta) {
  return diaryRepo.incStats(id, delta);
}

module.exports = {
  canView,
  loadTarget,
  createDiary,
  getDiary,
  incStats,
  serialize,
};
