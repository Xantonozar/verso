'use strict';

const { DiaryEntry } = require('./diary.model');

/**
 * Diary repository — the only layer that talks to the `diaryentries`
 * collection. `incStats` is the ONLY stats mutation path and it is $inc-only
 * (never a read-modify-write), mirroring poem.repository (plan step 46 rule
 * carried into Phase 4).
 */

async function create(fields) {
  return DiaryEntry.create(fields);
}

async function findById(id, { select } = {}) {
  let q = DiaryEntry.findById(id);
  if (select) q = q.select(select);
  return q.lean();
}

async function incStats(id, delta) {
  const $inc = {};
  for (const [key, value] of Object.entries(delta)) {
    if (value !== 0) $inc[`stats.${key}`] = value;
  }
  if (Object.keys($inc).length === 0) return null;
  const doc = await DiaryEntry.findByIdAndUpdate(id, { $inc }, { new: true })
    .select('stats')
    .lean();
  return doc ? doc.stats : null;
}

module.exports = {
  create,
  findById,
  incStats,
};
