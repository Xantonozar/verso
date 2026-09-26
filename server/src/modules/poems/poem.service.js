'use strict';

const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { assertOwner, assertOwnerOrModerator, isModerator } = require('../../middleware/authz');
const { logger } = require('../../config/logger');
const { User } = require('../users/user.model');
const { Follow } = require('../users/follow.model');
const poemRepo = require('./poem.repository');

/**
 * Poem service (Phase 2 steps 36–41): create/edit/soft-delete/read/versions/
 * autosave. History rule (§3.3): only explicit saves create PoemVersion
 * snapshots — autosave mutates the draft cache in place, never history.
 */

const POEM_FIELDS =
  'title content authorNote language moods tags visibility anonymous isUnsentPoem ' +
  'unsentRecipientLabel audioUrl videoUrl status currentVersionId draftSavedAt ' +
  'stats publishedAt authorId createdAt updatedAt';

const AUTHOR_FIELDS = 'username displayName profilePhotoUrl roles.security';

/** Explicit allow-list — mirrors updatePoemSchema (§7 step 30). */
const UPDATABLE_FIELDS = [
  'title',
  'content',
  'authorNote',
  'language',
  'moods',
  'tags',
  'visibility',
  'anonymous',
];

const notFound = () => new NotFoundError('Poem not found', { code: 'POEM_NOT_FOUND' });

function serializeAuthor(user) {
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

function serialize(poem, author = null) {
  const out = {
    id: String(poem._id),
    authorId: String(poem.authorId),
    title: poem.title,
    content: poem.content,
    authorNote: poem.authorNote || '',
    language: poem.language,
    moods: poem.moods || [],
    tags: poem.tags || [],
    visibility: poem.visibility,
    anonymous: Boolean(poem.anonymous),
    status: poem.status,
    currentVersionId: poem.currentVersionId ? String(poem.currentVersionId) : null,
    draftSavedAt: poem.draftSavedAt || null,
    stats: poem.stats,
    audioUrl: poem.audioUrl || '',
    videoUrl: poem.videoUrl || '',
    publishedAt: poem.publishedAt || null,
    createdAt: poem.createdAt,
    updatedAt: poem.updatedAt,
  };
  if (author) out.author = author;
  return out;
}

async function createPoem(authorId, input) {
  const poem = await poemRepo.createPoem({
    authorId,
    title: input.title,
    content: input.content,
    authorNote: input.authorNote ?? '',
    language: input.language ?? 'en',
    moods: input.moods ?? [],
    tags: input.tags ?? [],
    visibility: input.visibility ?? 'private_draft',
    anonymous: input.anonymous ?? false,
    status: 'draft',
  });

  const version = await poemRepo.createVersion({
    poemId: poem._id,
    title: poem.title,
    content: poem.content,
    versionNumber: 1,
  });
  poem.currentVersionId = version._id;
  await poem.save();

  logger.info({ poemId: String(poem._id), authorId }, 'poem created');
  return serialize(poem);
}

/**
 * Visibility matrix (plan step 39). Fail-closed: any unauthorized view is a
 * 404 so existence is never leaked (§7.1). Authors/moderators always see
 * their own/unmoderated copies (incl. `removed`, for recovery).
 */
async function canView(poem, requester) {
  if (requester?.id != null && String(poem.authorId) === String(requester.id)) return true;
  if (isModerator(requester)) return true;
  if (poem.status !== 'published') return false;

  if (poem.visibility === 'public' || poem.visibility === 'unlisted') return true;
  if (poem.visibility === 'followers') {
    if (!requester?.id) return false;
    return Boolean(
      await Follow.exists({ followerId: requester.id, followingId: poem.authorId }),
    );
  }
  return false; // private_draft
}

async function getPoem(poemId, requester) {
  const poem = await poemRepo.findById(poemId, { select: POEM_FIELDS });
  if (!poem) throw notFound();
  if (!(await canView(poem, requester))) throw notFound();

  const viewerIsAuthor = requester?.id != null && String(poem.authorId) === String(requester.id);
  const hideIdentity = poem.anonymous && !viewerIsAuthor && !isModerator(requester);

  let author = null;
  if (!hideIdentity) {
    const doc = await User.findById(poem.authorId).select(AUTHOR_FIELDS).lean();
    if (doc) author = serializeAuthor(doc);
  }
  const out = serialize(poem, author);
  // Anonymous poems must not leak the real author through `authorId` either —
  // full anonymity hardening is Phase 7, but the id can't slip through now.
  if (hideIdentity) delete out.authorId;
  return out;
}

async function updatePoem(poemId, user, patch) {
  const poem = await poemRepo.findById(poemId, { select: `${POEM_FIELDS}` });
  if (!poem || poem.status === 'removed') throw notFound();
  assertOwnerOrModerator(poem, user);

  const fields = {};
  for (const key of UPDATABLE_FIELDS) {
    if (patch[key] !== undefined) fields[key] = patch[key];
  }

  // Explicit save snapshots title/content into history (step 37); metadata-only
  // edits update the poem without spawning redundant versions.
  const titleChanged = fields.title !== undefined && fields.title !== poem.title;
  const contentChanged = fields.content !== undefined && fields.content !== poem.content;
  if (titleChanged || contentChanged) {
    const version = await poemRepo.createVersion({
      poemId: poem._id,
      title: fields.title ?? poem.title,
      content: fields.content ?? poem.content,
      versionNumber: await poemRepo.nextVersionNumber(poem._id),
    });
    fields.currentVersionId = version._id;
  }

  const updated = await poemRepo.updatePoem(poem._id, fields);
  logger.info({ poemId: String(poem._id), userId: user.id }, 'poem updated');
  return serialize(updated);
}

async function deletePoem(poemId, user) {
  const poem = await poemRepo.findById(poemId, { select: 'authorId status' });
  if (!poem || poem.status === 'removed') throw notFound();
  assertOwnerOrModerator(poem, user);

  await poemRepo.softRemove(poem._id);
  logger.info({ poemId: String(poem._id), userId: user.id }, 'poem removed (soft)');
  return { id: poemId, deleted: true, status: 'removed' };
}

async function listVersions(poemId, user, { cursor, limit = 10 } = {}) {
  const poem = await poemRepo.findById(poemId, { select: 'authorId status' });
  if (!poem || poem.status === 'removed') throw notFound();
  assertOwnerOrModerator(poem, user);

  const before = cursor != null ? Number(cursor) : undefined;
  const rows = await poemRepo.listVersions(poem._id, { limit: limit + 1, before });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((v) => ({
    id: String(v._id),
    title: v.title,
    content: v.content,
    versionNumber: v.versionNumber,
    editedAt: v.editedAt,
  }));

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1].versionNumber) : null,
  };
}

/**
 * Idempotent draft autosave (step 41): identical payload → no write, no
 * version, stable `changed: false`. Owner-only — moderators do not ghost-edit
 * drafts. Non-draft poems are guarded for when publish lands later.
 */
async function autosaveDraft(poemId, user, patch) {
  const poem = await poemRepo.findById(poemId, { select: 'authorId status title content draftSavedAt updatedAt' });
  if (!poem || poem.status === 'removed') throw notFound();
  assertOwner(poem, user);

  if (poem.status !== 'draft') {
    throw new ConflictError('Autosave is only available for drafts', { code: 'NOT_A_DRAFT' });
  }

  const title = patch.title !== undefined ? patch.title : poem.title;
  const content = patch.content !== undefined ? patch.content : poem.content;
  if (title === poem.title && content === poem.content) {
    return {
      id: poemId,
      changed: false,
      title,
      content,
      savedAt: poem.draftSavedAt || poem.updatedAt,
    };
  }

  const savedAt = new Date();
  await poemRepo.updatePoem(poem._id, { title, content, draftSavedAt: savedAt });
  return { id: poemId, changed: true, title, content, savedAt };
}

/**
 * Publish lifecycle (deferred from Phase 2 by user decision, plan step 45 era):
 * mirrors the story rule — clean 409s both directions, never publish empty
 * content, and a `private_draft` visibility would be incoherent once published,
 * so it promotes to `public`. `publishedAt` pins the first publish only.
 */
async function publishPoem(poemId, user) {
  const poem = await poemRepo.findById(poemId, {
    select: 'authorId status title content visibility publishedAt',
  });
  if (!poem || poem.status === 'removed') throw notFound();
  assertOwnerOrModerator(poem, user);

  if (poem.status === 'published') {
    throw new ConflictError('Poem is already published', { code: 'ALREADY_PUBLISHED' });
  }

  const details = [];
  if (!poem.title || !poem.title.trim()) {
    details.push({ field: 'title', message: 'title cannot be empty', code: 'custom' });
  }
  if (!poem.content || !poem.content.trim()) {
    details.push({ field: 'content', message: 'content cannot be empty', code: 'custom' });
  }
  if (details.length > 0) {
    throw new ValidationError('Poem cannot be published', { details });
  }

  const fields = { status: 'published', publishedAt: poem.publishedAt || new Date() };
  if (poem.visibility === 'private_draft') fields.visibility = 'public';

  const updated = await poemRepo.updatePoem(poem._id, fields);
  logger.info({ poemId: String(poem._id), userId: user.id }, 'poem published');
  return serialize(updated);
}

async function unpublishPoem(poemId, user) {
  const poem = await poemRepo.findById(poemId, { select: 'authorId status' });
  if (!poem || poem.status === 'removed') throw notFound();
  assertOwnerOrModerator(poem, user);

  if (poem.status !== 'published') {
    throw new ConflictError('Poem is not published', { code: 'NOT_PUBLISHED' });
  }

  const updated = await poemRepo.updatePoem(poem._id, { status: 'draft' });
  logger.info({ poemId: String(poem._id), userId: user.id }, 'poem unpublished');
  return serialize(updated);
}

module.exports = {
  createPoem,
  getPoem,
  updatePoem,
  deletePoem,
  listVersions,
  autosaveDraft,
  publishPoem,
  unpublishPoem,
  canView, // shared with engagement (Phase 3) — one visibility matrix, no copies
};
