'use strict';

const mongoose = require('mongoose');
const { NotFoundError, ValidationError } = require('../../errors');
const { Conversation } = require('./conversation.model');
const { Message } = require('./message.model');
const { User } = require('../users/user.model');
const { emitToUser } = require('../../sockets/registry');

/**
 * Messaging service (plan step 72-76):
 *
 * - Threads are exactly-two-participant DMs (§3.19); get-or-create keyed on
 *   the sorted `participantIds` unique index (11000 → re-read, no duplicates).
 * - Anonymity (§3.19, plan 10.4): effective anonymity is
 *   `message.isAnonymous || conversation.isAnonymous`. When it is on, the
 *   serializer hides `senderId`/`sender` — REST and the socket fan-out share
 *   this ONE serializer, so neither channel can leak identities.
 * - History is cursor-paginated (§10.2, never the full thread); opening the
 *   thread marks the other side's messages read and pushes `message:read`.
 */

const PREVIEW_MAX = 140;

function pairKey(a, b) {
  return pairOf(a, b).join(':');
}

function pairOf(a, b) {
  return [String(a), String(b)].sort();
}

function isAnon(message, conversation) {
  return Boolean(message.isAnonymous || conversation?.isAnonymous);
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: String(user._id ?? user.id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

/**
 * The single message serializer used by REST responses AND socket fan-out
 * (plan 10.4). `isMine` is per-viewer — call once per recipient so each side
 * gets its own flag.
 */
function serializeMessage(message, conversation, viewerId, sender) {
  const anonymous = isAnon(message, conversation);
  return {
    id: String(message._id),
    conversationId: String(message.conversationId),
    content: message.content,
    isAnonymous: anonymous,
    isMine: String(message.senderId) === String(viewerId),
    senderId: anonymous ? null : String(message.senderId),
    sender: anonymous ? null : sender || null,
    readAt: message.readAt || null,
    createdAt: message.createdAt,
  };
}

/** 404 for missing OR not-a-participant — never leak thread existence. */
async function loadConversation(conversationId, userId) {
  const conversation = await Conversation.findById(conversationId).lean();
  const isParticipant =
    conversation &&
    conversation.participantIds.some((id) => String(id) === String(userId));
  if (!isParticipant) {
    throw new NotFoundError('Conversation not found', {
      code: 'CONVERSATION_NOT_FOUND',
    });
  }
  return conversation;
}

function otherParticipantId(conversation, userId) {
  return String(
    conversation.participantIds.find((id) => String(id) !== String(userId)),
  );
}

/** Batch sender profiles for a page — one User query, never N+1 (§8.4). */
async function loadSenders(messages, convById) {
  const ids = [
    ...new Set(
      messages
        .filter((m) => {
          const conversation = convById.get(String(m.conversationId));
          return conversation && !isAnon(m, conversation);
        })
        .map((m) => String(m.senderId)),
    ),
  ];
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } })
    .select('username displayName profilePhotoUrl')
    .lean();
  return new Map(users.map((u) => [String(u._id), publicUser(u)]));
}

/**
 * Marks the other side's unread messages read and (best-effort) pushes
 * `message:read` to them. In an anonymous thread the reader's id is omitted
 * so the event cannot deanonymize anyone (plan 10.4).
 */
async function markConversationRead(conversation, readerId) {
  const now = new Date();
  const result = await Message.updateMany(
    {
      conversationId: conversation._id,
      senderId: { $ne: readerId },
      readAt: null,
    },
    { $set: { readAt: now } },
  );
  if (result.modifiedCount > 0) {
    emitToUser(otherParticipantId(conversation, readerId), 'message:read', {
      conversationId: String(conversation._id),
      readAt: now,
      ...(conversation.isAnonymous ? {} : { readerId: String(readerId) }),
    });
  }
  return result.modifiedCount;
}

/** Socket `message:read` entry point — loads, checks membership, marks. */
async function markRead(user, conversationId) {
  const conversation = await loadConversation(conversationId, user.id);
  return markConversationRead(conversation, user.id);
}

async function sendMessage(user, conversationId, { content, isAnonymous }) {
  const conversation = await loadConversation(conversationId, user.id);
  // a per-message toggle can only ADD anonymity to a named thread, never
  // reveal an anonymous thread's identities
  const anonymous = Boolean(conversation.isAnonymous || isAnonymous);

  const message = await Message.create({
    conversationId: conversation._id,
    senderId: user.id,
    content,
    isAnonymous: anonymous,
  });
  await Conversation.updateOne(
    { _id: conversation._id },
    { $set: { lastMessageAt: message.createdAt } },
  );

  const senders = await loadSenders([message], new Map([[String(conversation._id), conversation]]));
  const sender = senders.get(String(message.senderId)) || null;

  // Fan out per participant so `isMine` is right for each viewer.
  for (const participantId of conversation.participantIds) {
    emitToUser(String(participantId), 'message:new', serializeMessage(
      message,
      conversation,
      String(participantId),
      sender,
    ));
  }

  return serializeMessage(message, conversation, user.id, sender);
}

async function listMessages(user, conversationId, query = {}) {
  const conversation = await loadConversation(conversationId, user.id);
  const limit = query.limit ?? 30;

  const filter = { conversationId: conversation._id };
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const docs = await Message.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];

  // Opening the thread reads receipts for everything newer (plan 74 UX);
  // idempotent for older-page fetches (readAt: null filter).
  await markConversationRead(conversation, user.id);

  const senders = await loadSenders(
    page,
    new Map([[String(conversation._id), conversation]]),
  );
  return {
    items: page.map((m) =>
      serializeMessage(m, conversation, user.id, senders.get(String(m.senderId)) || null),
    ),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
  };
}

async function createOrGetConversation(user, { userId, isAnonymous }) {
  if (String(userId) === String(user.id)) {
    throw new ValidationError('Cannot start a conversation with yourself', {
      code: 'SELF_CONVERSATION',
      details: [{ field: 'userId', message: 'must be another user', code: 'custom' }],
    });
  }
  const other = await User.findById(userId).select('username displayName profilePhotoUrl').lean();
  if (!other) {
    throw new NotFoundError('User not found', { code: 'USER_NOT_FOUND' });
  }

  const key = pairKey(user.id, userId);
  const existing = await Conversation.findOne({ pairKey: key }).lean();
  if (existing) {
    return { conversation: (await buildRows([existing], user.id))[0], created: false };
  }

  let conversation;
  try {
    conversation = await Conversation.create({
      participantIds: pairOf(user.id, userId),
      pairKey: key,
      isAnonymous: Boolean(isAnonymous),
      lastMessageAt: new Date(),
    });
  } catch (err) {
    if (err?.code === 11000) {
      const winner = await Conversation.findOne({ pairKey: key }).lean();
      if (winner) return { conversation: (await buildRows([winner], user.id))[0], created: false };
    }
    throw err;
  }
  return { conversation: (await buildRows([conversation.toObject()], user.id))[0], created: true };
}

async function listConversations(user, query = {}) {
  const limit = query.limit ?? 20;
  const filter = { participantIds: user.id };
  if (query.cursor) filter.lastMessageAt = { $lt: new Date(query.cursor) };

  const docs = await Conversation.find(filter)
    .sort({ lastMessageAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];

  return {
    items: await buildRows(page, user.id),
    nextCursor: hasMore && last ? new Date(last.lastMessageAt).toISOString() : null,
  };
}

/**
 * Inbox rows: other participant, last-message preview, unread count (§5) —
 * batched across the whole page (one aggregate each + one User query, §8.4).
 */
async function buildRows(conversations, viewerId) {
  if (!conversations.length) return [];

  const convIds = conversations.map((c) => c._id);
  const convById = new Map(conversations.map((c) => [String(c._id), c]));

  const lastRows = await Message.aggregate([
    { $match: { conversationId: { $in: convIds } } },
    { $sort: { createdAt: -1 } },
    { $group: { _id: '$conversationId', doc: { $first: '$$ROOT' } } },
  ]);
  const unreadRows = await Message.aggregate([
    {
      $match: {
        conversationId: { $in: convIds },
        senderId: { $ne: new mongoose.Types.ObjectId(String(viewerId)) },
        readAt: null,
      },
    },
    { $group: { _id: '$conversationId', count: { $sum: 1 } } },
  ]);
  const lastById = new Map(lastRows.map((r) => [String(r._id), r.doc]));
  const unreadById = new Map(unreadRows.map((r) => [String(r._id), r.count]));

  // other participants — only looked up for named threads (anonymous threads
  // hide the counterpart's identity from BOTH sides, plan 10.4)
  const otherIds = conversations
    .filter((c) => !c.isAnonymous)
    .map((c) => c.participantIds.find((id) => String(id) !== String(viewerId)))
    .filter(Boolean);
  const others = otherIds.length
    ? await User.find({ _id: { $in: otherIds } })
        .select('username displayName profilePhotoUrl')
        .lean()
    : [];
  const othersById = new Map(others.map((u) => [String(u._id), publicUser(u)]));

  const senders = await loadSenders([...lastById.values()], convById);

  return conversations.map((c) => {
    const convId = String(c._id);
    const otherId = c.participantIds.find((id) => String(id) !== String(viewerId));
    const lastMessage = lastById.get(convId) || null;

    let preview = lastMessage
      ? serializeMessage(
          lastMessage,
          c,
          viewerId,
          senders.get(String(lastMessage.senderId)) || null,
        )
      : null;
    if (preview && preview.content.length > PREVIEW_MAX) {
      preview = { ...preview, content: preview.content.slice(0, PREVIEW_MAX) };
    }

    return {
      id: convId,
      isAnonymous: Boolean(c.isAnonymous),
      lastMessageAt: c.lastMessageAt,
      createdAt: c.createdAt,
      otherUser: c.isAnonymous ? null : othersById.get(String(otherId)) || null,
      lastMessage: preview,
      unreadCount: unreadById.get(convId) || 0,
    };
  });
}

module.exports = {
  createOrGetConversation,
  listConversations,
  listMessages,
  sendMessage,
  markRead,
  loadConversation,
  markConversationRead,
  serializeMessage,
};
