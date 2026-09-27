'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { created } = require('../../middleware/respond');
const remixService = require('./remix.service');

/** Remix controllers — thin (parse → service → respond). */

const create = asyncHandler(async (req, res) => {
  created(res, await remixService.createRemix(req.user, req.body));
});

module.exports = { create };
