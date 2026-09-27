'use strict';

const { createSchema, refField } = require('../../models/base');
const mongoose = require('mongoose');

/**
 * Conversation (§3.19, plan step 72) — a DM thread between exactly two users.
 * `participantIds` is always stored sorted ascending so the unique index makes
 * get-or-create idempotent regardless of which side starts the thread.
 * `isAnonymous` anonymizes the WHOLE thread: neither participant's identity is
 * sent to the other over REST or socket payloads.
 */
const conversationSchema = createSchema({
  participantIds: {
    type: [refField('User')],
    required: true,
    validate: {
      validator: (ids) => Array.isArray(ids) && ids.length === 2,
      message: 'must contain exactly two participants',
    },
  },
  // scalar pair identity — a unique index on the ARRAY would enforce
  // uniqueness per element (alice+carol vs alice+dave would collide on alice)
  pairKey: { type: String, required: true },
  isAnonymous: { type: Boolean, default: false },
  // Activity stamp powering the inbox sort (§5 GET /conversations)
  lastMessageAt: { type: Date, default: Date.now },
});

// one thread per user pair — backs get-or-create and blocks duplicates
conversationSchema.index({ pairKey: 1 }, { unique: true });
// inbox listing: my threads, newest activity first
conversationSchema.index({ participantIds: 1, lastMessageAt: -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = { Conversation };
