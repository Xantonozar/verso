'use strict';

const { Poem } = require('./poem.model');
const { PoemVersion } = require('./poem-version.model');

/**
 * Poem repository — the only layer that talks to `poems`/`poemversions`.
 * Read paths always pass an explicit projection (§10.2).
 */
async function findById(id, { select } = {}) {
  let q = Poem.findById(id);
  if (select) q = q.select(select);
  return q.exec();
}

async function createPoem(data) {
  return Poem.create(data);
}

async function updatePoem(id, fields) {
  return Poem.findByIdAndUpdate(id, { $set: fields }, { new: true, runValidators: true });
}

async function softRemove(id) {
  return Poem.findByIdAndUpdate(id, { $set: { status: 'removed' } }, { new: true });
}

/**
 * Atomic stats counter movement (plan step 46 / §8.19). The ONLY way counters
 * change — $inc, never a read-modify-write. Returns the updated stats block.
 */
async function incStats(id, delta) {
  const $inc = {};
  for (const [key, value] of Object.entries(delta)) {
    if (value !== 0) $inc[`stats.${key}`] = value;
  }
  if (Object.keys($inc).length === 0) return null;
  const doc = await Poem.findByIdAndUpdate(id, { $inc }, { new: true }).select('stats').lean();
  return doc ? doc.stats : null;
}

async function createVersion({ poemId, title, content, versionNumber }) {
  return PoemVersion.create({ poemId, title, content, versionNumber, editedAt: new Date() });
}

async function countVersions(poemId) {
  return PoemVersion.countDocuments({ poemId });
}

async function nextVersionNumber(poemId) {
  const latest = await PoemVersion.findOne({ poemId })
    .sort({ versionNumber: -1 })
    .select('versionNumber')
    .lean();
  return (latest?.versionNumber || 0) + 1;
}

/** Descending by versionNumber; `before` implements cursor paging. */
async function listVersions(poemId, { limit, before } = {}) {
  const filter = { poemId };
  if (before != null) filter.versionNumber = { $lt: before };
  return PoemVersion.find(filter)
    .sort({ versionNumber: -1 })
    .limit(limit)
    .select('title content versionNumber editedAt')
    .lean();
}

module.exports = {
  findById,
  createPoem,
  updatePoem,
  softRemove,
  incStats,
  createVersion,
  countVersions,
  nextVersionNumber,
  listVersions,
};
