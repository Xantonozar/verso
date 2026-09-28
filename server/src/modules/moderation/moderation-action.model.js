'use strict';

const mongoose = require('mongoose');
const { createSchema, refField, ObjectId } = require('../../models/base');

/**
 * ModerationAction model (§3.22, Phase 14 plan step 89). The durable audit
 * trail of every enforcement decision — progressive warnings, restrictions,
 * bans, and (most sensitively) identity reveals. Rows are append-only:
 * nothing ever rewrites an action after the fact.
 */
const ACTION_TYPES = ['warning', 'restriction', 'ban', 'identity_revealed'];

const moderationActionSchema = createSchema(
  {
    userId: refField('User'),
    actionType: { type: String, enum: ACTION_TYPES, required: true },
    reason: { type: String, required: true, maxlength: 500 },
    reportId: { type: ObjectId, default: null },
    moderatorId: refField('User'),
  },
);

// "what was ever done to this user" — moderation profile reads.
moderationActionSchema.index({ userId: 1, createdAt: -1 });

const ModerationAction = mongoose.model('ModerationAction', moderationActionSchema);

module.exports = { ModerationAction, ACTION_TYPES };
