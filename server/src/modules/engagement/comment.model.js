'use strict';

const mongoose = require('mongoose');
const { createSchema, refField, ObjectId } = require('../../models/base');

/**
 * Comment model (§3.5). `parentCommentId` is null for top-level comments;
 * replies attach to top-level only (2-level threads — service-enforced).
 * Soft-delete: `removed` comments stay for the count ledger but never list.
 */

const commentSchema = createSchema({
  targetType: { type: String, enum: ['poem', 'diary', 'collabSegment'], required: true },
  targetId: { type: ObjectId, required: true },
  authorId: refField('User'),
  anonymous: { type: Boolean, default: false },
  parentCommentId: { type: mongoose.Schema.Types.ObjectId, default: null },
  content: { type: String, required: true, trim: true, maxlength: 500 },
  status: {
    type: String,
    enum: ['active', 'hidden', 'removed'],
    default: 'active',
  },
});

// §4 index — thread listing (top-level page + reply batches share this shape)
commentSchema.index({ targetType: 1, targetId: 1, parentCommentId: 1, createdAt: 1 });
// cross-check uniqueness-free hot path kept from §4
commentSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });

const Comment = mongoose.model('Comment', commentSchema);

module.exports = { Comment };
