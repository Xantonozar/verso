'use strict';

const { z } = require('zod');

const listNotificationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const notificationIdParamSchema = z.object({
  id: z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id'),
});

module.exports = { listNotificationsQuerySchema, notificationIdParamSchema };
