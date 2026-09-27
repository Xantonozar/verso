'use strict';

const { z } = require('zod');

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

module.exports = { analyticsQuerySchema };
