'use strict';

const z = require('zod');

/**
 * Discovery & feed validation (Phase 5, plan step 53-54). Mood/tag bounds
 * mirror the poem field rules of ��7 so a discovery filter can never be wider
 * than what a poem can actually store.
 */
const moodParamSchema = z.object({
  mood: z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters'),
});

const tagParamSchema = z.object({
  tag: z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters'),
});

const pageQuerySchema = z.object({
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date cursor')
    .optional(),
  limit: z.coerce.number().int().min(1, 'must be at least 1').max(50, 'must be at most 50').optional(),
});

module.exports = { moodParamSchema, tagParamSchema, pageQuerySchema };
