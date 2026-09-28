'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const moderationService = require('./moderation.service');

/** Moderation controllers — thin (parse → service → respond). */

const createReport = asyncHandler(async (req, res) => {
  created(res, await moderationService.createReport(req.user, req.body));
});

const listReports = asyncHandler(async (req, res) => {
  ok(res, await moderationService.listReports(req.user, req.query));
});

const updateReport = asyncHandler(async (req, res) => {
  ok(
    res,
    await moderationService.updateReport(req.user, req.params.id, req.body),
  );
});

const createAction = asyncHandler(async (req, res) => {
  created(res, await moderationService.applyModerationAction(req.user, req.body));
});

module.exports = { createReport, listReports, updateReport, createAction };
