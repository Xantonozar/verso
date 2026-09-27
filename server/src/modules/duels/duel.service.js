'use strict';

const { NotFoundError, ConflictError, ValidationError } = require('../../errors');
const { Duel } = require('./duel.model');
const { DuelVote } = require('./duel-vote.model');
const { Poem } = require('../poems/poem.model');
const { getPoem } = require('../poems/poem.service');
const notificationsDispatcher = require('../notifications/notifications.dispatcher');

/**
 * Duel service (plan step 68):
 *
 * - The effective phase is derived from the deadlines on every read, so a
 *   stale `status` row can never reopen a closed vote.
 * - Voting: conditional `$inc` guarded by the deadline window (single atomic
 *   document update), then insert the vote — the unique `(duelId, userId)`
 *   index is the real arbiter; on 11000 the increment is rolled back, so
 *   `votes` always equals the number of committed votes.
 * - Poem visibility for pairing: both poems must be published AND
 *   public/unlisted (requester-independent), owned by different poets. All
 *   links are re-derived from the DB, never trusted from the body.
 */

const notFound = () => new NotFoundError('Duel not found', { code: 'DUEL_NOT_FOUND' });

const VIEWABLE_VISIBILITIES = ['public', 'unlisted'];

/** Effective phase from the deadlines — single source of truth (plan 68). */
function effectiveStatus(duel, now = new Date()) {
  const t = now.getTime();
  if (t < new Date(duel.submissionDeadline).getTime()) return 'open';
  if (t < new Date(duel.votingDeadline).getTime()) return 'voting';
  return 'closed';
}

function serialize(duel, now = new Date()) {
  return {
    id: String(duel._id),
    theme: duel.theme,
    poetAId: String(duel.poetAId),
    poetBId: String(duel.poetBId),
    poemAId: String(duel.poemAId),
    poemBId: String(duel.poemBId),
    submissionDeadline: duel.submissionDeadline,
    votingDeadline: duel.votingDeadline,
    votes: { poemA: duel.votes?.poemA ?? 0, poemB: duel.votes?.poemB ?? 0 },
    status: effectiveStatus(duel, now),
    createdAt: duel.createdAt,
    updatedAt: duel.updatedAt,
  };
}

async function loadPairedPoem(poemId, field) {
  const poem = await Poem.findById(poemId)
    .select('authorId status visibility')
    .lean();
  if (!poem) {
    throw new NotFoundError('Paired poem not found', {
      code: 'POEM_NOT_FOUND',
      details: [{ field, message: 'poem does not exist', code: 'not_found' }],
    });
  }
  if (poem.status !== 'published' || !VIEWABLE_VISIBILITIES.includes(poem.visibility)) {
    throw new ValidationError('Paired poem is not publicly readable', {
      code: 'POEM_NOT_PUBLIC',
      details: [{ field, message: 'must be a published public poem', code: 'custom' }],
    });
  }
  return poem;
}

async function createDuel(user, input) {
  const [poemA, poemB] = await Promise.all([
    loadPairedPoem(input.poemAId, 'poemAId'),
    loadPairedPoem(input.poemBId, 'poemBId'),
  ]);
  if (String(poemA.authorId) === String(poemB.authorId)) {
    throw new ValidationError('A duel needs two different poets', {
      code: 'DUEL_SAME_POET',
      details: [{ field: 'poemBId', message: 'must belong to the other poet', code: 'custom' }],
    });
  }

  const now = new Date();
  const duel = await Duel.create({
    theme: input.theme,
    poetAId: poemA.authorId,
    poetBId: poemB.authorId,
    poemAId: poemA._id,
    poemBId: poemB._id,
    submissionDeadline: input.submissionDeadline,
    votingDeadline: input.votingDeadline,
    status: effectiveStatus({ ...input, createdAt: now }, now),
  });
  return serialize(duel, now);
}

async function listDuels(query = {}) {
  const limit = query.limit ?? 20;
  const filter = {};
  if (query.cursor) filter.createdAt = { $lt: new Date(query.cursor) };

  const docs = await Duel.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .lean();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;
  const last = page[page.length - 1];
  return {
    items: page.map((d) => serialize(d)),
    nextCursor: hasMore && last ? new Date(last.createdAt).toISOString() : null,
  };
}

async function getDuel(id, user) {
  const duel = await Duel.findById(id).lean();
  if (!duel) throw notFound();

  const [poemA, poemB] = await Promise.all([
    getPoem(String(duel.poemAId), user),
    getPoem(String(duel.poemBId), user),
  ]);
  const myVote = user
    ? await DuelVote.findOne({ duelId: duel._id, userId: user.id }).lean()
    : null;

  dispatchDuelResults(duel);

  return {
    ...serialize(duel),
    poemA,
    poemB,
    myVote: myVote ? myVote.votedFor : null,
  };
}

async function vote(id, user, { votedFor }) {
  const duel = await Duel.findById(id).lean();
  if (!duel) throw notFound();

  const phase = effectiveStatus(duel);
  if (phase === 'open') {
    throw new ConflictError('Voting has not opened yet', { code: 'DUEL_VOTING_NOT_OPEN' });
  }
  if (phase === 'closed') {
    throw new ConflictError('Voting has closed', { code: 'DUEL_CLOSED' });
  }

  const now = new Date();
  const field = votedFor === 'A' ? 'votes.poemA' : 'votes.poemB';
  // Atomic + deadline-guarded: even if the clock crossed votingDeadline after
  // the phase check above, matchedCount === 0 rejects the write.
  const res = await Duel.updateOne(
    { _id: duel._id, submissionDeadline: { $lte: now }, votingDeadline: { $gt: now } },
    { $inc: { [field]: 1 } },
  );
  if (res.matchedCount === 0) {
    throw new ConflictError('Voting has closed', { code: 'DUEL_CLOSED' });
  }

  try {
    await DuelVote.create({ duelId: duel._id, userId: user.id, votedFor });
  } catch (err) {
    if (err?.code === 11000) {
      await Duel.updateOne({ _id: duel._id }, { $inc: { [field]: -1 } });
      throw new ConflictError('You have already voted in this duel', {
        code: 'DUPLICATE_VOTE',
      });
    }
    throw err;
  }

  const updated = await Duel.findById(id).lean();
  dispatchDuelResults(updated);
  return { ...serialize(updated), myVote: votedFor };
}

/**
 * Duel result notifications (Phase 11 step 79). The deadline-derived design
 * has no close event, so this is dispatched from the read path (GET a closed
 * duel) and from a vote that lands after the deadline — both observed closures.
 * eventKey is per (duel, poet), so repeat observations are no-ops at the
 * queue, worker, and index layers. Never throws.
 */
function dispatchDuelResults(duel) {
  if (effectiveStatus(duel) !== 'closed') return { dispatched: false };
  for (const poetId of [duel.poetAId, duel.poetBId]) {
    notificationsDispatcher.dispatchNotification({
      recipientId: poetId,
      type: 'duel_result',
      relatedType: 'duel',
      relatedId: duel._id,
      eventKey: `duel_result:${duel._id}:${poetId}`,
      actor: null,
    });
  }
  return { dispatched: true };
}

module.exports = { createDuel, listDuels, getDuel, vote, effectiveStatus, dispatchDuelResults };
