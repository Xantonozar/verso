'use strict';

const mongoose = require('mongoose');
const { createSchema, refField, ObjectId } = require('../../models/base');

/**
 * Reaction model (§3.6). One reaction of a given type per user per target —
 * enforced by the unique compound index (plan step 47) so duplicates become
 * a clean 409 instead of an E11000 leak. `targetType` allows diary in Phase 4;
 * only `poem` targets are resolvable until then.
 */

const REACTION_TYPES = ['loved', 'hurt', 'felt_this', 'powerful', 'comforting', 'dark', 'beautiful'];

const reactionSchema = createSchema({
  targetType: { type: String, enum: ['poem', 'diary'], required: true },
  targetId: { type: ObjectId, required: true }, // polymorphic: poem (now) or diary (Phase 4)
  userId: refField('User'),
  anonymous: { type: Boolean, default: false },
  type: { type: String, enum: REACTION_TYPES, required: true },
});

// §4 unique constraint — plan step 47
reactionSchema.index({ targetType: 1, targetId: 1, userId: 1, type: 1 }, { unique: true });

const Reaction = mongoose.model('Reaction', reactionSchema);

module.exports = { Reaction, REACTION_TYPES };
