'use strict';

const { NotFoundError } = require('../../errors');
const { logger } = require('../../config/logger');
const { Notification } = require('./notification.model');
const { User } = require('../users/user.model');
const { renderPoeticMessage } = require('./templates');

/** Shared by REST and the socket fan-out - one shape everywhere (7.1). */
function serializeNotification(doc) {
  const readAt = doc.readAt ? new Date(doc.readAt).toISOString() : null;
  const createdAt = new Date(doc.createdAt).toISOString();
  return {
    id: String(doc._id ?? doc.id),
    type: doc.type,
    poeticMessage: doc.poeticMessage,
    relatedType: doc.relatedType,
    relatedId: String(doc.relatedId),
    readAt,
    createdAt,
    isUnread: !readAt,
  };
}

/**
 * Worker-side insert (plan step 79, 10.15 idempotency): check-then-insert on
 * the unique `eventKey`, so a retried job (or a duplicate enqueue) returns
 * `inserted: false` instead of creating a second row. The unique index is the
 * race arbiter - a concurrent duplicate surfaces as E11000 and is folded into
 * the same `inserted: false` result.
 */
async function createNotificationIdempotent(jobData) {
  const eventKey = jobData?.eventKey;
  if (!eventKey) return { inserted: false, skipped: 'missing-event-key' };

  const existing = await Notification.findOne({ eventKey }).select('_id').lean();
  if (existing) return { inserted: false, duplicateOf: String(existing._id) };

  const recipient = await User.findById(jobData.recipientId).select('_id').lean();
  if (!recipient) return { inserted: false, skipped: 'recipient-missing' };

  let actorName = jobData.actor?.displayName || null;
  if (!actorName && jobData.actor?.id) {
    const actor = await User.findById(jobData.actor.id).select('displayName').lean();
    actorName = actor?.displayName || null;
  }

  try {
    const doc = await Notification.create({
      userId: jobData.recipientId,
      type: jobData.type,
      poeticMessage: renderPoeticMessage({ type: jobData.type, actorName }),
      relatedType: jobData.relatedType,
      relatedId: jobData.relatedId,
      eventKey,
    });
    logger.info(
      { event: 'notification:created', notificationId: doc.id, type: jobData.type, userId: jobData.recipientId },
      'Notification created',
    );
    return { inserted: true, notification: doc };
  } catch (err) {
    if (err?.code === 11000) return { inserted: false, duplicateOf: 'race' };
    throw err;
  }
}

/**
 * Inbox listing (plan step 78, 5): cursor-paginated, newest first, plus the
 * unread count for the badge - one indexed countDocuments, never a full scan.
 */
async function listNotifications(user, { cursor, limit = 20 } = {}) {
  const filter = { userId: user.id };
  if (cursor) filter.createdAt = { $lt: new Date(cursor) };

  const docs = await Notification.find(filter).sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];
  const unreadCount = await Notification.countDocuments({ userId: user.id, readAt: null });

  return {
    items: page.map(serializeNotification),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
    unreadCount,
  };
}

/** Mark-as-read (plan 5): idempotent, 404 on a row that is not mine. */
async function markNotificationRead(user, id) {
  const doc = await Notification.findOne({ _id: id, userId: user.id });
  if (!doc) {
    throw new NotFoundError('Notification not found', { code: 'NOTIFICATION_NOT_FOUND' });
  }
  if (!doc.readAt) {
    doc.readAt = new Date();
    await doc.save();
  }
  return serializeNotification(doc);
}

module.exports = {
  serializeNotification,
  createNotificationIdempotent,
  listNotifications,
  markNotificationRead,
};
