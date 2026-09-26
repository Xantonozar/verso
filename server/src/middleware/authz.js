'use strict';

const { AuthError, ForbiddenError, NotFoundError } = require('../errors');

/**
 * Authorization helpers (Phase 0.5 step 16). Thin, synchronous assertions for
 * controllers — throw-only, so they compose with asyncHandler (§7.1).
 *
 * Identity shape: req.user = { id: '…' } (roles merged in from Phase 2 on).
 */

function isModerator(user) {
  return user?.role === 'moderator' || user?.role === 'admin';
}

function requireUser(user) {
  if (!user?.id) throw new AuthError('Authentication required', { code: 'AUTH_REQUIRED' });
  return user;
}

function ownerIdOf(resource, ownerField) {
  const owner = resource?.[ownerField];
  return owner == null ? null : String(owner);
}

/**
 * Owner-only access. Missing resource → 404 (existence isn't leaked), wrong
 * owner → 403.
 */
function assertOwner(resource, user, { ownerField = 'authorId', message = 'Not allowed' } = {}) {
  requireUser(user);
  const ownerId = ownerIdOf(resource, ownerField);
  if (ownerId === null) throw new NotFoundError('Resource not found');
  if (ownerId !== String(user.id)) {
    throw new ForbiddenError(message, { code: 'FORBIDDEN' });
  }
  return true;
}

/** Owner, moderator, or admin — otherwise 403. */
function assertOwnerOrModerator(
  resource,
  user,
  { ownerField = 'authorId', message = 'Not allowed' } = {},
) {
  requireUser(user);
  const ownerId = ownerIdOf(resource, ownerField);
  if (ownerId === null) throw new NotFoundError('Resource not found');
  if (ownerId === String(user.id) || isModerator(user)) return true;
  throw new ForbiddenError(message, { code: 'FORBIDDEN' });
}

/** Admin-only; non-admins get 403 (or 401 when anonymous). */
function assertAdmin(user, { message = 'Administrator access required' } = {}) {
  requireUser(user);
  if (user.role !== 'admin') throw new ForbiddenError(message, { code: 'FORBIDDEN' });
  return true;
}

module.exports = {
  isModerator,
  requireUser,
  assertOwner,
  assertOwnerOrModerator,
  assertAdmin,
};
