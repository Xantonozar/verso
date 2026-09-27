'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const poemService = require('./poem.service');

/**
 * Poem controllers — thin per §2 (parse → service → respond).
 */
const create = asyncHandler(async (req, res) => {
  created(res, await poemService.createPoem(req.user.id, req.body));
});

const get = asyncHandler(async (req, res) => {
  ok(res, await poemService.getPoem(req.params.id, req.user));
});

const update = asyncHandler(async (req, res) => {
  ok(res, await poemService.updatePoem(req.params.id, req.user, req.body));
});

const remove = asyncHandler(async (req, res) => {
  ok(res, await poemService.deletePoem(req.params.id, req.user));
});

const mine = asyncHandler(async (req, res) => {
  ok(res, await poemService.listOwnPoems(req.user, req.query));
});

const versions = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  ok(res, await poemService.listVersions(req.params.id, req.user, { cursor, limit }));
});

const autosave = asyncHandler(async (req, res) => {
  ok(res, await poemService.autosaveDraft(req.params.id, req.user, req.body));
});

const publish = asyncHandler(async (req, res) => {
  ok(res, await poemService.publishPoem(req.params.id, req.user));
});

const unpublish = asyncHandler(async (req, res) => {
  ok(res, await poemService.unpublishPoem(req.params.id, req.user));
});

module.exports = { create, get, update, remove, versions, autosave, publish, unpublish, mine };
