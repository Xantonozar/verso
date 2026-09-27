'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Save model (§3.9). One save per user per poem — unique index keeps the
 * idempotent toggle honest under races; `stats.saveCount` only moves on an
 * actual state change (create/delete), never on a repeat tap.
 */

const saveSchema = createSchema({
  userId: refField('User'),
  poemId: refField('Poem'),
});

// §4 unique constraint
saveSchema.index({ userId: 1, poemId: 1 }, { unique: true });
// saves-per-poem time series (Phase 12 dashboard aggregation)
saveSchema.index({ poemId: 1, createdAt: -1 });

const Save = mongoose.model('Save', saveSchema);

module.exports = { Save };
