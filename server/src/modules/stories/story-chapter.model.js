'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * StoryChapter (plan 35B) — an ordered unit of a story. `chapterNumber` is the
 * stable 1-based order (reorder rewrites numbers, never ids). `wordCount` is
 * the read-optimized cache for the chapter list; content truth lives here and
 * immutable history in StoryVersion (chapter-scoped).
 */
const storyChapterSchema = createSchema({
  storyId: refField('Story'),
  chapterNumber: { type: Number, required: true, min: 1 },
  title: { type: String, default: '', trim: true, maxlength: 200 },
  content: { type: String, default: '', maxlength: 300_000 },
  wordCount: { type: Number, default: 0, min: 0 },
  currentVersionId: refField('StoryVersion', { required: false }),
  draftSavedAt: { type: Date, default: null },
});

// Ordered chapter list + fetch-by-number — unique so a race can never mint
// two chapters with the same position inside one story.
storyChapterSchema.index({ storyId: 1, chapterNumber: 1 }, { unique: true });

const StoryChapter = mongoose.model('StoryChapter', storyChapterSchema);

module.exports = { StoryChapter };
