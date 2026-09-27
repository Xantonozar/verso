'use strict';

const mongoose = require('mongoose');
const { createSchema, refField } = require('../../models/base');

/**
 * PromptSubmission (plan step 69) — a user's poem submitted to a prompt.
 * One submission per (prompt, user), enforced by the unique index; there is
 * no counter, so duplicates are rejected with 11000 → 409 (no rollback).
 */
const promptSubmissionSchema = createSchema({
  promptId: refField('Prompt'),
  userId: refField('User'),
  poemId: refField('Poem'),
});

promptSubmissionSchema.index({ promptId: 1, userId: 1 }, { unique: true });
promptSubmissionSchema.index({ promptId: 1, createdAt: -1 });

const PromptSubmission = mongoose.model('PromptSubmission', promptSubmissionSchema);

module.exports = { PromptSubmission };
