'use strict';

const { z } = require('zod');

/**
 * User request schemas. updateProfileSchema is an allow-list — unknown keys
 * (roles, followerCount, moderation, …) are stripped by Zod, so a request
 * body can never mass-assign privileged fields (§7 step 30).
 */
const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(1, 'is required').max(50, 'must be at most 50 characters').optional(),
    bio: z.string().max(300, 'must be at most 300 characters').optional(),
    language: z.enum(['bn', 'en', 'both']).optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one updatable field is required',
    path: ['(root)'],
  });

const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

module.exports = { updateProfileSchema, idParamSchema };
