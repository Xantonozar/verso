'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * DuelVote (§3.16, plan step 68) — one vote per user per duel, enforced by
 * the unique index (the actual arbiter under concurrency); the service's
 * conditional $inc + rollback keeps `Duel.votes` exact when the index rejects
 * a duplicate.
 */
const duelVoteSchema = createSchema({
  duelId: refField('Duel'),
  userId: refField('User'),
  votedFor: { type: String, enum: ['A', 'B'], required: true },
});

duelVoteSchema.index({ duelId: 1, userId: 1 }, { unique: true });

const DuelVote = mongoose.model('DuelVote', duelVoteSchema);

module.exports = { DuelVote };
