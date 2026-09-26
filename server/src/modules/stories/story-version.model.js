'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * StoryVersion (plan 37B/38B) — immutable snapshot created on explicit
 * save/publish only; autosave never writes here. One document serves two
 * scopes: `chapterId` absent → story-metadata snapshot (title/synopsis/cover/
 * tags), `chapterId` set → chapter snapshot (title/content). `versionNumber`
 * sequences are therefore scoped per (storyId, chapterId) pair — the compound
 * unique index below enforces that.
 */
const storyVersionSchema = createSchema({
  storyId: refField('Story'),
  chapterId: refField('StoryChapter', { required: false }),
  versionNumber: { type: Number, required: true, min: 1 },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  content: { type: String, default: '' },
  synopsis: { type: String, default: '', maxlength: 5000 },
  coverUrl: { type: String, default: '' },
  tags: { type: [String], default: [] },
  editedAt: { type: Date, default: Date.now },
});

storyVersionSchema.index({ storyId: 1, chapterId: 1, versionNumber: -1 }, { unique: true });

const StoryVersion = mongoose.model('StoryVersion', storyVersionSchema);

module.exports = { StoryVersion };
