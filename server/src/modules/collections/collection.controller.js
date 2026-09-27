'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { created, ok, noContent } = require('../../middleware/respond');
const service = require('./collection.service');

/**
 * Collection controllers — thin per §2 (parse → service → respond).
 * POST create/add return 201 with the updated summary; DELETE returns 204.
 */

const create = asyncHandler(async (req, res) => {
  created(res, await service.createCollection(req.user, req.body));
});

const list = asyncHandler(async (req, res) => {
  ok(res, await service.listCollections(req.user, req.query));
});

const get = asyncHandler(async (req, res) => {
  ok(res, await service.getCollection(req.params.id, req.user));
});

const addPoem = asyncHandler(async (req, res) => {
  created(res, await service.addPoem(req.params.id, req.user, req.body.poemId));
});

const removePoem = asyncHandler(async (req, res) => {
  await service.removePoem(req.params.id, req.user, req.params.poemId);
  noContent(res);
});

module.exports = { create, list, get, addPoem, removePoem };
