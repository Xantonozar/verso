'use strict';

const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { assertOwner, assertOwnerOrModerator, isModerator } = require('../../middleware/authz');
const { logger } = require('../../config/logger');
const { authorScope } = require('../../queries/content-scope');
const { User } = require('../users/user.model');
const storyRepo = require('./story.repository');

/**
 * Story service (plan 35B–38B): metadata CRUD, chapters, reorder, publish,
 * autosave, versions. History rule (38B): only explicit save/publish creates
 * StoryVersion snapshots — autosave mutates the draft cache in place.
 */

const STORY_FIELDS =
  'title coverUrl synopsis language tags status chapterCount currentVersionId ' +
  'draftSavedAt stats publishedAt authorId createdAt updatedAt';

const AUTHOR_FIELDS = 'username displayName profilePhotoUrl roles.security';

/** Explicit allow-list — mirrors updateStorySchema (§7 step 30). */
const UPDATABLE_FIELDS = ['title', 'coverUrl', 'synopsis', 'language', 'tags'];

/** Fields that participate in change detection + metadata version snapshots. */
const SNAPSHOT_FIELDS = ['title', 'coverUrl', 'synopsis', 'tags'];

/** Autosave only runs in working (unpublished) states — mirrors poems. */
const AUTOSAVABLE_STATUSES = ['draft', 'private_draft', 'unlisted'];

const notFound = () => new NotFoundError('Story not found', { code: 'STORY_NOT_FOUND' });
const chapterNotFound = () =>
  new NotFoundError('Chapter not found', { code: 'STORY_CHAPTER_NOT_FOUND' });

function serializeAuthor(user) {
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

function serialize(story, author = null) {
  const out = {
    id: String(story._id),
    authorId: String(story.authorId),
    title: story.title,
    coverUrl: story.coverUrl || '',
    synopsis: story.synopsis || '',
    language: story.language,
    tags: story.tags || [],
    status: story.status,
    chapterCount: story.chapterCount ?? 0,
    currentVersionId: story.currentVersionId ? String(story.currentVersionId) : null,
    draftSavedAt: story.draftSavedAt || null,
    stats: story.stats,
    publishedAt: story.publishedAt || null,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
  if (author) out.author = author;
  return out;
}

function serializeChapter(chapter) {
  return {
    id: String(chapter._id),
    storyId: String(chapter.storyId),
    chapterNumber: chapter.chapterNumber,
    title: chapter.title || '',
    content: chapter.content ?? '',
    wordCount: chapter.wordCount ?? 0,
    currentVersionId: chapter.currentVersionId ? String(chapter.currentVersionId) : null,
    draftSavedAt: chapter.draftSavedAt || null,
    createdAt: chapter.createdAt,
    updatedAt: chapter.updatedAt,
  };
}

function serializeChapterSummary(chapter) {
  return {
    id: String(chapter._id),
    chapterNumber: chapter.chapterNumber,
    title: chapter.title || '',
    wordCount: chapter.wordCount ?? 0,
    updatedAt: chapter.updatedAt,
  };
}

function wordCountOf(content) {
  const trimmed = (content || '').trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

function sameTags(a, b) {
  const left = a || [];
  const right = b || [];
  return left.length === right.length && left.every((t, i) => t === right[i]);
}

/**
 * Visibility matrix (plan 36B). Fail-closed: any unauthorized view is a 404
 * so existence is never leaked (§7.1). Authors/moderators always see their
 * own copies (incl. `removed`, for recovery). `published` and `unlisted`
 * (link-only) are publicly readable; everything else is private.
 */
function canView(story, requester) {
  if (requester?.id != null && String(story.authorId) === String(requester.id)) return true;
  if (isModerator(requester)) return true;
  return story.status === 'published' || story.status === 'unlisted';
}

async function loadStory(storyId, { select = STORY_FIELDS } = {}) {
  const story = await storyRepo.findById(storyId, { select });
  if (!story) throw notFound();
  return story;
}

async function createStory(authorId, input) {
  const story = await storyRepo.createStory({
    authorId,
    title: input.title,
    coverUrl: input.coverUrl ?? '',
    synopsis: input.synopsis ?? '',
    language: input.language ?? 'en',
    tags: input.tags ?? [],
    status: 'draft',
  });

  const version = await storyRepo.createVersion({
    storyId: story._id,
    title: story.title,
    synopsis: story.synopsis,
    coverUrl: story.coverUrl,
    tags: story.tags,
    versionNumber: 1,
  });
  story.currentVersionId = version._id;
  await story.save();

  logger.info({ storyId: String(story._id), authorId }, 'story created');
  return serialize(story);
}

async function getStory(storyId, requester) {
  const story = await loadStory(storyId);
  if (!canView(story, requester)) throw notFound();

  let author = null;
  const doc = await User.findById(story.authorId).select(AUTHOR_FIELDS).lean();
  if (doc) author = serializeAuthor(doc);
  return serialize(story, author);
}

async function updateStory(storyId, user, patch) {
  const story = await loadStory(storyId);
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  const fields = {};
  for (const key of UPDATABLE_FIELDS) {
    if (patch[key] !== undefined) fields[key] = patch[key];
  }

  // Explicit save snapshots story metadata into history (plan 38B); language-
  // only edits skip the snapshot — they are presentation, not content.
  const changed = SNAPSHOT_FIELDS.some((key) => {
    if (fields[key] === undefined) return false;
    if (key === 'tags') return !sameTags(fields.tags, story.tags);
    return fields[key] !== story[key];
  });
  if (changed) {
    const version = await storyRepo.createVersion({
      storyId: story._id,
      title: fields.title ?? story.title,
      synopsis: fields.synopsis ?? story.synopsis,
      coverUrl: fields.coverUrl ?? story.coverUrl,
      tags: fields.tags ?? story.tags,
      versionNumber: await storyRepo.nextVersionNumber(story._id, null),
    });
    fields.currentVersionId = version._id;
  }

  const updated = await storyRepo.updateStory(story._id, fields);
  logger.info({ storyId: String(story._id), userId: user.id }, 'story updated');
  return serialize(updated);
}

async function deleteStory(storyId, user) {
  const story = await loadStory(storyId, { select: 'authorId status' });
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  await storyRepo.softRemove(story._id);
  logger.info({ storyId: String(story._id), userId: user.id }, 'story removed (soft)');
  return { id: storyId, deleted: true, status: 'removed' };
}

/**
 * Publish validation (plan 42B): needs at least one chapter and every chapter
 * must have non-empty content — never publish a half-written story.
 */
async function publishStory(storyId, user) {
  const story = await loadStory(storyId);
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  if (story.status === 'published') {
    throw new ConflictError('Story is already published', { code: 'ALREADY_PUBLISHED' });
  }

  const chapters = await storyRepo.listChapters(story._id, {
    limit: 501,
    withContent: true,
  });
  const details = [];
  if (chapters.length === 0) {
    details.push({ field: 'chapters', message: 'at least one chapter is required', code: 'custom' });
  } else {
    chapters.forEach((ch, i) => {
      if (!ch.content || !ch.content.trim()) {
        details.push({
          field: `chapters.${i}`,
          message: `chapter ${ch.chapterNumber} has no content`,
          code: 'custom',
        });
      }
    });
  }
  if (details.length > 0) {
    throw new ValidationError('Story cannot be published', { details });
  }

  const version = await storyRepo.createVersion({
    storyId: story._id,
    title: story.title,
    synopsis: story.synopsis,
    coverUrl: story.coverUrl,
    tags: story.tags,
    versionNumber: await storyRepo.nextVersionNumber(story._id, null),
  });

  const updated = await storyRepo.updateStory(story._id, {
    status: 'published',
    publishedAt: story.publishedAt || new Date(),
    currentVersionId: version._id,
  });
  logger.info({ storyId: String(story._id), userId: user.id }, 'story published');
  return serialize(updated);
}

async function unpublishStory(storyId, user, { to = 'draft' } = {}) {
  const story = await loadStory(storyId);
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  if (story.status !== 'published') {
    throw new ConflictError('Story is not published', { code: 'NOT_PUBLISHED' });
  }

  const updated = await storyRepo.updateStory(story._id, { status: to });
  logger.info({ storyId: String(story._id), userId: user.id, to }, 'story unpublished');
  return serialize(updated);
}

/**
 * Idempotent metadata autosave (plan 38B): identical payload → no write, no
 * version, stable `changed: false`. Owner-only — moderators do not ghost-edit.
 */
async function autosaveStory(storyId, user, patch) {
  const story = await loadStory(storyId, {
    select: 'authorId status title coverUrl synopsis language tags draftSavedAt updatedAt',
  });
  if (story.status === 'removed') throw notFound();
  assertOwner(story, user);

  if (!AUTOSAVABLE_STATUSES.includes(story.status)) {
    throw new ConflictError('Autosave is only available for unpublished stories', {
      code: 'NOT_A_DRAFT',
    });
  }

  const next = {
    title: patch.title !== undefined ? patch.title : story.title,
    coverUrl: patch.coverUrl !== undefined ? patch.coverUrl : story.coverUrl,
    synopsis: patch.synopsis !== undefined ? patch.synopsis : story.synopsis,
    language: patch.language !== undefined ? patch.language : story.language,
    tags: patch.tags !== undefined ? patch.tags : story.tags,
  };
  const unchanged =
    next.title === story.title &&
    next.coverUrl === story.coverUrl &&
    next.synopsis === story.synopsis &&
    next.language === story.language &&
    sameTags(next.tags, story.tags);

  if (unchanged) {
    return {
      id: storyId,
      changed: false,
      ...next,
      savedAt: story.draftSavedAt || story.updatedAt,
    };
  }

  const savedAt = new Date();
  await storyRepo.updateStory(story._id, { ...next, draftSavedAt: savedAt });
  return { id: storyId, changed: true, ...next, savedAt };
}

async function listVersions(storyId, user, { chapterId, cursor, limit = 10 } = {}) {
  const story = await loadStory(storyId, { select: 'authorId status' });
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  const before = cursor != null ? Number(cursor) : undefined;
  const rows = await storyRepo.listVersions(story._id, {
    chapterId: chapterId || null,
    limit: limit + 1,
    before,
  });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((v) => ({
    id: String(v._id),
    chapterId: v.chapterId ? String(v.chapterId) : null,
    versionNumber: v.versionNumber,
    title: v.title,
    content: v.content,
    synopsis: v.synopsis,
    coverUrl: v.coverUrl,
    tags: v.tags || [],
    editedAt: v.editedAt,
  }));

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1].versionNumber) : null,
  };
}

async function listChapters(storyId, requester, { cursor, limit = 20 } = {}) {
  const story = await loadStory(storyId, { select: 'authorId status chapterCount' });
  if (!canView(story, requester)) throw notFound();

  const after = cursor != null ? Number(cursor) : undefined;
  const rows = await storyRepo.listChapters(story._id, { limit: limit + 1, after });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map(serializeChapterSummary);

  return {
    items,
    nextCursor: hasMore ? String(items[items.length - 1].chapterNumber) : null,
  };
}

async function getChapter(storyId, chapterId, requester) {
  const story = await loadStory(storyId, { select: 'authorId status chapterCount' });
  if (!canView(story, requester)) throw notFound();

  const chapter = await storyRepo.findChapter(story._id, chapterId, {
    select: 'chapterNumber title content wordCount currentVersionId draftSavedAt createdAt updatedAt',
  });
  if (!chapter) throw chapterNotFound();
  return serializeChapter(chapter);
}

async function createChapter(storyId, user, input) {
  const story = await loadStory(storyId, { select: 'authorId status chapterCount' });
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  // Atomic allocation — two concurrent creates can never mint the same number.
  const fresh = await storyRepo.allocateChapterNumber(story._id);
  const content = input.content ?? '';
  const chapter = await storyRepo.createChapter({
    storyId: story._id,
    chapterNumber: fresh.chapterCount,
    title: input.title ?? '',
    content,
    wordCount: wordCountOf(content),
  });

  const version = await storyRepo.createVersion({
    storyId: story._id,
    chapterId: chapter._id,
    title: chapter.title,
    content: chapter.content,
    versionNumber: 1,
  });
  chapter.currentVersionId = version._id;
  await storyRepo.saveChapter(chapter);

  logger.info(
    { storyId: String(story._id), chapterId: String(chapter._id), userId: user.id },
    'story chapter created',
  );
  return serializeChapter(chapter);
}

async function updateChapter(storyId, chapterId, user, patch) {
  const story = await loadStory(storyId, { select: 'authorId status' });
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  const chapter = await storyRepo.findChapter(story._id, chapterId, {
    select: 'chapterNumber title content wordCount currentVersionId draftSavedAt updatedAt',
  });
  if (!chapter) throw chapterNotFound();

  const fields = {};
  if (patch.title !== undefined) fields.title = patch.title;
  if (patch.content !== undefined) fields.content = patch.content;

  const titleChanged = fields.title !== undefined && fields.title !== chapter.title;
  const contentChanged = fields.content !== undefined && fields.content !== chapter.content;

  if (titleChanged || contentChanged) {
    const version = await storyRepo.createVersion({
      storyId: story._id,
      chapterId: chapter._id,
      title: fields.title ?? chapter.title,
      content: fields.content ?? chapter.content,
      versionNumber: await storyRepo.nextVersionNumber(story._id, chapter._id),
    });
    fields.currentVersionId = version._id;
    if (contentChanged) fields.wordCount = wordCountOf(fields.content);
  }

  const updated = await storyRepo.updateChapter(chapter._id, fields);
  logger.info(
    { storyId: String(story._id), chapterId: String(chapter._id), userId: user.id },
    'story chapter updated',
  );
  return serializeChapter(updated);
}

/** Idempotent chapter autosave — never versions (plan 38B). Owner-only. */
async function autosaveChapter(storyId, chapterId, user, patch) {
  const story = await loadStory(storyId, { select: 'authorId status' });
  if (story.status === 'removed') throw notFound();
  assertOwner(story, user);

  if (!AUTOSAVABLE_STATUSES.includes(story.status)) {
    throw new ConflictError('Autosave is only available for unpublished stories', {
      code: 'NOT_A_DRAFT',
    });
  }

  const chapter = await storyRepo.findChapter(story._id, chapterId, {
    select: 'title content wordCount draftSavedAt updatedAt',
  });
  if (!chapter) throw chapterNotFound();

  const title = patch.title !== undefined ? patch.title : chapter.title;
  const content = patch.content !== undefined ? patch.content : chapter.content;
  if (title === chapter.title && content === chapter.content) {
    return {
      id: String(chapter._id),
      changed: false,
      title,
      content,
      savedAt: chapter.draftSavedAt || chapter.updatedAt,
    };
  }

  const savedAt = new Date();
  await storyRepo.updateChapter(chapter._id, {
    title,
    content,
    wordCount: wordCountOf(content),
    draftSavedAt: savedAt,
  });
  return { id: String(chapter._id), changed: true, title, content, savedAt };
}

/**
 * Reorder (plan 37B): the payload must be exactly the story's chapters —
 * no smuggling in foreign ids, no silent drops, no duplicates (schema).
 */
async function reorderChapters(storyId, user, chapterIds) {
  const story = await loadStory(storyId, { select: 'authorId status chapterCount' });
  if (story.status === 'removed') throw notFound();
  assertOwnerOrModerator(story, user);

  const existing = await storyRepo.listAllChapterIds(story._id);
  const existingSet = new Set(existing.map((c) => String(c._id)));
  const incomingSet = new Set(chapterIds);
  const valid =
    chapterIds.length === existing.length &&
    incomingSet.size === existingSet.size &&
    [...incomingSet].every((id) => existingSet.has(id));

  if (!valid) {
    throw new ValidationError('Reorder must include exactly the story chapters', {
      details: [{ field: 'chapterIds', message: 'must be exactly the story chapters', code: 'custom' }],
    });
  }

  await storyRepo.renumberChapters(
    chapterIds.map((id, i) => ({ id, chapterNumber: i + 1 })),
  );
  logger.info({ storyId: String(story._id), userId: user.id }, 'story chapters reordered');

  const rows = await storyRepo.listChapters(story._id, { limit: 501 });
  return { items: rows.map(serializeChapterSummary) };
}

/**
 * Author story list (plan 41B, profile scope): self sees everything except
 * removed; others see only `published` (unlisted is link-only). Cursor is the
 * last item's createdAt.
 */
async function listByAuthor(authorId, requester, { cursor, limit = 20 } = {}) {
  const user = await User.findById(authorId).select('_id').lean();
  if (!user) throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });

  const filter = { authorId, ...authorScope('story', requester, authorId) };
  if (cursor != null) filter.createdAt = { $lt: new Date(cursor) };

  const rows = await storyRepo.findByFilter(filter, { limit: limit + 1 });
  const hasMore = rows.length > limit;
  const items = (hasMore ? rows.slice(0, limit) : rows).map((s) => ({
    id: String(s._id),
    title: s.title,
    coverUrl: s.coverUrl || '',
    synopsis: s.synopsis || '',
    tags: s.tags || [],
    language: s.language,
    status: s.status,
    chapterCount: s.chapterCount ?? 0,
    publishedAt: s.publishedAt || null,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  }));

  return {
    items,
    nextCursor: hasMore ? items[items.length - 1].createdAt.toISOString() : null,
  };
}

module.exports = {
  canView,
  createStory,
  getStory,
  updateStory,
  deleteStory,
  publishStory,
  unpublishStory,
  autosaveStory,
  listVersions,
  listChapters,
  getChapter,
  createChapter,
  updateChapter,
  autosaveChapter,
  reorderChapters,
  listByAuthor,
};
