'use strict';

const { randomUUID } = require('crypto');
const mongoose = require('mongoose');
const { NotFoundError } = require('../../errors');
const { Poem } = require('../poems/poem.model');
const { canView } = require('../poems/poem.service');
const { ReadingActivity } = require('./reading-activity.model');
const { Reaction } = require('../engagement/reaction.model');
const { Comment } = require('../engagement/comment.model');
const { Save } = require('../engagement/save.model');
const { Follow } = require('../users/follow.model');
// Namespace-style require: services call `analyticsDispatcher.dispatch…`
// (not a destructured binding) so tests can jest.spyOn the module.
const analyticsDispatcher = require('./analytics.dispatcher');

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC calendar day, 'YYYY-MM-DD' - the bucket key for every series. */
function utcDay(date) {
  return date.toISOString().slice(0, 10);
}

function startOfUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Read logging (plan step 82). The request does ONE indexed visibility
 * check (fail-closed 404 via the shared matrix - never leaks existence),
 * then enqueues - the row insert + stats bump happen in the worker, so
 * analytics never runs synchronously on the read path (§10.18/§8.14).
 *
 * `eventKey` embeds a fresh uuid: BullMQ retries of THIS job reuse the
 * id (deterministic jobId) and the worker's unique index folds them into
 * a single counted read (§8.15). Distinct reads stay distinct events.
 */
async function logReadingActivity(poemId, requester, opts = {}) {
  const poem = await Poem.findById(poemId)
    .select('authorId status visibility')
    .lean();
  if (!poem) throw new NotFoundError('Poem not found', { code: 'POEM_NOT_FOUND' });
  if (!(await canView(poem, requester))) {
    throw new NotFoundError('Poem not found', { code: 'POEM_NOT_FOUND' });
  }

  const eventKey = `read:${poemId}:${requester?.id || 'anon'}:${randomUUID()}`;
  const input = {
    poemId,
    readerId: requester?.id || null,
    eventKey,
  };
  // Reader-supplied UTC offset (plan step 85) - omitted when absent/invalid
  // so the worker falls back to UTC days.
  if (Number.isFinite(opts.tzOffsetMinutes)) input.tzOffsetMinutes = opts.tzOffsetMinutes;
  const result = await analyticsDispatcher.dispatchReadingActivity(input);
  return { queued: result.queued, reason: result.reason || null, jobId: result.jobId || null };
}

function countByDay(rows) {
  const map = new Map();
  for (const row of rows) map.set(row._id, row.count);
  return map;
}

function seriesByDay(model, match) {
  return model.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
  ]);
}

/**
 * Aggregation pipelines are NOT schema-cast by Mongoose — a string id in
 * `$match` would compare against ObjectId fields and silently match
 * NOTHING. Cast every id before it reaches .aggregate() (caught by the
 * Phase 12 bucket tests: reads/followers series came back all-zero).
 */
function oid(value) {
  return new mongoose.Types.ObjectId(String(value));
}

/**
 * Writer dashboard aggregation (plan step 83). Deliberately ON-DEMAND:
 * profiled with `explain("executionStats")` (Phase 12 gate) - the query is
 * a handful of indexed range/group stages over at most `days` buckets of a
 * single author's rows (low ms, ~100s of docs at expected volume), so a
 * precomputed BullMQ aggregate would add queue + staleness complexity for
 * no measurable gain. Revisit if p95 creeps past the §8.21 budget.
 *
 * Returns zero-filled ascending daily buckets so the dashboard can render
 * a stable table (and a brand-new writer sees honest zeros, not gaps).
 */
async function getWriterAnalytics(userId, { days = 30 } = {}) {
  const today = startOfUtcDay(new Date());
  const from = new Date(today.getTime() - (days - 1) * DAY_MS);
  const range = { $gte: from };
  const authorOid = oid(userId);

  const authorPoems = await Poem.find({ authorId: authorOid, status: { $ne: 'removed' } })
    .select('_id')
    .lean();
  const poemIds = authorPoems.map((p) => p._id);
  const hasPoems = poemIds.length > 0;

  const [
    poemTotal,
    readRows,
    reactionRows,
    commentRows,
    saveRows,
    followRows,
    readsTotal,
    reactionsTotal,
    commentsTotal,
    savesTotal,
    followersTotal,
  ] = await Promise.all([
    Poem.countDocuments({ authorId: authorOid, status: { $ne: 'removed' } }),
    seriesByDay(ReadingActivity, { authorId: authorOid, createdAt: range }),
    hasPoems
      ? seriesByDay(Reaction, { targetType: 'poem', targetId: { $in: poemIds }, createdAt: range })
      : Promise.resolve([]),
    hasPoems
      ? seriesByDay(Comment, {
          targetType: 'poem',
          targetId: { $in: poemIds },
          status: 'active',
          createdAt: range,
        })
      : Promise.resolve([]),
    hasPoems
      ? seriesByDay(Save, { poemId: { $in: poemIds }, createdAt: range })
      : Promise.resolve([]),
    seriesByDay(Follow, { followingId: authorOid, createdAt: range }),
    ReadingActivity.countDocuments({ authorId: authorOid }),
    hasPoems
      ? Reaction.countDocuments({ targetType: 'poem', targetId: { $in: poemIds } })
      : 0,
    hasPoems
      ? Comment.countDocuments({ targetType: 'poem', targetId: { $in: poemIds }, status: 'active' })
      : 0,
    hasPoems ? Save.countDocuments({ poemId: { $in: poemIds } }) : 0,
    Follow.countDocuments({ followingId: authorOid }),
  ]);

  const by = {
    reads: countByDay(readRows),
    reactions: countByDay(reactionRows),
    comments: countByDay(commentRows),
    saves: countByDay(saveRows),
    followers: countByDay(followRows),
  };

  const daysOut = [];
  for (let i = 0; i < days; i++) {
    const date = utcDay(new Date(from.getTime() + i * DAY_MS));
    daysOut.push({
      date,
      reads: by.reads.get(date) || 0,
      reactions: by.reactions.get(date) || 0,
      comments: by.comments.get(date) || 0,
      saves: by.saves.get(date) || 0,
      followers: by.followers.get(date) || 0,
    });
  }

  return {
    range: { from: utcDay(from), to: utcDay(today), days },
    totals: {
      poems: poemTotal,
      reads: readsTotal,
      reactions: reactionsTotal,
      comments: commentsTotal,
      saves: savesTotal,
      followers: followersTotal,
    },
    days: daysOut,
  };
}

module.exports = { logReadingActivity, getWriterAnalytics };
