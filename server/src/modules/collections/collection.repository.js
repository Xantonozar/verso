'use strict';

const { Collection } = require('./collection.model');

/**
 * Collection repository — the only layer that queries the `collections`
 * collection. List reads project summary fields (§10.2) and paginate
 * createdAt desc (limit+1 cursor, feed pattern). Mutations are guarded by
 * `{ _id, ownerId }` so an ownership check races safely at the DB level.
 */
const LIST_SELECT = 'ownerId title description visibility poemIds createdAt updatedAt';

async function create(fields) {
  return Collection.create(fields);
}

async function findById(id, { select } = {}) {
  let q = Collection.findById(id);
  if (select) q = q.select(select);
  return q.lean();
}

async function findOwnedBy(ownerId, { cursor, limit }) {
  const filter = { ownerId };
  if (cursor) filter.createdAt = { $lt: new Date(cursor) };
  return Collection.find(filter)
    .select(LIST_SELECT)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/** `$ne` guard → matchedCount 0 means the poem is already in the collection. */
async function addPoem(id, ownerId, poemId) {
  return Collection.updateOne(
    { _id: id, ownerId, poemIds: { $ne: poemId } },
    { $addToSet: { poemIds: poemId } },
  );
}

async function removePoem(id, ownerId, poemId) {
  return Collection.updateOne(
    { _id: id, ownerId, poemIds: poemId },
    { $pull: { poemIds: poemId } },
  );
}

module.exports = { create, findById, findOwnedBy, addPoem, removePoem };
