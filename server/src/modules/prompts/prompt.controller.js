'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const promptService = require('./prompt.service');

/** Prompt controllers — thin (parse → service → respond). */

const current = asyncHandler(async (req, res) => {
  ok(res, await promptService.getCurrent(req.user));
});

const submit = asyncHandler(async (req, res) => {
  created(res, await promptService.submit(req.user, req.params.id, req.body));
});

const listSubmissions = asyncHandler(async (req, res) => {
  ok(res, await promptService.listSubmissions(req.params.id, req.user, req.query));
});

module.exports = { current, submit, listSubmissions };
