'use strict';

const { NotFoundError, ForbiddenError, ConflictError, ValidationError } = require('../../errors');
const { CollabPoem } = require('./collab-poem.model');
const { User } = require('../users/user.model');
const notificationsDispatcher = require('../notifications/notifications.dispatcher');

/**
 * CollabPoem service (plan step 63): fixed-turn relay collaboration.
 *
 * Rules:
 * - Turns are append-only: `order` is derived from `turns.length` server-side
 *   (never taken from the body) and no turn edit/delete path exists.
 * - The line count per turn is derived from the content itself (normalize
 *   CRLF, drop one trailing newline, split) and must equal `linesPerTurn`
 *   exactly — the client never declares a count (plan step 63).
 * - Any authenticated writer may add a turn while `open`; only the creator
 *   may `finish` (the piece then rejects further turns with 409).
 */

const notFound = () =>
  new NotFoundError('Collab poem not found', { code: 'COLLAB_NOT_FOUND' });

/** Split turn content into lines: CRLF-normalized, one trailing newline dropped. */
function splitTurnLines(content) {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return normalized.split('\n');
}

function serializeAuthor(user) {
  if (!user) return null;
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

async function hydrateAuthors(turns) {
  const authorIds = [...new Set(turns.map((t) => String(t.authorId)))];
  if (authorIds.length === 0) return new Map();
  const users = await User.find({ _id: { $in: authorIds } });
  return new Map(users.map((u) => [String(u._id), u]));
}

async function serialize(collab) {
  const authors = await hydrateAuthors(collab.turns);
  return {
    id: String(collab._id),
    creatorId: String(collab.creatorId),
    title: collab.title,
    linesPerTurn: collab.linesPerTurn,
    status: collab.status,
    turnCount: collab.turns.length,
    turns: collab.turns.map((t) => ({
      order: t.order,
      lines: t.lines,
      author: serializeAuthor(authors.get(String(t.authorId))),
      createdAt: t.createdAt,
    })),
    createdAt: collab.createdAt,
    updatedAt: collab.updatedAt,
  };
}

async function createCollabPoem(user, { title, linesPerTurn }) {
  const collab = await CollabPoem.create({
    creatorId: user.id,
    title,
    linesPerTurn,
    status: 'open',
    turns: [],
  });
  return serialize(collab);
}

async function listCollabPoems(query = {}) {
  const limit = query.limit ?? 20;
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const docs = await CollabPoem.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];
  return {
    items: await Promise.all(page.map((d) => serialize(d))),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
  };
}

async function getCollabPoem(id) {
  const collab = await CollabPoem.findById(id);
  if (!collab) throw notFound();
  return serialize(collab);
}

async function addTurn(id, user, { content }) {
  const collab = await CollabPoem.findById(id);
  if (!collab) throw notFound();

  if (collab.status !== 'open') {
    throw new ConflictError('Collab poem is finished', { code: 'COLLAB_FINISHED' });
  }

  const lines = splitTurnLines(content);
  if (!content.trim()) {
    throw new ValidationError('Turn content cannot be blank', {
      details: [{ field: 'content', message: 'cannot be blank', code: 'custom' }],
    });
  }
  if (lines.length !== collab.linesPerTurn) {
    throw new ValidationError('Turn must contain the exact line count', {
      code: 'LINE_COUNT_MISMATCH',
      details: [
        {
          field: 'content',
          message: `expected ${collab.linesPerTurn} lines, got ${lines.length}`,
          code: 'line_count',
        },
      ],
    });
  }

  // Append-only: order = current length (server-derived, no trust in client)
  const order = collab.turns.length;
  collab.turns.push({
    authorId: user.id,
    lines: content,
    order,
    createdAt: new Date(),
  });
  await collab.save();

  // Creator notified when someone else extends their relay (Phase 11 step 79)
  if (String(collab.creatorId) !== String(user.id)) {
    notificationsDispatcher.dispatchNotification({
      recipientId: collab.creatorId,
      type: 'collab_turn',
      relatedType: 'collab_poem',
      relatedId: collab._id,
      eventKey: `collab_turn:${collab._id}:${order}:${user.id}`,
      actor: { id: user.id, displayName: user.displayName, username: user.username },
    });
  }

  return serialize(collab);
}

async function finishCollabPoem(id, user) {
  const collab = await CollabPoem.findById(id);
  if (!collab) throw notFound();
  if (String(collab.creatorId) !== String(user.id)) {
    throw new ForbiddenError('Only the creator can finish this collab poem', {
      code: 'FORBIDDEN',
    });
  }
  if (collab.status !== 'open') {
    throw new ConflictError('Collab poem is already finished', { code: 'COLLAB_FINISHED' });
  }
  collab.status = 'finished';
  await collab.save();
  return serialize(collab);
}

module.exports = {
  createCollabPoem,
  listCollabPoems,
  getCollabPoem,
  addTurn,
  finishCollabPoem,
  splitTurnLines,
};
