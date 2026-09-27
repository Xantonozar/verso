'use strict';

const { z } = require('zod');

/**
 * Remix request validation (plan step 70): one call creates the remix poem
 * and links it to the original — body is `originalPoemId` + poem fields.
 * Original readability (published AND public/unlisted) is DB-checked.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const moodSchema = z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters');
const tagSchema = z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters');

const createRemixSchema = z.object({
  originalPoemId: objectId,
  title: z.string().trim().min(1, 'is required').max(200, 'must be at most 200 characters'),
  content: z
    .string()
    .min(1, 'is required')
    .max(20000, 'must be at most 20000 characters')
    .refine((v) => v.trim().length > 0, 'cannot be blank'),
  authorNote: z.string().max(2000, 'must be at most 2000 characters').optional(),
  language: z.string().trim().min(2).max(10).optional(),
  moods: z.array(moodSchema).max(5, 'at most 5 moods').optional(),
  tags: z.array(tagSchema).max(10, 'at most 10 tags').optional(),
  visibility: z.enum(['public', 'unlisted', 'followers']).optional(),
});

module.exports = { createRemixSchema };
