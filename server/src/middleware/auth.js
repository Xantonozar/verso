'use strict';

const jwt = require('jsonwebtoken');
const { AuthError, ForbiddenError } = require('../errors');
const { User } = require('../modules/users/user.model');

/**
 * Auth middleware (Phase 0.5, wired to real lookups in Phase 1 step 29).
 *
 * - requireAuth/optionalAuth: fast JWT verification, attach the token payload.
 * - loadUser: DB lookup run AFTER requireAuth on routes that need real user
 *   data (profile, follow) — rejects deleted and banned accounts. Splitting
 *   the two keeps JWT verification unit-testable and lets routes choose
 *   whether they need a DB hit.
 *
 * Token contract: { sub: userId, type: 'access', role, ... }
 */
function extractBearer(header) {
  if (typeof header !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

function verifyAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      throw new AuthError('Access token expired', { code: 'AUTH_TOKEN_EXPIRED' });
    }
    throw new AuthError('Invalid access token', { code: 'AUTH_INVALID_TOKEN' });
  }
  if (!payload || typeof payload.sub !== 'string' || !payload.sub) {
    throw new AuthError('Invalid access token', { code: 'AUTH_INVALID_TOKEN' });
  }
  if (payload.type && payload.type !== 'access') {
    throw new AuthError('Invalid access token type', { code: 'AUTH_INVALID_TOKEN' });
  }
  return payload;
}

function attachUser(req, payload) {
  req.auth = payload;
  req.user = { id: payload.sub };
}

/** Requires a valid Bearer access token (401 otherwise). */
function requireAuth(req, res, next) {
  try {
    const token = extractBearer(req.headers.authorization);
    if (!token) throw new AuthError('Authentication required', { code: 'AUTH_REQUIRED' });
    attachUser(req, verifyAccessToken(token));
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Attaches identity when a token is present; anonymous requests pass through.
 * A *present but invalid* token still 401s — silently downgrading a client's
 * credentials to anonymous would hide bugs.
 */
function optionalAuth(req, res, next) {
  try {
    const token = extractBearer(req.headers.authorization);
    if (token) attachUser(req, verifyAccessToken(token));
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Loads the authenticated user from MongoDB and attaches a full identity
 * (Phase 1 step 29). Run after requireAuth.
 * - account deleted → 401 (the token is valid but the subject is gone)
 * - account banned  → 403 (authenticated but not allowed — §7.1)
 */
async function loadUser(req, res, next) {
  try {
    const userId = req.auth?.sub || req.user?.id;
    if (!userId) throw new AuthError('Authentication required', { code: 'AUTH_REQUIRED' });

    const user = await User.findById(userId).select(
      'username displayName email roles moderation profilePhotoUrl bio language followerCount followingCount createdAt',
    );
    if (!user) {
      throw new AuthError('Account no longer exists', { code: 'AUTH_USER_NOT_FOUND' });
    }
    if (user.moderation?.status === 'banned') {
      throw new ForbiddenError('This account has been suspended', { code: 'ACCOUNT_BANNED' });
    }

    req.user = {
      id: String(user._id),
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      role: user.roles.security,
      roles: user.roles,
      moderation: user.moderation,
      profilePhotoUrl: user.profilePhotoUrl,
      bio: user.bio,
      language: user.language,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      createdAt: user.createdAt,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Like loadUser, but anonymous requests pass through untouched — for routes
 * that are optionalAuth yet still need a full identity (roles, moderation)
 * when a token IS present (e.g. GET /poems/:id moderator visibility).
 */
function loadUserOptional(req, res, next) {
  if (!req.auth?.sub) return next();
  return loadUser(req, res, next);
}

module.exports = { requireAuth, optionalAuth, loadUser, loadUserOptional, verifyAccessToken, extractBearer };
