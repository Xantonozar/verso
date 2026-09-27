'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * Collection (§3.10, plan step 58) — a user's curated poem list. Visibility
 * follows the same matrix poems/diary use: public | followers | private.
 */

const collectionSchema = createSchema({
  ownerId: refField('User'),
  title: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, trim: true, maxlength: 300, default: '' },
  visibility: {
    type: String,
    enum: ['public', 'followers', 'private'],
    default: 'public',
  },
  // TODO (§3.10a note, plan step 58 — flagged, deliberately NOT built yet):
  // embedded `poemIds` is fine for v1. If collections grow large, split into a
  // separate `CollectionItem { collectionId, poemId, order, addedAt }` collection
  // rather than letting this array grow unbounded (16MB document limit).
  poemIds: { type: [mongoose.Schema.Types.ObjectId], default: () => [] },
});

// Own-collection listing (collections hub / profile)
collectionSchema.index({ ownerId: 1, createdAt: -1 });

const Collection = mongoose.model('Collection', collectionSchema);

module.exports = { Collection };
