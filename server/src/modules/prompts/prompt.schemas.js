'use strict';

const { z } = require('zod');

/**
 * Prompt request validation (plan step 69). No create-Prompt body exists —
 * prompts are seeded (§5 lists only GET /current, GET /:id/submissions and
 * the submission entry point added for mobile).
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const promptIdParamSchema = z.object({ id: objectId });

const submitSchema = z.object({ poemId: objectId });

const submissionsQuerySchema = z.object({
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

module.exports = { promptIdParamSchema, submitSchema, submissionsQuerySchema };
