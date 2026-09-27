'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * ReadingPath (§3.14, plan step 65) — one append-only breadcrumb per reader
 * per piece: `visitedSegmentIds` grows (`$push` only, never pulled) and
 * `currentSegmentId` tracks where the reader stands at the fork picker.
 *
 * Unique (userId, pieceId) so POST reading-path is a single upsert.
 *
 * TODO (§3.14 note, plan step 65 — flagged, deliberately NOT built yet):
 * `visitedSegmentIds` is unbounded; fine for v1, split into a
 * `ReadingPathStep { readingPathId, segmentId, order, visitedAt }` collection
 * if paths through long branching pieces get large (16MB document limit).
 */
const readingPathSchema = createSchema({
  userId: refField('User'),
  pieceId: { type: mongoose.Schema.Types.ObjectId, ref: 'CollaborationPiece', required: true },
  visitedSegmentIds: { type: [mongoose.Schema.Types.ObjectId], default: () => [] },
  currentSegmentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CollaborationSegment',
    default: null,
  },
});

readingPathSchema.index({ userId: 1, pieceId: 1 }, { unique: true });

const ReadingPath = mongoose.model('ReadingPath', readingPathSchema);

module.exports = { ReadingPath };
