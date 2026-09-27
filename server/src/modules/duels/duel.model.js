'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Duel (§3.15, plan step 68) — two published poems face off on a theme.
 * `status` stores the phase at write time; readers re-derive the effective
 * phase from the deadlines, so a stale row can never reopen a closed vote.
 */
const duelSchema = createSchema({
  theme: { type: String, required: true, trim: true, maxlength: 140 },
  poetAId: refField('User'),
  poetBId: refField('User'),
  poemAId: refField('Poem'),
  poemBId: refField('Poem'),
  submissionDeadline: { type: Date, required: true },
  votingDeadline: { type: Date, required: true },
  votes: {
    poemA: { type: Number, default: 0, min: 0 },
    poemB: { type: Number, default: 0, min: 0 },
  },
  status: { type: String, enum: ['open', 'voting', 'closed'], default: 'open' },
});

duelSchema.index({ createdAt: -1 });

const Duel = mongoose.model('Duel', duelSchema);

module.exports = { Duel };
