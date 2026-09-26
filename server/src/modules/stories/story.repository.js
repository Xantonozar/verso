'use strict';

const { Story } = require('./story.model');
const { StoryChapter } = require('./story-chapter.model');
const { StoryVersion } = require('./story-version.model');

/**
 * Story repository — the only layer that talks to `stories`/`storychapters`/
 * `storyversions`. Read paths always pass an explicit projection (§10.2).
 */
async function findById(id, { select } = {}) {
  let q = Story.findById(id);
  if (select) q = q.select(select);
  return q.exec();
}

async function createStory(data) {
  return Story.create(data);
}

async function updateStory(id, fields) {
  return Story.findByIdAndUpdate(id, { $set: fields }, { new: true, runValidators: true });
}

async function softRemove(id) {
  return Story.findByIdAndUpdate(id, { $set: { status: 'removed' } }, { new: true });
}

/** Profile list — filter built by the service (self vs public visibility). */
async function findByFilter(filter, { limit, select } = {}) {
  let q = Story.find(filter).sort({ createdAt: -1 });
  if (limit) q = q.limit(limit);
  if (select) q = q.select(select);
  return q.lean();
}

/** Atomic chapter-number allocation — the returned doc carries the new count. */
async function allocateChapterNumber(storyId) {
  return Story.findByIdAndUpdate(storyId, { $inc: { chapterCount: 1 } }, { new: true });
}

async function findChapter(storyId, chapterId, { select } = {}) {
  let q = StoryChapter.findOne({ _id: chapterId, storyId });
  if (select) q = q.select(select);
  return q.exec();
}

async function createChapter(data) {
  return StoryChapter.create(data);
}

async function saveChapter(chapter) {
  return chapter.save();
}

/** Ascending by chapterNumber; `after` implements cursor paging. */
async function listChapters(storyId, { limit, after, withContent = false } = {}) {
  const filter = { storyId };
  if (after != null) filter.chapterNumber = { $gt: after };
  const select = withContent
    ? 'chapterNumber title content wordCount'
    : 'chapterNumber title wordCount updatedAt';
  return StoryChapter.find(filter)
    .sort({ chapterNumber: 1 })
    .limit(limit)
    .select(select)
    .lean();
}

async function listAllChapterIds(storyId) {
  return StoryChapter.find({ storyId }).sort({ chapterNumber: 1 }).select('_id').lean();
}

async function updateChapter(id, fields) {
  return StoryChapter.findByIdAndUpdate(id, { $set: fields }, { new: true, runValidators: true });
}

/**
 * Bulk renumber for reorder — two passes so the unique (storyId,
 * chapterNumber) index can never collide mid-update: park every chapter far
 * above its final number first, then assign the real 1..n order.
 */
async function renumberChapters(pairs) {
  if (pairs.length === 0) return null;
  const parkOps = pairs.map(({ id }) => ({
    updateOne: { filter: { _id: id }, update: { $inc: { chapterNumber: 100_000 } } },
  }));
  const finalOps = pairs.map(({ id, chapterNumber }) => ({
    updateOne: { filter: { _id: id }, update: { $set: { chapterNumber } } },
  }));
  await StoryChapter.bulkWrite(parkOps);
  return StoryChapter.bulkWrite(finalOps);
}

async function createVersion({ storyId, chapterId, title, content, synopsis, coverUrl, tags, versionNumber }) {
  return StoryVersion.create({
    storyId,
    ...(chapterId ? { chapterId } : {}),
    title,
    content: content ?? '',
    synopsis: synopsis ?? '',
    coverUrl: coverUrl ?? '',
    tags: tags ?? [],
    versionNumber,
    editedAt: new Date(),
  });
}

/** Version sequences are scoped per (storyId, chapterId) pair. */
async function nextVersionNumber(storyId, chapterId) {
  const filter = { storyId };
  if (chapterId) filter.chapterId = chapterId;
  else filter.chapterId = null;
  const latest = await StoryVersion.findOne(filter)
    .sort({ versionNumber: -1 })
    .select('versionNumber')
    .lean();
  return (latest?.versionNumber || 0) + 1;
}

async function listVersions(storyId, { chapterId, limit, before } = {}) {
  const filter = { storyId, chapterId: chapterId ?? null };
  if (before != null) filter.versionNumber = { $lt: before };
  return StoryVersion.find(filter)
    .sort({ versionNumber: -1 })
    .limit(limit)
    .select('title content synopsis coverUrl tags versionNumber editedAt chapterId')
    .lean();
}

module.exports = {
  findById,
  createStory,
  updateStory,
  softRemove,
  findByFilter,
  allocateChapterNumber,
  findChapter,
  createChapter,
  saveChapter,
  listChapters,
  listAllChapterIds,
  updateChapter,
  renumberChapters,
  createVersion,
  nextVersionNumber,
  listVersions,
};
