'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Remix (§3.18, plan step 70) — records that `remixPoemId` derives from
 * `originalPoemId`. The poems themselves carry authorship; this link is the
 * attribution edge the UI shows before submission.
 */
const remixSchema = createSchema({
  originalPoemId: refField('Poem'),
  remixPoemId: refField('Poem'),
});

remixSchema.index({ originalPoemId: 1, remixPoemId: 1 }, { unique: true });
remixSchema.index({ remixPoemId: 1 });

const Remix = mongoose.model('Remix', remixSchema);

module.exports = { Remix };
