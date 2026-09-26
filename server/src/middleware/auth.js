'use strict';

const jwt = require('jsonwebtoken');
const { AuthError } = require('../errors');

/**
 * Auth middleware skeleton (Phase 0.5 step 15). Password/JWT issuing lands in
 * Phase 2 — here we only decode/verify access tokens and attach identity.
 *
 * Token contract (set in Phase 2): { sub: userId, type: 'access', ... }
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

module.exports = { requireAuth, optionalAuth, verifyAccessToken, extractBearer };
