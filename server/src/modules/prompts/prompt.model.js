'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Prompt (§3.17, plan step 69) — one text prompt per week; `weekOf` is the
 * week start (readers pick the newest prompt whose weekOf <= now).
 * Prompts are seeded by fixtures/tests — there is no create endpoint (§5).
 */
const promptSchema = createSchema({
  text: { type: String, required: true, trim: true, maxlength: 500 },
  weekOf: { type: Date, required: true },
  featuredPoemIds: { type: [refField('Poem')], default: [] },
});

promptSchema.index({ weekOf: -1 });

const Prompt = mongoose.model('Prompt', promptSchema);

module.exports = { Prompt };
