'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * CollaborationSegment (§3.13, plan step 64) — one node of an open
 * collaboration. `ancestorPath` is the materialized path (every ancestor up
 * to but excluding this segment); `childCount` is the denormalized branch
 * counter claimed atomically (`$inc` guarded by the cap — §8.19, never
 * read-modify-write) before a child segment is created.
 *
 * Indexes (§4): ancestorPath for subtree/path queries, (pieceId, parentId)
 * for the branch-picker children endpoint.
 */
const collaborationSegmentSchema = createSchema({
  pieceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollaborationPiece', required: true },
  parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollaborationSegment', default: null },
  ancestorPath: {
    type: [{ type: mongoose.Schema.Types.ObjectId }],
    default: [],
  },
  authorId: refField('User'),
  content: { type: String, required: true, maxlength: 5000 },
  childCount: { type: Number, default: 0, min: 0 },
  depth: { type: Number, default: 0, min: 0 },
});

collaborationSegmentSchema.index({ ancestorPath: 1 });
collaborationSegmentSchema.index({ pieceId: 1, parentId: 1 });

const CollaborationSegment = mongoose.model('CollaborationSegment', collaborationSegmentSchema);

module.exports = { CollaborationSegment };
