'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { logger } = require('../../config/logger');
const { ConflictError, AuthError, ForbiddenError } = require('../../errors');
const userRepo = require('../users/user.repository');
const tokenRepo = require('./refresh-token.repository');
const {
  generateAccessToken,
  generateRefreshTokenValue,
  hashToken,
  refreshExpiryDate,
} = require('./token.service');

/**
 * Auth service (Phase 1 steps 25–28): register, login, refresh (rotation +
 * family revoke on reuse), logout, logout-everywhere.
 *
 * Anti-enumeration (step 26): login failures always return the same
 * AUTH_INVALID_CREDENTIALS response whether the account exists or not, and an
 * unknown identifier still pays a bcrypt compare (timing parity).
 */

const LOGIN_FAILURE_WARN_THRESHOLD = 3;

// identifier → { count, expiresAt } — in-memory candidate hook for future
// brute-force lockout (§7 step 26); the Redis rate limiter is the real limit.
const loginFailures = new Map();

let dummyHashPromise = null;
function dummyHash() {
  // Lazily computed once so cold boots don't pay a bcrypt cost.
  if (!dummyHashPromise) {
    dummyHashPromise = bcrypt.hash(
      crypto.randomBytes(16).toString('hex'),
      Number(process.env.BCRYPT_ROUNDS) || 12,
    );
  }
  return dummyHashPromise;
}

function recordLoginFailure(identifier, ip) {
  const now = Date.now();
  let entry = loginFailures.get(identifier);
  if (!entry || entry.expiresAt <= now) {
    entry = { count: 0, expiresAt: now + 15 * 60 * 1000 };
    loginFailures.set(identifier, entry);
  }
  entry.count += 1;
  if (entry.count >= LOGIN_FAILURE_WARN_THRESHOLD) {
    logger.warn(
      { event: 'auth:login-repeated-failures', count: entry.count, ip },
      'Repeated failed login attempts',
    );
  }
}

async function issueTokenPair(user, { familyId, userAgent = '', ip = '' } = {}) {
  const family = familyId || new mongoose.Types.ObjectId();
  const refreshToken = generateRefreshTokenValue();
  const doc = await tokenRepo.create({
    userId: user._id,
    familyId: family,
    tokenHash: hashToken(refreshToken),
    userAgent,
    ip,
    expiresAt: refreshExpiryDate(),
  });
  return {
    accessToken: generateAccessToken({ id: user._id, role: user.roles.security }),
    refreshToken,
    familyId: family,
    tokenId: doc._id,
  };
}

async function register({ username, displayName, email, password }, meta = {}) {
  const normalized = { username: username.toLowerCase(), email: email.toLowerCase() };

  const conflicts = await userRepo.findConflictingIdentifiers(normalized);
  if (conflicts?.includes('email')) {
    throw new ConflictError('Email already registered', {
      code: 'AUTH_EMAIL_TAKEN',
      details: { field: 'email' },
    });
  }
  if (conflicts?.includes('username')) {
    throw new ConflictError('Username already taken', {
      code: 'AUTH_USERNAME_TAKEN',
      details: { field: 'username' },
    });
  }

  let user;
  try {
    user = await userRepo.create({
      username: normalized.username,
      displayName,
      email: normalized.email,
      passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS) || 12),
    });
  } catch (err) {
    // Race backstop: unique index wins over the pre-check above.
    if (err?.code === 11000) {
      const field = Object.keys(err.keyPattern || {})[0];
      throw new ConflictError(
        field === 'email' ? 'Email already registered' : 'Username already taken',
        {
          code: field === 'email' ? 'AUTH_EMAIL_TAKEN' : 'AUTH_USERNAME_TAKEN',
          details: { field },
        },
      );
    }
    throw err;
  }

  logger.info({ event: 'auth:registered', userId: String(user._id) }, 'user registered');

  const { accessToken, refreshToken } = await issueTokenPair(user, meta);
  return { user: user.toJSON(), accessToken, refreshToken };
}

async function login({ identifier, password }, meta = {}) {
  const normalized = identifier.toLowerCase();
  const user = await userRepo.findByLogin(normalized, { withPassword: true });

  let passwordOk = false;
  if (user) {
    passwordOk = await bcrypt.compare(password, user.passwordHash);
  } else {
    // Timing parity: an unknown account costs the same as a wrong password.
    await bcrypt.compare(password, await dummyHash());
  }

  if (!user || !passwordOk) {
    recordLoginFailure(normalized, meta.ip);
    // Identical response whether the account exists or not (no enumeration).
    throw new AuthError('Invalid credentials', { code: 'AUTH_INVALID_CREDENTIALS' });
  }

  if (user.moderation?.status === 'banned') {
    throw new ForbiddenError('This account has been suspended', { code: 'ACCOUNT_BANNED' });
  }

  loginFailures.delete(normalized);
  logger.info({ event: 'auth:login', userId: String(user._id) }, 'user logged in');

  const { accessToken, refreshToken } = await issueTokenPair(user, meta);
  return { user: user.toJSON(), accessToken, refreshToken };
}

async function refresh(rawRefreshToken, meta = {}) {
  if (!rawRefreshToken) {
    throw new AuthError('Refresh token is required', { code: 'AUTH_REFRESH_INVALID' });
  }

  const doc = await tokenRepo.findByHash(hashToken(rawRefreshToken));
  if (!doc) {
    throw new AuthError('Invalid refresh token', { code: 'AUTH_REFRESH_INVALID' });
  }

  if (doc.status === 'rotated' || doc.status === 'revoked') {
    // Reuse detected — possible token theft (§7 step 27).
    await tokenRepo.revokeFamily(doc.familyId);
    logger.warn(
      {
        event: 'auth:refresh-reuse-detected',
        userId: String(doc.userId),
        familyId: String(doc.familyId),
        status: doc.status,
      },
      'refresh token reuse detected — family revoked',
    );
    throw new AuthError('Refresh token reuse detected — please log in again', {
      code: 'AUTH_REFRESH_REUSED',
    });
  }

  if (doc.expiresAt <= new Date()) {
    await tokenRepo.revokeToken(doc._id);
    throw new AuthError('Refresh token expired', { code: 'AUTH_REFRESH_EXPIRED' });
  }

  // Atomic claim: only one concurrent refresh can win the active → rotated flip.
  const claimed = await tokenRepo.claimActive(doc._id);
  if (!claimed) {
    await tokenRepo.revokeFamily(doc.familyId);
    logger.warn(
      {
        event: 'auth:refresh-reuse-detected',
        userId: String(doc.userId),
        familyId: String(doc.familyId),
        status: 'race',
      },
      'refresh token reuse detected — family revoked',
    );
    throw new AuthError('Refresh token reuse detected — please log in again', {
      code: 'AUTH_REFRESH_REUSED',
    });
  }

  const user = await userRepo.findById(doc.userId, { select: 'roles moderation' });
  if (!user) {
    throw new AuthError('Account no longer exists', { code: 'AUTH_USER_NOT_FOUND' });
  }
  if (user.moderation?.status === 'banned') {
    await tokenRepo.revokeFamily(doc.familyId);
    throw new ForbiddenError('This account has been suspended', { code: 'ACCOUNT_BANNED' });
  }

  const tokens = await issueTokenPair(user, {
    familyId: doc.familyId,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  await tokenRepo.setReplacedBy(doc._id, tokens.tokenId);

  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

async function logout(rawRefreshToken) {
  if (!rawRefreshToken) return { revoked: 0 };
  const doc = await tokenRepo.findByHash(hashToken(rawRefreshToken));
  if (!doc) return { revoked: 0 };
  const revoked = await tokenRepo.revokeFamily(doc.familyId);
  logger.info({ event: 'auth:logout', userId: String(doc.userId) }, 'user logged out');
  return { revoked };
}

async function logoutEverywhere(userId) {
  const revoked = await tokenRepo.revokeAllForUser(userId);
  logger.info(
    { event: 'auth:logout-all', userId: String(userId), revoked },
    'logged out everywhere',
  );
  return { revoked };
}

module.exports = { register, login, refresh, logout, logoutEverywhere, issueTokenPair };
