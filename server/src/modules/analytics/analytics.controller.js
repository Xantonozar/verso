'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok } = require('../../middleware/respond');
const analyticsService = require('./analytics.service');

/** Analytics controllers - thin (parse -> service -> respond). */

const writer = asyncHandler(async (req, res) => {
  ok(res, await analyticsService.getWriterAnalytics(req.user.id, req.query));
});

module.exports = { writer };
