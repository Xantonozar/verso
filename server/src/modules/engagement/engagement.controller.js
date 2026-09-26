'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const service = require('./engagement.service');

/**
 * Engagement controllers — thin per §2 (parse → service → respond).
 */

const addReaction = asyncHandler(async (req, res) => {
  created(res, await service.addReaction('poem', req.params.id, req.user, req.body));
});

const removeReaction = asyncHandler(async (req, res) => {
  ok(res, await service.removeReaction('poem', req.params.id, req.user, req.params.type));
});

// diary reactions (plan step 50) — same handlers, diary target type; there is
// deliberately no diary felt-good/save handler to route to
const addDiaryReaction = asyncHandler(async (req, res) => {
  created(res, await service.addReaction('diary', req.params.id, req.user, req.body));
});

const removeDiaryReaction = asyncHandler(async (req, res) => {
  ok(res, await service.removeReaction('diary', req.params.id, req.user, req.params.type));
});

const rate = asyncHandler(async (req, res) => {
  created(res, await service.ratePoem(req.params.id, req.user, req.body));
});

const updateRating = asyncHandler(async (req, res) => {
  ok(res, await service.updateRating(req.params.id, req.user, req.body));
});

const save = asyncHandler(async (req, res) => {
  ok(res, await service.savePoem(req.params.id, req.user));
});

const unsave = asyncHandler(async (req, res) => {
  ok(res, await service.unsavePoem(req.params.id, req.user));
});

const createComment = asyncHandler(async (req, res) => {
  created(res, await service.createComment(req.user, req.body));
});

const listComments = asyncHandler(async (req, res) => {
  const { targetType, targetId, cursor, limit } = req.query;
  ok(res, await service.listComments(req.user, { targetType, targetId, cursor, limit }));
});

const removeComment = asyncHandler(async (req, res) => {
  ok(res, await service.deleteComment(req.params.id, req.user));
});

const getMobilePoem = asyncHandler(async (req, res) => {
  ok(res, await service.getMobilePoem(req.params.id, req.user));
});

module.exports = {
  addReaction,
  removeReaction,
  addDiaryReaction,
  removeDiaryReaction,
  rate,
  updateRating,
  save,
  unsave,
  createComment,
  listComments,
  removeComment,
  getMobilePoem,
};
