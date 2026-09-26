'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const userService = require('./user.service');

/**
 * User controllers — thin per §2 (parse → service → respond).
 */
const getMe = asyncHandler(async (req, res) => {
  ok(res, await userService.getMe(req.user.id));
});

const updateMe = asyncHandler(async (req, res) => {
  ok(res, await userService.updateProfile(req.user.id, req.body));
});

const uploadPhoto = asyncHandler(async (req, res) => {
  ok(res, await userService.uploadProfilePhoto(req.user.id, req.file));
});

const getProfile = asyncHandler(async (req, res) => {
  ok(res, await userService.getProfile(req.params.id, req.user));
});

const follow = asyncHandler(async (req, res) => {
  created(res, await userService.follow(req.params.id, req.user.id));
});

const unfollow = asyncHandler(async (req, res) => {
  ok(res, await userService.unfollow(req.params.id, req.user.id));
});

module.exports = { getMe, updateMe, uploadPhoto, getProfile, follow, unfollow };
