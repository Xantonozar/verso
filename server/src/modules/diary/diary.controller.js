'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { created, ok } = require('../../middleware/respond');
const service = require('./diary.service');

/**
 * Diary controllers — thin per §2 (parse → service → respond). Only create
 * and read exist (plan step 50); reactions live in the engagement router.
 */

const create = asyncHandler(async (req, res) => {
  created(res, await service.createDiary(req.user, req.body));
});

const get = asyncHandler(async (req, res) => {
  ok(res, await service.getDiary(req.params.id, req.user));
});

module.exports = { create, get };
