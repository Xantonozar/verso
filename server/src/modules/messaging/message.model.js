'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Message (§3.19, plan step 72). `senderId` always stores the REAL author —
 * anonymity is enforced at serialization time (viewers get `senderId: null`),
 * never by dropping the data the read-receipts and moderation need.
 * `readAt: null` = unread (backs unread counts and `message:read`).
 */
const messageSchema = createSchema({
  conversationId: refField('Conversation'),
  senderId: refField('User'),
  content: { type: String, required: true, trim: true, maxlength: 4000 },
  // per-message anonymity — effective anonymity is `isAnonymous || conversation.isAnonymous`
  isAnonymous: { type: Boolean, default: false },
  readAt: { type: Date, default: null },
});

// §4: history pagination (cursor = createdAt, newest first)
messageSchema.index({ conversationId: 1, createdAt: -1 });
// unread counts per conversation (inbox row)
messageSchema.index({ conversationId: 1, senderId: 1, readAt: 1 });

const Message = mongoose.model('Message', messageSchema);

module.exports = { Message };
