'use strict';

const { z } = require('zod');

/**
 * Poem request schemas. updatePoemSchema is an allow-list (§7 step 30) —
 * status, authorId, stats, currentVersionId can never be set from a body.
 */
const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

const tagSchema = z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters');
const moodSchema = z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters');

const contentFields = {
  title: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(200, 'must be at most 200 characters'),
  content: z
    .string()
    .min(1, 'is required')
    .max(100_000, 'must be at most 100000 characters'),
  authorNote: z.string().max(1000, 'must be at most 1000 characters').optional(),
  language: z.enum(['bn', 'en']).optional(),
  moods: z.array(moodSchema).max(5, 'at most 5 moods').optional(),
  tags: z.array(tagSchema).max(10, 'at most 10 tags').optional(),
  visibility: z.enum(['public', 'followers', 'unlisted', 'private_draft']).optional(),
  anonymous: z.boolean().optional(),
  isUnsentPoem: z.boolean().optional(),
  unsentRecipientLabel: z
    .string()
    .trim()
    .max(80, 'must be at most 80 characters')
    .optional(),
};

// Unsent Poem fields (plan step 61): a recipient label without the flag is
// incoherent at creation. Updates are checked in the service, where the
// stored flag is visible.
const createPoemSchema = z.object(contentFields).refine(
  (obj) => obj.isUnsentPoem === true || !obj.unsentRecipientLabel,
  {
    message: 'unsentRecipientLabel requires isUnsentPoem to be true',
    path: ['unsentRecipientLabel'],
  },
);

const updatePoemSchema = z
  .object(Object.fromEntries(Object.entries(contentFields).map(([k, v]) => [k, v.optional()])))
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one updatable field is required',
    path: ['(root)'],
  });

/** Autosave payload — title/content only, both optional but not both empty. */
const autosaveDraftSchema = z
  .object({
    title: z.string().trim().min(1, 'cannot be empty').max(200, 'must be at most 200 characters').optional(),
    content: z.string().max(100_000, 'must be at most 100000 characters').optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'title or content is required',
    path: ['(root)'],
  });

const versionsQuerySchema = z.object({
  cursor: z.string().regex(/^[0-9]+$/, 'must be a numeric version cursor').optional(),
  limit: z.coerce.number().int().min(1, 'must be at least 1').max(50, 'must be at most 50').optional(),
});

module.exports = {
  idParamSchema,
  createPoemSchema,
  updatePoemSchema,
  autosaveDraftSchema,
  versionsQuerySchema,
};
