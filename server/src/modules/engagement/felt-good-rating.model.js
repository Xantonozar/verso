'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * FeltGoodRating model (§3.7). Poem-only resonance score (0–100) — not a
 * star rating. One rating per user per poem, enforced by the unique index
 * (plan step 47): a second POST is a 409; updates go through PATCH.
 */

const feltGoodRatingSchema = createSchema({
  poemId: refField('Poem'),
  userId: refField('User'),
  score: { type: Number, required: true, min: 0, max: 100 },
  comment: { type: String, default: '', maxlength: 500 },
});

// §4 unique constraint — plan step 47
feltGoodRatingSchema.index({ poemId: 1, userId: 1 }, { unique: true });

const FeltGoodRating = mongoose.model('FeltGoodRating', feltGoodRatingSchema);

module.exports = { FeltGoodRating };
