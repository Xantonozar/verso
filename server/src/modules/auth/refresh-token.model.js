'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * RefreshToken model (§3.1a): token family + reuse detection.
 * Raw tokens are never stored — only a SHA-256 hash (tokenHash).
 *
 * Reuse rule: if a token whose status is `rotated` or `revoked` is presented
 * again, the whole familyId is revoked immediately (§7 step 27).
 * Indexes mirror §4: (familyId, status) for family revocation scans,
 * userId for "log out everywhere", tokenHash for the refresh hot path.
 */
const refreshTokenSchema = createSchema(
  {
    userId: refField('User'),
    familyId: { type: mongoose.Types.ObjectId, required: true },
    tokenHash: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['active', 'rotated', 'revoked'],
      default: 'active',
      required: true,
    },
    replacedByTokenId: { type: mongoose.Types.ObjectId, default: null },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
  },
);

// §4 index plan (+ tokenHash — refresh hot path, must never COLLSCAN)
refreshTokenSchema.index({ familyId: 1, status: 1 });
refreshTokenSchema.index({ userId: 1 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = { RefreshToken };
