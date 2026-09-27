'use strict';

const { Poem } = require('../poems/poem.model');
const { Follow } = require('../users/follow.model');
const { User } = require('../users/user.model');

/**
 * Discover repository — the only layer that queries poems/follows for
 * feed + discovery (Phase 5). Every read passes POEM_SELECT (��10.2: explicit
 * projection) and the filters are built by the service so each endpoint maps
 * to one §4 index:
 *   feed   → { authorId, status, createdAt }
 *   mood   → { moods, status, visibility, createdAt }
 *   tag    → { tags, status, createdAt } (visibility residual, still IXSCAN)
 *   trend  → { status, visibility, trendingScore } (denormalized, §8.6)
 */
const POEM_SELECT =
  '_id title content language moods tags anonymous status stats publishedAt createdAt updatedAt authorId';

async function findFolloweeIds(followerId) {
  const rows = await Follow.find({ followerId }).select('followingId -_id').lean();
  return rows.map((r) => r.followingId);
}

async function findPoems(filter, { limit, sort = { createdAt: -1 } } = {}) {
  let q = Poem.find(filter).select(POEM_SELECT).sort(sort);
  if (limit) q = q.limit(limit);
  return q.lean();
}

async function findAuthors(ids) {
  if (!ids.length) return [];
  return User.find({ _id: { $in: ids } })
    .select('username displayName profilePhotoUrl')
    .lean();
}

async function countPublicPublished() {
  return Poem.countDocuments({ status: 'published', visibility: 'public' });
}

/** Random pick — skip over an index-ordered scan (no COLLSCAN, no $sample). */
async function findPublicPublishedAt(skip) {
  const rows = await Poem.find({ status: 'published', visibility: 'public' })
    .select(POEM_SELECT)
    .skip(skip)
    .limit(1)
    .lean();
  return rows[0] || null;
}

async function findTrendingTop(limit) {
  return Poem.find({ status: 'published', visibility: 'public' })
    .select(POEM_SELECT)
    .sort({ trendingScore: -1 })
    .limit(limit)
    .lean();
}

/** Trending refresh (job path) — zero stale scores, then windowed aggregate. */
async function resetTrendingScores() {
  const res = await Poem.updateMany(
    { status: 'published', trendingScore: { $ne: 0 } },
    { $set: { trendingScore: 0 } },
  );
  return res.modifiedCount;
}

async function findTrendingCandidates(cutoff) {
  return Poem.aggregate([
    {
      $match: {
        status: 'published',
        visibility: 'public',
        createdAt: { $gte: cutoff },
      },
    },
    {
      $project: {
        score: {
          $add: [
            { $multiply: ['$stats.reactionCount', 3] },
            { $multiply: ['$stats.commentCount', 2] },
            { $multiply: ['$stats.saveCount', 2] },
            { $ifNull: ['$stats.reads', 0] },
          ],
        },
      },
    },
  ]);
}

async function applyTrendingScores(candidates) {
  if (!candidates.length) return 0;
  await Poem.bulkWrite(
    candidates.map((c) => ({
      updateOne: { filter: { _id: c._id }, update: { $set: { trendingScore: c.score } } },
    })),
    { ordered: false },
  );
  return candidates.length;
}

module.exports = {
  findFolloweeIds,
  findPoems,
  findAuthors,
  countPublicPublished,
  findPublicPublishedAt,
  findTrendingTop,
  resetTrendingScores,
  findTrendingCandidates,
  applyTrendingScores,
};
