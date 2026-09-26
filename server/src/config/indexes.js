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
];
