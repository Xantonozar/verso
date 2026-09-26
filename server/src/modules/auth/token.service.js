'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');

/**
 * Token issuing (Phase 1 steps 25–27).
 * - Access tokens are short-lived JWTs signed with JWT_ACCESS_SECRET.
 * - Refresh tokens are opaque random strings; only their SHA-256 hash is
 *   stored (§3.1a: "never store raw token"), so a DB leak can't be replayed.
 */
function generateAccessToken({ id, role = 'user' }) {
  // jti makes every token unique even when two are minted in the same second
  // (iat is second-granular, so identical claims would yield identical JWTs).
  return jwt.sign(
    { sub: String(id), type: 'access', role, jti: crypto.randomUUID() },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_TTL || '15m' }
  );
}

function generateRefreshTokenValue() {
  return crypto.randomBytes(32).toString('base64url');
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function refreshExpiryDate() {
  const days = Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

module.exports = { generateAccessToken, generateRefreshTokenValue, hashToken, refreshExpiryDate };
