'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Follow edge (§4): unique (followerId, followingId) turns "already following"
 * into a clean 409 via E11000 instead of a read-then-write race.
 * (followingId) index serves follower-list/feed lookups.
 */
const followSchema = createSchema({
  followerId: refField('User'),
  followingId: refField('User'),
});

followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
followSchema.index({ followingId: 1 });
// follower-growth series (Phase 12 dashboard) - date range within an author
followSchema.index({ followingId: 1, createdAt: -1 });

const Follow = mongoose.model('Follow', followSchema);

module.exports = { Follow };
