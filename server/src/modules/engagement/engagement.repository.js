'use strict';

const mongoose = require('mongoose');
const { Reaction } = require('./reaction.model');
const { FeltGoodRating } = require('./felt-good-rating.model');
const { Comment } = require('./comment.model');
const { Save } = require('./save.model');

/**
 * Engagement repository — the only layer that talks to the engagement
 * collections. Counter moves on `poems.stats` go through poemRepository.incStats
 * ($inc-only — plan step 46 / §8.19: never read-modify-write).
 */

// --- reactions ---

async function findReaction({ targetType, targetId, userId, type }) {
  return Reaction.findOne({ targetType, targetId, userId, type }).lean();
}

async function createReaction(data) {
  return Reaction.create(data);
}

async function deleteReaction({ targetType, targetId, userId, type }) {
  return Reaction.deleteOne({ targetType, targetId, userId, type });
}

/** All types this user chose on a target (reactions are multi-select). */
async function listMyReactionTypes({ targetType, targetId, userId }) {
  const rows = await Reaction.find({ targetType, targetId, userId })
    .select('type')
    .lean();
  return rows.map((r) => r.type);
}

/** Per-type reaction counts for one target — single grouped aggregate (§8.4). */
async function reactionCountsByType({ targetType, targetId }) {
  const rows = await Reaction.aggregate([
    { $match: { targetType, targetId: new mongoose.Types.ObjectId(String(targetId)) } },
    { $group: { _id: '$type', count: { $sum: 1 } } },
  ]);
  const counts = {};
  for (const row of rows) counts[row._id] = row.count;
  return counts;
}

// --- felt good ratings ---

async function findRating(poemId, userId) {
  return FeltGoodRating.findOne({ poemId, userId }).lean();
}

async function createRating({ poemId, userId, score, comment }) {
  return FeltGoodRating.create({ poemId, userId, score, comment });
}

async function updateRating(poemId, userId, fields) {
  return FeltGoodRating.findOneAndUpdate(
    { poemId, userId },
    { $set: fields },
    { new: true, runValidators: true },
  ).lean();
}

/** Average + count for one poem — single aggregate, never N per-read. */
async function feltGoodSummary(poemId) {
  const rows = await FeltGoodRating.aggregate([
    { $match: { poemId: new mongoose.Types.ObjectId(String(poemId)) } },
    { $group: { _id: null, count: { $sum: 1 }, average: { $avg: '$score' } } },
  ]);
  if (rows.length === 0) return { average: null, count: 0 };
  return { average: Math.round(rows[0].average * 10) / 10, count: rows[0].count };
}

// --- comments ---

async function createComment(data) {
  return Comment.create(data);
}

async function findCommentById(id, { select } = {}) {
  let q = Comment.findById(id);
  if (select) q = q.select(select);
  return q.exec();
}

/** Top-level page, ascending by createdAt (`after` = cursor). */
async function listTopLevelComments({ targetType, targetId, after, limit }) {
  const filter = { targetType, targetId, parentCommentId: null, status: 'active' };
  if (after != null) filter.createdAt = { $gt: new Date(after) };
  return Comment.find(filter)
    .sort({ createdAt: 1 })
    .limit(limit)
    .select('targetType targetId authorId anonymous parentCommentId content status createdAt')
    .lean();
}

/**
 * Replies for a page of top-level ids in ONE aggregate (§8.4 — not per comment):
 * exact replyCount plus up to `cap` reply docs per parent, oldest first.
 */
async function listRepliesGrouped({ targetType, targetId, parentIds, cap = 50 }) {
  const rows = await Comment.aggregate([
    {
      $match: {
        targetType,
        targetId: new mongoose.Types.ObjectId(String(targetId)),
        parentCommentId: { $in: parentIds },
        status: 'active',
      },
    },
    { $sort: { createdAt: 1 } },
    {
      $group: {
        _id: '$parentCommentId',
        count: { $sum: 1 },
        docs: { $push: '$$ROOT' },
      },
    },
  ]);
  const out = new Map();
  for (const row of rows) {
    out.set(String(row._id), { count: row.count, docs: row.docs.slice(0, cap) });
  }
  return out;
}

/** Atomic active→removed transition; returns whether this call did the flip. */
async function softDeleteComment(id) {
  const res = await Comment.updateOne({ _id: id, status: 'active' }, { $set: { status: 'removed' } });
  return res.modifiedCount === 1;
}

// --- saves ---

async function findSave(userId, poemId) {
  return Save.findOne({ userId, poemId }).lean();
}

async function createSave(userId, poemId) {
  return Save.create({ userId, poemId });
}

async function deleteSave(userId, poemId) {
  return Save.deleteOne({ userId, poemId });
}

module.exports = {
  findReaction,
  createReaction,
  deleteReaction,
  listMyReactionTypes,
  reactionCountsByType,
  findRating,
  createRating,
  updateRating,
  feltGoodSummary,
  createComment,
  findCommentById,
  listTopLevelComments,
  listRepliesGrouped,
  softDeleteComment,
  findSave,
  createSave,
  deleteSave,
};
