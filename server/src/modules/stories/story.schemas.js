'use strict';

const { z } = require('zod');

/**
 * Story request schemas. updateStorySchema is an allow-list (§7 step 30) —
 * status, authorId, stats, chapterCount, currentVersionId can never be set
 * from a body (status only changes through publish/unpublish/delete).
 */
const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

const chapterParamsSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
  chapterId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

const tagSchema = z.string().trim().min(1, 'cannot be empty').max(40, 'must be at most 40 characters');

const titleSchema = z
  .string()
  .trim()
  .min(1, 'is required')
  .max(200, 'must be at most 200 characters');
const coverUrlSchema = z
  .string()
  .trim()
  .max(2000, 'must be at most 2000 characters')
  .optional();
const synopsisSchema = z.string().max(5000, 'must be at most 5000 characters').optional();
const languageSchema = z.enum(['bn', 'en']).optional();
const tagsSchema = z.array(tagSchema).max(10, 'at most 10 tags').optional();

const createStorySchema = z.object({
  title: titleSchema,
  coverUrl: coverUrlSchema,
  synopsis: synopsisSchema,
  language: languageSchema,
  tags: tagsSchema,
});

const storyPatchFields = {
  title: titleSchema.optional(),
  coverUrl: coverUrlSchema,
  synopsis: synopsisSchema,
  language: languageSchema,
  tags: tagsSchema,
};

const updateStorySchema = z
  .object(storyPatchFields)
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one updatable field is required',
    path: ['(root)'],
  });

/** Metadata autosave payload — at least one field, never status/author/stats. */
const storyAutosaveSchema = z
  .object(storyPatchFields)
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'at least one field is required',
    path: ['(root)'],
  });

const publishSchema = z.object({}).optional().default({});

const unpublishSchema = z
  .object({
    to: z.enum(['draft', 'private_draft']).optional(),
  })
  .optional()
  .default({});

/** Chapter create/explicit-save payload — at least one field. */
const chapterInputSchema = z
  .object({
    title: z.string().trim().max(200, 'must be at most 200 characters').optional(),
    content: z.string().max(300_000, 'must be at most 300000 characters').optional(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: 'title or content is required',
    path: ['(root)'],
  });

const reorderSchema = z.object({
  chapterIds: z
    .array(z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'))
    .min(1, 'is required')
    .max(200, 'must be at most 200 chapters'),
}).refine((obj) => new Set(obj.chapterIds).size === obj.chapterIds.length, {
  message: 'chapter ids must be distinct',
  path: ['chapterIds'],
});

const chaptersQuerySchema = z.object({
  cursor: z.string().regex(/^[0-9]+$/, 'must be a numeric cursor').optional(),
  limit: z.coerce.number().int().min(1, 'must be at least 1').max(50, 'must be at most 50').optional(),
});

const versionsQuerySchema = z.object({
  chapterId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id')
    .optional(),
  cursor: z.string().regex(/^[0-9]+$/, 'must be a numeric version cursor').optional(),
  limit: z.coerce.number().int().min(1, 'must be at least 1').max(50, 'must be at most 50').optional(),
});

const authorStoriesQuerySchema = z.object({
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date cursor')
    .optional(),
  limit: z.coerce.number().int().min(1, 'must be at least 1').max(50, 'must be at most 50').optional(),
});

module.exports = {
  idParamSchema,
  chapterParamsSchema,
  createStorySchema,
  updateStorySchema,
  storyAutosaveSchema,
  publishSchema,
  unpublishSchema,
  chapterInputSchema,
  reorderSchema,
  chaptersQuerySchema,
  versionsQuerySchema,
  authorStoriesQuerySchema,
};
