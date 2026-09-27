'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * CollabPoem (§3.11, plan step 63) — fixed-turn relay collaboration. Turns
 * are append-only (no edit/delete endpoints in v1) and the poem stays `open`
 * forever until its creator marks it `finished` — no writer cap, no clock.
 *
 * TODO (§3.11 note, plan step 63 — flagged, deliberately NOT built yet):
 * `turns` is an unbounded embedded array; fine for v1, but split into a
 * `CollabTurn { collabPoemId, authorId, lines, order, createdAt }` collection
 * before any piece accumulates very large turn counts (16MB document limit).
 */
const collabPoemSchema = createSchema({
  creatorId: refField('User'),
  title: { type: String, required: true, trim: true, maxlength: 120 },
  linesPerTurn: { type: Number, required: true, min: 1, max: 20 },
  status: { type: String, enum: ['open', 'finished'], default: 'open' },
  turns: {
    type: [
      {
        _id: false,
        authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        lines: { type: String, required: true },
        order: { type: Number, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: () => [],
  },
});

collabPoemSchema.index({ status: 1, createdAt: -1 });

const CollabPoem = mongoose.model('CollabPoem', collabPoemSchema);

module.exports = { CollabPoem };
