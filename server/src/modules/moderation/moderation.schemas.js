'use strict';

const { z } = require('zod');
const { REPORT_REASONS, REPORT_TARGET_TYPES, REPORT_STATUSES } = require('./report.model');
const { ACTION_TYPES } = require('./moderation-action.model');

/**
 * Moderation request schemas (Phase 14, plan steps 87-89). The action body
 * carries `confirmIdentity` — the explicit moderator confirmation the plan
 * requires before an identity reveal is allowed (checked again in the
 * service, where the reason/audit write happens).
 */
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: objectId,
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500, 'must be at most 500 characters').optional(),
});

const reportIdParamSchema = z.object({ id: objectId });

const listReportsQuerySchema = z.object({
  status: z.enum(REPORT_STATUSES).optional(),
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

const updateReportSchema = z.object({
  status: z.enum(['reviewed', 'actioned', 'dismissed']),
});

const createModerationActionSchema = z.object({
  userId: objectId,
  actionType: z.enum(ACTION_TYPES),
  reason: z.string().trim().min(1, 'is required').max(500, 'must be at most 500 characters'),
  reportId: objectId.optional(),
  confirmIdentity: z.boolean().optional(),
});

module.exports = {
  objectId,
  createReportSchema,
  reportIdParamSchema,
  listReportsQuerySchema,
  updateReportSchema,
  createModerationActionSchema,
};
