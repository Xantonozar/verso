'use strict';

const { isModerator } = require('../middleware/authz');

/**
 * Shared content-visibility query scope (Phase 14, plan step 88).
 *
 * Every module's LIST/FEED reads compose their filters from here instead of
 * re-deriving `status`/`visibility` literals per endpoint — a missed spot in that
 * duplication is a real content-leak bug class (soft-removed or unpublished
 * rows reappearing in some list nobody remembered to patch).
 *
 * Rules encoded once:
 * - `removed` never appears for anyone but the author/moderator (soft-delete,
 *   plan step 38).
 * - Public reads are `published` (+ `public` visibility for poems/stories
 *   that carry a separate visibility field).
 * - Stories encode visibility in `status` alone (no `visibility` field),
 *   hence the `kind` switch.
 *
 * Single-document reads keep using each module's `canView` (relationship-
 * aware: followers edge, unlisted, private) — this helper is for filters.
 */

/** Soft-deleted rows: author/moderator recovery reads only. */
function notRemoved() {
  return { status: { $ne: 'removed' } };
}

/**
 * The requester-independent public scope for one kind of content:
 *   poem  → { status: 'published', visibility: 'public' }
 *   story → { status: 'published' } (story status IS its visibility)
 */
function publicScope(kind = 'poem') {
  if (kind === 'story') return { status: 'published' };
  return { status: 'published', visibility: 'public' };
}

/** Following feed (poems): published rows, public + followers-only. */
function feedScope() {
  return { status: 'published', visibility: { $in: ['public', 'followers'] } };
}

/**
 * Listing one author's content: the author and moderators see everything
 * except soft-deleted rows; everyone else sees only the public scope.
 */
function authorScope(kind, requester, ownerId) {
  const isSelf = requester?.id != null && String(requester.id) === String(ownerId);
  if (isSelf || isModerator(requester)) return notRemoved();
  return publicScope(kind);
}

module.exports = { notRemoved, publicScope, feedScope, authorScope };
