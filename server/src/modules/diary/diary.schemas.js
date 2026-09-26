'use strict';

const { z } = require('zod');

/**
 * Diary request schemas (plan step 50). Content is a trimmed one-liner
 * (1–280 chars); visibility is only public/followers — diary has no
 * unlisted/private_draft lifecycle (that concept belongs to poems/stories).
 */

const diaryIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

const createDiarySchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'cannot be empty')
    .max(280, 'must be at most 280 characters'),
  visibility: z.enum(['public', 'followers']).optional(),
  anonymous: z.boolean().optional(),
});

module.exports = {
  diaryIdParamSchema,
  createDiarySchema,
};
