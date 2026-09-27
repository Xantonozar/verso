'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok } = require('../../middleware/respond');
const service = require('./discover.service');

/**
 * Discover controllers — thin (§2): parse → service → respond.
 * Feed requires auth (it is "who I follow"); discovery endpoints are public.
 */
const feed = asyncHandler(async (req, res) => {
  ok(res, await service.getFeed(req.user.id, req.query));
});

const byMood = asyncHandler(async (req, res) => {
  ok(res, await service.getByMood(req.params.mood, req.query));
});

const byTag = asyncHandler(async (req, res) => {
  ok(res, await service.getByTag(req.params.tag, req.query));
});

const trending = asyncHandler(async (req, res) => {
  ok(res, await service.getTrending(req.query));
});

const random = asyncHandler(async (req, res) => {
  ok(res, await service.getRandom());
});

module.exports = { feed, byMood, byTag, trending, random };
