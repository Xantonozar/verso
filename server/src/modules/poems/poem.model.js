'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Poem model (§3.2). `title`/`content` are the read-optimized cache served by
 * GET /poems/:id; immutable history lives in PoemVersion. `status` drives
 * soft-delete (`removed`) and moderation states. `draftSavedAt` marks the last
 * idempotent autosave (Phase 2 step 41) without creating version spam.
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

const poemSchema = createSchema({
  authorId: refField('User'),
  title: { type: String, required: true, trim: true, maxlength: 200 },
  content: { type: String, required: true },
  authorNote: { type: String, default: '', maxlength: 1000 },
  language: { type: String, enum: ['bn', 'en'], default: 'en' },
  moods: { type: [String], default: [] },
  tags: { type: [String], default: [] },
  visibility: {
    type: String,
    enum: ['public', 'followers', 'unlisted', 'private_draft'],
    default: 'private_draft',
  },
  anonymous: { type: Boolean, default: false },
  isUnsentPoem: { type: Boolean, default: false },
  unsentRecipientLabel: { type: String, default: '' },
  audioUrl: { type: String, default: '' },
  videoUrl: { type: String, default: '' },
  status: {
    type: String,
    enum: ['draft', 'published', 'hidden', 'removed', 'under_review'],
    default: 'draft',
  },
  // set right after PoemVersion v1 is created — required: false so the poem
  // document can exist for the two-step create
  currentVersionId: refField('PoemVersion', { required: false }),
  draftSavedAt: { type: Date, default: null },
  stats: {
    type: statsSchema,
    default: () => ({ reads: 0, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 }),
  },
  publishedAt: { type: Date, default: null },
  // Derived, never request-computed: the trending worker (Phase 5 step 55)
  // denormalizes the score here; GET /discover/trending just reads it (§8.6).
  trendingScore: { type: Number, default: 0 },
});

// §5 index plan — declared here too so mongodb-memory-server (`.init()`)
// reproduces the production plan inside integration tests.
poemSchema.index({ authorId: 1, status: 1, createdAt: -1 });
poemSchema.index({ moods: 1, status: 1, visibility: 1, createdAt: -1 });
poemSchema.index({ tags: 1, status: 1, createdAt: -1 });
// Phase 5 additions: published listing (trending job's window match + fallback
// read ordered by the denormalized score) — background job, but still IXSCAN.
poemSchema.index({ status: 1, visibility: 1, createdAt: -1 });
poemSchema.index({ status: 1, visibility: 1, trendingScore: -1 });

const Poem = mongoose.model('Poem', poemSchema);

module.exports = { Poem };
