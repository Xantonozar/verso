'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const duelService = require('./duel.service');

/** Duel controllers — thin (parse → service → respond). */

const create = asyncHandler(async (req, res) => {
  created(res, await duelService.createDuel(req.user, req.body));
});

const list = asyncHandler(async (req, res) => {
  ok(res, await duelService.listDuels(req.query));
});

const get = asyncHandler(async (req, res) => {
  ok(res, await duelService.getDuel(req.params.id, req.user));
});

const vote = asyncHandler(async (req, res) => {
  created(res, await duelService.vote(req.params.id, req.user, req.body));
});

module.exports = { create, list, get, vote };
