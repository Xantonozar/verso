'use strict';

const { z } = require('zod');
const { REACTION_TYPES } = require('./reaction.model');

/**
 * Engagement request schemas (plan step 45). Felt Good `score` is range-checked
 * here AND re-checked in the service (0–100, integer) — the server never trusts
 * the mobile slider's clamping.
 */

const idParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

const reactionTypeSchema = z.enum(REACTION_TYPES);

const reactionParamsSchema = idParamSchema.extend({
  type: reactionTypeSchema,
});

const reactionBodySchema = z.object({
  type: reactionTypeSchema,
  anonymous: z.boolean().optional(),
});

const feltGoodBodySchema = z
  .object({
    score: z
      .number('score is required')
      .int('must be a whole number')
      .min(0, 'must be at least 0')
      .max(100, 'must be at most 100')
      .optional(),
    comment: z.string().max(500, 'must be at most 500 characters').optional(),
  })
  .refine((obj) => obj.score !== undefined, {
    message: 'score is required',
    path: ['score'],
  });

const commentTargetTypeSchema = z.enum(['poem', 'diary', 'collabSegment']);

const createCommentSchema = z.object({
  targetType: commentTargetTypeSchema,
  targetId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
  content: z
    .string()
    .trim()
    .min(1, 'cannot be empty')
    .max(500, 'must be at most 500 characters'),
  parentCommentId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id')
    .optional(),
  anonymous: z.boolean().optional(),
});

const listCommentsQuerySchema = z.object({
  targetType: commentTargetTypeSchema,
  targetId: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date cursor')
    .optional(),
  limit: z.coerce.number().int().min(1, 'must be at least 1').max(50, 'must be at most 50').optional(),
});

const commentIdParamSchema = idParamSchema;

module.exports = {
  idParamSchema,
  reactionTypeSchema,
  reactionParamsSchema,
  reactionBodySchema,
  feltGoodBodySchema,
  createCommentSchema,
  listCommentsQuerySchema,
  commentIdParamSchema,
};
