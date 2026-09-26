'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Story (plan 35B/36B) — first-class long-form type. `status` IS the lifecycle
 * (no separate visibility field): `draft`/`private_draft`/`under_review` are
 * private working states, `published` is public, `unlisted` is link-only, and
 * `removed` is the soft-delete. `chapterCount` is the read-optimized cache
 * served by story detail; chapter truth lives in StoryChapter.
 */

// _id:false — stats is a value object, not a document (no leaked subdoc ids)
const statsSchema = new mongoose.Schema(
  {
    reads: { type: Number, default: 0 },
    reactionCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    saveCount: { type: Number, default: 0 },
    shareCount: { type: Number, default: 0 },
  },
  { _id: false, id: false, versionKey: false },
);

const storySchema = createSchema({
  authorId: refField('User'),
  title: { type: String, required: true, trim: true, maxlength: 200 },
  coverUrl: { type: String, default: '' },
  synopsis: { type: String, default: '', maxlength: 5000 },
  language: { type: String, enum: ['bn', 'en'], default: 'en' },
  tags: { type: [String], default: [] },
  status: {
    type: String,
    enum: ['draft', 'published', 'unlisted', 'private_draft', 'under_review', 'removed'],
    default: 'draft',
  },
  chapterCount: { type: Number, default: 0, min: 0 },
  // set right after StoryVersion v1 is created — required: false so the story
  // document can exist for the two-step create
  currentVersionId: refField('StoryVersion', { required: false }),
  draftSavedAt: { type: Date, default: null },
  stats: {
    type: statsSchema,
    default: () => ({ reads: 0, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 }),
  },
  publishedAt: { type: Date, default: null },
});

// Profile story list + public listing — declared here too so
// mongodb-memory-server (`.init()`) reproduces the production plan in tests.
storySchema.index({ authorId: 1, status: 1, createdAt: -1 });
storySchema.index({ status: 1, createdAt: -1 });

const Story = mongoose.model('Story', storySchema);

module.exports = { Story };
