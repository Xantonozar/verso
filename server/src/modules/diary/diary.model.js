'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * DiaryEntry (§3.4, plan step 50) — a one-liner journal post. Deliberately
 * minimal: NO title, NO status lifecycle, NO moods/tags, and NO Felt Good /
 * star-rating field anywhere on this schema — reviews are poem-only, and the
 * absence here (not just of the route) is what makes "diary never in mood/tag
 * discovery" structurally true at the query layer (plan step 51).
 */

// _id:false — stats is a value object, not a document (no leaked subdoc ids)
const statsSchema = new mongoose.Schema(
  {
    reactionCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
  },
  { _id: false, id: false, versionKey: false },
);

const diaryEntrySchema = createSchema({
  authorId: refField('User'),
  content: { type: String, required: true, trim: true, maxlength: 280 },
  visibility: { type: String, enum: ['public', 'followers'], default: 'public' },
  anonymous: { type: Boolean, default: false },
  stats: {
    type: statsSchema,
    default: () => ({ reactionCount: 0, commentCount: 0 }),
  },
});

// Chronological own-entry listing / profile surfaces
diaryEntrySchema.index({ authorId: 1, createdAt: -1 });

const DiaryEntry = mongoose.model('DiaryEntry', diaryEntrySchema);

module.exports = { DiaryEntry };
