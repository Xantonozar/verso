'use strict';

const { z } = require('zod');

/**
 * Collaboration request validation (plan steps 63–65). Line counts are
 * always derived server-side from the content — never trusted from the
 * client (plan step 63), so no client-declared count field exists here.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const collabPoemIdParamSchema = z.object({ id: objectId });
const pieceIdParamSchema = z.object({ pieceId: objectId });
const segmentParamSchema = z.object({ pieceId: objectId, segmentId: objectId });

const createCollabPoemSchema = z.object({
  title: z.string().trim().min(1, 'is required').max(120, 'must be at most 120 characters'),
  linesPerTurn: z
    .number()
    .int('must be an integer')
    .min(1, 'must be at least 1')
    .max(20, 'must be at most 20'),
});

// content carries the lines themselves; the service counts them (normalize
// CRLF, drop a single trailing newline, split — blank interior lines count,
// poetry needs them)
const addTurnSchema = z.object({
  content: z.string().min(1, 'is required').max(10_000, 'must be at most 10000 characters'),
});

const createPieceSchema = z.object({
  title: z.string().trim().min(1, 'is required').max(120, 'must be at most 120 characters'),
  mode: z.enum(['single_ending', 'multi_ending']),
  maxBranches: z
    .number()
    .int('must be an integer')
    .min(2, 'must be at least 2')
    .max(10, 'must be at most 10')
    .optional(),
  content: z.string().min(1, 'is required').max(5000, 'must be at most 5000 characters'),
});

const addSegmentSchema = z.object({
  parentId: objectId,
  content: z.string().min(1, 'is required').max(5000, 'must be at most 5000 characters'),
});

const readingPathSchema = z.object({ segmentId: objectId });

const listQuerySchema = z.object({
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
  status: z.enum(['open', 'finished']).optional(),
});

const pieceListQuerySchema = z.object({
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

module.exports = {
  collabPoemIdParamSchema,
  pieceIdParamSchema,
  segmentParamSchema,
  createCollabPoemSchema,
  addTurnSchema,
  createPieceSchema,
  addSegmentSchema,
  readingPathSchema,
  listQuerySchema,
  pieceListQuerySchema,
};
