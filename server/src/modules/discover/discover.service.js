'use strict';

const { NotFoundError } = require('../../errors');
const { logger } = require('../../config/logger');
const { isRedisUp, getRedis } = require('../../config/redis');
const { feedScope, publicScope } = require('../../queries/content-scope');
const { serializeFeedItem } = require('../../serializers/feed-item.serializer');
const repo = require('./discover.repository');

/**
 * Discovery & feed service (Phase 5, plan steps 53-55).
 *
 * - One cursor shape everywhere: sort createdAt desc, ISO `nextCursor`,
 *   `limit + 1` fetch → hasMore (same pattern as story.listByAuthor).
 * - No N+1 (§8.4): authors are batch-loaded in one query per page; anonymous
 *   poems resolve to `author: null`.
 * - Trending is fully precomputed (§8.6): the BullMQ job denormalizes
 *   `trendingScore` on the poem; this read path never scans+scores (§10.75).
 *   Redis caches the serialized top-N for TRENDING_TTL_SECONDS; when Redis is
 *   down the same read falls back to the denormalized index (��0.5 contract).
 */
const DEFAULT_LIMIT = 20;
const TRENDING_TOP_N = 50;
const TRENDING_TTL_SECONDS = 60;
const TRENDING_CACHE_KEY = 'trending:global';
const TRENDING_WINDOW_DAYS = 7;

function pageArgs({ cursor, limit } = {}) {
  return { cursor: cursor ?? null, limit: limit ?? DEFAULT_LIMIT };
}

/** limit+1 fetch → slice → cursor of the last kept row (stories pattern). */
async function fetchPage(filter, { cursor, limit }) {
  const f = { ...filter };
  if (cursor) f.createdAt = { $lt: new Date(cursor) };
  const rows = await repo.findPoems(f, { limit: limit + 1 });
  const hasMore = rows.length > limit;
  const kept = hasMore ? rows.slice(0, limit) : rows;
  return {
    rows: kept,
    nextCursor: hasMore && kept.length ? kept[kept.length - 1].createdAt.toISOString() : null,
  };
}

function serializeAuthor(user) {
  return {
    id: String(user._id),
    username: user.username,
    displayName: user.displayName,
    profilePhotoUrl: user.profilePhotoUrl || '',
  };
}

/** Batch author lookup for a page (§8.4 — one User query, never per item). */
async function serializeItems(poems) {
  const ids = [
    ...new Set(
      poems.filter((p) => !p.anonymous && p.authorId).map((p) => String(p.authorId)),
    ),
  ];
  const authors = await repo.findAuthors(ids);
  const byId = new Map(authors.map((a) => [String(a._id), a]));
  return poems.map((p) => {
    const author = p.anonymous ? null : byId.get(String(p.authorId)) || null;
    return serializeFeedItem('poem', p, author ? serializeAuthor(author) : null);
  });
}

/** Following feed (plan 53.2): authors the requester follows, published only. */
async function getFeed(userId, query) {
  const followees = await repo.findFolloweeIds(userId);
  if (!followees.length) return { items: [], nextCursor: null };
  const { rows, nextCursor } = await fetchPage(
    {
      authorId: { $in: followees },
      ...feedScope(),
    },
    pageArgs(query),
  );
  return { items: await serializeItems(rows), nextCursor };
}

/** Mood discovery (plan 53.1) — public published poems carrying the mood. */
async function getByMood(mood, query) {
  const { rows, nextCursor } = await fetchPage(
    { moods: mood, ...publicScope() },
    pageArgs(query),
  );
  return { items: await serializeItems(rows), nextCursor };
}

/** Tag discovery (plan 53.1) — public published poems carrying the tag. */
async function getByTag(tag, query) {
  const { rows, nextCursor } = await fetchPage(
    { tags: tag, ...publicScope() },
    pageArgs(query),
  );
  return { items: await serializeItems(rows), nextCursor };
}

async function readTrendingCache() {
  if (!isRedisUp()) return null;
  try {
    const raw = await getRedis().get(TRENDING_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logger.warn(
      { event: 'discover:trending-cache-read-failed', err: err.message },
      'Trending cache read failed - falling back to Mongo',
    );
    return null;
  }
}

async function writeTrendingCache(payload) {
  if (!isRedisUp()) return;
  try {
    await getRedis().set(TRENDING_CACHE_KEY, JSON.stringify(payload), {
      EX: TRENDING_TTL_SECONDS,
    });
  } catch (err) {
    logger.warn(
      { event: 'discover:trending-cache-write-failed', err: err.message },
      'Trending cache write failed - next read re-computes',
    );
  }
}

async function invalidateTrendingCache() {
  if (!isRedisUp()) return;
  try {
    await getRedis().del(TRENDING_CACHE_KEY);
  } catch (err) {
    logger.warn(
      { event: 'discover:trending-cache-invalidate-failed', err: err.message },
      'Trending cache invalidation failed - TTL will expire it',
    );
  }
}

/**
 * Trending (plan 53.3): Redis-serialized payload for TTL_SECONDS, else the
 * denormalized `trendingScore` index. Never scans+scores at request time.
 */
async function getTrending(query) {
  const cached = await readTrendingCache();
  if (cached && Array.isArray(cached.items)) return cached;
  const { limit } = pageArgs(query);
  const rows = await repo.findTrendingTop(Math.min(limit, TRENDING_TOP_N));
  const items = await serializeItems(rows);
  const payload = { items, nextCursor: null, generatedAt: new Date().toISOString() };
  await writeTrendingCache(payload);
  return payload;
}

/** Random (plan 53): uniform skip over the published-public index order. */
async function getRandom() {
  const count = await repo.countPublicPublished();
  if (!count) {
    throw new NotFoundError('Nothing published yet', { code: 'DISCOVER_EMPTY' });
  }
  const skip = Math.floor(Math.random() * count);
  const row = (await repo.findPublicPublishedAt(skip)) || (await repo.findPublicPublishedAt(0));
  if (!row) {
    throw new NotFoundError('Nothing published yet', { code: 'DISCOVER_EMPTY' });
  }
  const [item] = await serializeItems([row]);
  return item;
}

/**
 * The trending refresh itself — called by the BullMQ job (every 5 min) and
 * directly by tests. Formula (§8.6): reactions×3 + comments×2 + saves×2 +
 * reads, over public published poems from the last TRENDING_WINDOW_DAYS.
 * Logs duration + record count (plan step 55), then busts the Redis payload.
 */
async function runTrendingRefresh() {
  const startedAt = Date.now();
  const cutoff = new Date(Date.now() - TRENDING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  await repo.resetTrendingScores();
  const candidates = await repo.findTrendingCandidates(cutoff);
  const records = await repo.applyTrendingScores(candidates);
  await invalidateTrendingCache();
  const durationMs = Date.now() - startedAt;
  logger.info(
    {
      event: 'trending:refreshed',
      durationMs,
      records,
      windowDays: TRENDING_WINDOW_DAYS,
    },
    'Trending refresh complete',
  );
  return { durationMs, records };
}

module.exports = {
  getFeed,
  getByMood,
  getByTag,
  getTrending,
  getRandom,
  runTrendingRefresh,
};
