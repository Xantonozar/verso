'use strict';

const { z } = require('zod');

/**
 * Collection request validation (plan step 58). Title 1–80, description
 * optional ≤300; visibility is the poem/diary matrix plus `private`.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const collectionIdParamSchema = z.object({ id: objectId });

const removePoemParamSchema = z.object({ id: objectId, poemId: objectId });

const createCollectionSchema = z.object({
  title: z.string().trim().min(1, 'cannot be empty').max(80, 'must be at most 80 characters'),
  description: z
    .string()
    .trim()
    .max(300, 'must be at most 300 characters')
    .optional(),
  visibility: z.enum(['public', 'followers', 'private']).optional(),
});

const addPoemSchema = z.object({ poemId: objectId });

const listQuerySchema = z.object({
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date cursor')
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'must be at least 1')
    .max(50, 'must be at most 50')
    .optional(),
});

module.exports = {
  collectionIdParamSchema,
  removePoemParamSchema,
  createCollectionSchema,
  addPoemSchema,
  listQuerySchema,
};
