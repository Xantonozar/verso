'use strict';

const mongoose = require('mongoose');
const { createSchema } = require('../../models/base');

/**
 * User model (§3.1). Username/email are unique (§3.1 comments) — enforced by
 * unique indexes declared here and ensured by scripts/init-indexes.js.
 * passwordHash is `select: false` so it can never leak via an accidental
 * unguarded query; auth code loads it explicitly with `.select('+passwordHash')`.
 */
const userSchema = createSchema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 30,
      match: [/^[a-z0-9_]+$/, 'can only contain letters, numbers and underscores'],
    },
    displayName: { type: String, required: true, trim: true, maxlength: 50 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    bio: { type: String, default: '', maxlength: 300 },
    profilePhotoUrl: { type: String, default: '' },
    roles: {
      type: {
        product: { type: [String], default: ['reader'] },
        security: { type: String, enum: ['user', 'moderator', 'admin'], default: 'user' },
      },
      default: () => ({ product: ['reader'], security: 'user' }),
    },
    language: { type: String, enum: ['bn', 'en', 'both'], default: 'en' },
    // Expo push token (Phase 11 step 80) - '' = not registered / revoked
    pushToken: { type: String, default: '', maxlength: 512 },
    followerCount: { type: Number, default: 0 },
    followingCount: { type: Number, default: 0 },
    readingStreak: {
      type: {
        current: { type: Number, default: 0 },
        longest: { type: Number, default: 0 },
        lastReadDate: { type: Date, default: null },
      },
      default: () => ({ current: 0, longest: 0, lastReadDate: null }),
    },
    moderation: {
      type: {
        warningCount: { type: Number, default: 0 },
        status: { type: String, enum: ['active', 'restricted', 'banned'], default: 'active' },
        isAnonymizedAccount: { type: Boolean, default: false },
      },
      default: () => ({ warningCount: 0, status: 'active', isAnonymizedAccount: false }),
    },
  },
  {
    // passwordHash must never reach a client, even via toJSON
    strip: ['passwordHash'],
  },
);

const User = mongoose.model('User', userSchema);

module.exports = { User };
