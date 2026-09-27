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
  // Phase 5: trending job window match + denormalized-score fallback read
  { collection: 'poems', key: { status: 1, visibility: 1, createdAt: -1 } },
  { collection: 'poems', key: { status: 1, visibility: 1, trendingScore: -1 } },
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

  // engagement (Phase 3)
  // one save per user per poem — backs the idempotent toggle
  { collection: 'saves', key: { userId: 1, poemId: 1 }, options: { unique: true } },
  // comment thread page (top-level) + reply batch share this compound
  { collection: 'comments', key: { targetType: 1, targetId: 1, parentCommentId: 1, createdAt: 1 } },

  // Phase 9 — duels, prompts, remixes (plan steps 68-70)
  // duel list pagination + the /poems/mine picker (own rows, newest first)
  { collection: 'duels', key: { createdAt: -1 } },
  { collection: 'poems', key: { authorId: 1, createdAt: -1 } },
  // one vote per user per duel — the arbiter behind the $inc + rollback
  { collection: 'duelvotes', key: { duelId: 1, userId: 1 }, options: { unique: true } },
  // current-prompt lookup + one submission per (prompt, user)
  { collection: 'prompts', key: { weekOf: -1 } },
  { collection: 'promptsubmissions', key: { promptId: 1, userId: 1 }, options: { unique: true } },
  { collection: 'promptsubmissions', key: { promptId: 1, createdAt: -1 } },
  // attribution edge — at most one link per (original, remix) pair
  { collection: 'remixes', key: { originalPoemId: 1, remixPoemId: 1 }, options: { unique: true } },
  { collection: 'remixes', key: { remixPoemId: 1 } },

  // messaging (Phase 10 — plan steps 72-74, §3.19/§4)
  // one thread per user pair (sorted ids; scalar key — a unique multikey
  // index on the array itself would enforce uniqueness per ELEMENT)
  { collection: 'conversations', key: { pairKey: 1 }, options: { unique: true } },
  // inbox listing: my threads, newest activity first
  { collection: 'conversations', key: { participantIds: 1, lastMessageAt: -1 } },
  // messages index above: { conversationId: 1, createdAt: -1 } (§4)
  // unread counts per conversation in the inbox
  { collection: 'messages', key: { conversationId: 1, senderId: 1, readAt: 1 } },
];
