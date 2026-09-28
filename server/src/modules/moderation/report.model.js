'use strict';

const mongoose = require('mongoose');
const { createSchema, refField, ObjectId } = require('../../models/base');

/**
 * Report model (§3.21, Phase 14 plan step 87). One row per reporter per
 * target while a report is open — duplicates are rejected in the service
 * (409), and a dismissed/actioned report never blocks a fresh report later.
 *
 * `reporterId` is only surfaced to moderators (queue listing), never to the
 * reported party.
 */
const REPORT_REASONS = [
  'spam',
  'harassment',
  'hate_speech',
  'sexual_content',
  'violence',
  'self_harm',
  'impersonation',
  'copyright',
  'other',
];

const REPORT_TARGET_TYPES = ['poem', 'story', 'comment', 'user', 'diary'];
const REPORT_STATUSES = ['pending', 'reviewed', 'actioned', 'dismissed'];

const reportSchema = createSchema(
  {
    reporterId: refField('User'),
    targetType: { type: String, enum: REPORT_TARGET_TYPES, required: true },
    targetId: { type: ObjectId, required: true },
    reason: { type: String, enum: REPORT_REASONS, required: true },
    details: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: REPORT_STATUSES, default: 'pending' },
  },
);

// Duplicate-open-report check (reporter + target while pending) and the
// moderator queue scan (status + newest first).
reportSchema.index({ reporterId: 1, targetType: 1, targetId: 1 });
reportSchema.index({ status: 1, createdAt: -1 });

const Report = mongoose.model('Report', reportSchema);

module.exports = { Report, REPORT_REASONS, REPORT_TARGET_TYPES, REPORT_STATUSES };
