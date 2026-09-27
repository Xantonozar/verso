'use strict';

const { z } = require('zod');

const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

// POST /poems/:id/read body (plan step 85): the client sends its UTC
// offset (Date.getTimezoneOffset() sign convention, minutes WEST of UTC)
// so the worker can define the streak "day" in the READER's local time,
// not server UTC. Optional - anonymous reads / old clients fall back to UTC.
const readBodySchema = z
  .object({
    tzOffsetMinutes: z.number().int().min(-900).max(900).optional(),
  })
  .default({});

module.exports = { analyticsQuerySchema, readBodySchema };
