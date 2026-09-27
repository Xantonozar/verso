'use strict';

const { z } = require('zod');

/**
 * Duel request validation (plan step 68). Poem/poet links and public
 * readability are checked server-side against the DB — a schema can only
 * express what the client sends.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be a valid date')
  .transform((v) => new Date(v));

const createDuelSchema = z
  .object({
    theme: z.string().trim().min(1, 'is required').max(140, 'must be at most 140 characters'),
    poemAId: objectId,
    poemBId: objectId,
    submissionDeadline: isoDate,
    votingDeadline: isoDate,
  })
  .refine((d) => String(d.poemAId) !== String(d.poemBId), {
    message: 'must be two different poems',
    path: ['poemBId'],
  })
  .refine((d) => d.votingDeadline.getTime() >= d.submissionDeadline.getTime(), {
    message: 'must be at or after the submission deadline',
    path: ['votingDeadline'],
  });

const voteSchema = z.object({ votedFor: z.enum(['A', 'B']) });

const duelIdParamSchema = z.object({ id: objectId });

const duelListQuerySchema = z.object({
  cursor: z
    .string()
    .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date cursor')
    .optional(),
  limit: z.coerce
    .number()
    .int('must be an integer')
    .min(1, 'must be at least 1')
    .max(50, 'must be at most 50')
    .optional(),
});

module.exports = { createDuelSchema, voteSchema, duelIdParamSchema, duelListQuerySchema };
