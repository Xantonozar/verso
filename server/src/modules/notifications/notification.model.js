'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Notification (3.20, plan step 78) - inbox row for secondary social events
 * (reaction, comment, follow, collab turn, duel result).
 *
 * - `readAt: null` = unread (cleaner than a bare boolean).
 * - `eventKey` is the idempotency anchor (10.15): the worker upserts on it
 *   and a deterministic BullMQ jobId reuses the same key, so a retried job or
 *   a duplicate enqueue can never mint a second row for one event.
 */
const notificationSchema = createSchema({
  userId: refField('User', { index: true }),
  type: {
    type: String,
    required: true,
    enum: ['reaction', 'comment', 'follow', 'collab_turn', 'duel_result'],
  },
  poeticMessage: { type: String, required: true, maxlength: 300 },
  relatedType: { type: String, required: true, maxlength: 40 },
  relatedId: { type: mongoose.Schema.Types.ObjectId, required: true },
  eventKey: { type: String, required: true, unique: true, maxlength: 200 },
  readAt: { type: Date, default: null },
});

// Inbox hot path: my rows, unread first, newest first (4)
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Notification };
