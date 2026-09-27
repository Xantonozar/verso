'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Reading-activity row (plan step 82): one document per counted read,
 * written ONLY by the analytics worker - never on the read request itself
 * (§10.18/§8.14, the endpoint just enqueues).
 *
 * `authorId` is denormalized from the poem at write time so the writer
 * dashboard aggregates through a single `{ authorId, createdAt }` index
 * instead of joining through poems. The unique `eventKey` is the
 * idempotency anchor (§8.15): a retried job surfaces as E11000 and must
 * not double-count the read.
 */
const readingActivitySchema = createSchema({
  // no poemId index: every read query goes through authorId (dashboard) or
  // eventKey (worker idempotency) - indexing unqueried fields is §4 bloat
  poemId: refField('Poem'),
  authorId: refField('User'),
  // null = anonymous reader (public/unlisted poem read while signed out).
  readerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  eventKey: { type: String, required: true, unique: true },
});

readingActivitySchema.index({ authorId: 1, createdAt: -1 });

const ReadingActivity = mongoose.model('ReadingActivity', readingActivitySchema);

module.exports = { ReadingActivity };
