'use strict';

const { User } = require('./user.model');

/**
 * User repository — the only layer that talks to the `users` collection.
 * Keeps auth/user services free of raw Mongo query details.
 */
async function findById(id, { select } = {}) {
  let q = User.findById(id);
  if (select) q = q.select(select);
  return q.exec();
}

/** Used by login: identifier is an already-lowercased email or username. */
async function findByLogin(identifier, { withPassword = false } = {}) {
  let q = User.findOne({ $or: [{ email: identifier }, { username: identifier }] });
  if (withPassword) q = q.select('+passwordHash');
  return q.exec();
}

async function findConflictingIdentifiers({ email, username }) {
  const doc = await User.findOne({ $or: [{ email }, { username }] })
    .select('email username')
    .lean();
  if (!doc) return null;
  const conflicts = [];
  if (doc.email === email) conflicts.push('email');
  if (doc.username === username) conflicts.push('username');
  return conflicts;
}

async function create(data) {
  return User.create(data);
}

async function updateProfile(userId, fields) {
  return User.findByIdAndUpdate(userId, { $set: fields }, { new: true, runValidators: true });
}

async function incrementCounts(userId, { followerCount = 0, followingCount = 0 }) {
  return User.findByIdAndUpdate(
    userId,
    {
      $inc: { followerCount, followingCount },
    },
    { new: true },
  ).select('followerCount followingCount');
}

module.exports = {
  findById,
  findByLogin,
  findConflictingIdentifiers,
  create,
  updateProfile,
  incrementCounts,
};
