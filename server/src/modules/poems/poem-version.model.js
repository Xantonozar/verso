'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * PoemVersion (§3.3) — immutable snapshot created on explicit save/edit only.
 * Autosave (Phase 2 step 41) never writes here; the compound index below
 * serves the paginated GET /poems/:id/versions endpoint.
 */
const poemVersionSchema = createSchema({
  poemId: refField('Poem'),
  title: { type: String, required: true, trim: true, maxlength: 200 },
  content: { type: String, required: true },
  versionNumber: { type: Number, required: true, min: 1 },
  editedAt: { type: Date, default: Date.now },
});

poemVersionSchema.index({ poemId: 1, versionNumber: -1 });

const PoemVersion = mongoose.model('PoemVersion', poemVersionSchema);

module.exports = { PoemVersion };
