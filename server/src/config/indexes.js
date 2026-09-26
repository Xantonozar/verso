'use strict';

/**
 * §4 index plan — single source of truth consumed by scripts/init-indexes.js.
 * Keys mirror the query patterns in §4 (feeds, lookups, inbox). Collection
 * names match Mongoose's default pluralization of the model names used in
 * later phases (Poem → poems, CollaborationSegment → collaborationsegments …).
 *
 * Verified against the live `verso_dev` DB via MongoDB MCP (Phase 0.5 step 11).
 */
module.exports = [
  // users — unique constraints from §3.1 (username/email)
  { collection: 'users', key: { username: 1 }, options: { unique: true } },
  { collection: 'users', key: { email: 1 }, options: { unique: true } },
  { collection: 'poems', key: { authorId: 1, status: 1, createdAt: -1 } },
  { collection: 'poems', key: { moods: 1, status: 1, visibility: 1, createdAt: -1 } },
  { collection: 'poems', key: { tags: 1, status: 1, createdAt: -1 } },
  { collection: 'comments', key: { targetType: 1, targetId: 1, createdAt: -1 } },
  {
    collection: 'reactions',
    key: { targetType: 1, targetId: 1, userId: 1, type: 1 },
    options: { unique: true },
  },
  { collection: 'follows', key: { followerId: 1, followingId: 1 }, options: { unique: true } },
  { collection: 'follows', key: { followingId: 1 } },
  { collection: 'collaborationsegments', key: { ancestorPath: 1 } },
  { collection: 'collaborationsegments', key: { pieceId: 1, parentId: 1 } },
  { collection: 'messages', key: { conversationId: 1, createdAt: -1 } },
  { collection: 'notifications', key: { userId: 1, readAt: 1, createdAt: -1 } },
  { collection: 'feltgoodratings', key: { poemId: 1, userId: 1 }, options: { unique: true } },
  { collection: 'refreshtokens', key: { familyId: 1, status: 1 } },
  { collection: 'refreshtokens', key: { userId: 1 } },
  // refresh hot path — lookup by hash must be an IXSCAN, never a COLLSCAN (Phase 1)
  { collection: 'refreshtokens', key: { tokenHash: 1 }, options: { unique: true } },
  // poem version history pagination (Phase 2)
  { collection: 'poemversions', key: { poemId: 1, versionNumber: -1 } },

  // stories — profile list + public listing (Phase 2B)
  { collection: 'stories', key: { authorId: 1, status: 1, createdAt: -1 } },
  { collection: 'stories', key: { status: 1, createdAt: -1 } },
  // ordered chapter list (unique so a race can't mint duplicate positions)
  { collection: 'storychapters', key: { storyId: 1, chapterNumber: 1 }, options: { unique: true } },
  // story/chapter version history (chapterId absent = metadata snapshot)
  {
    collection: 'storyversions',
    key: { storyId: 1, chapterId: 1, versionNumber: -1 },
    options: { unique: true },
  },
];
