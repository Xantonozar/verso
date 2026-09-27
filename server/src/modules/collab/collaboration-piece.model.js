'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * CollaborationPiece (§3.12, plan step 64) — an open/branching collaboration
 * container. `mode` decides the branch cap enforced on every segment write:
 * `single_ending` allows exactly one child per segment (linear chain),
 * `multi_ending` allows up to `maxBranches` children (the "configured max").
 */
const collaborationPieceSchema = createSchema({
  creatorId: refField('User'),
  title: { type: String, required: true, trim: true, maxlength: 120 },
  mode: { type: String, enum: ['single_ending', 'multi_ending'], required: true },
  maxBranches: { type: Number, min: 2, max: 10, default: 5 },
  status: { type: String, enum: ['open', 'locked', 'complete'], default: 'open' },
  rootSegmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollaborationSegment' },
});

collaborationPieceSchema.index({ status: 1, createdAt: -1 });

const CollaborationPiece = mongoose.model('CollaborationPiece', collaborationPieceSchema);

module.exports = { CollaborationPiece };
