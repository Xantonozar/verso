'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const authService = require('./auth.service');

/**
 * Auth controllers — thin per §2: parse request, call service, respond.
 * Never contains business logic or authorization decisions.
 */
const register = asyncHandler(async (req, res) => {
  const result = await authService.register(req.body, {
    userAgent: req.get('user-agent') || '',
    ip: req.ip,
  });
  created(res, result);
});

const login = asyncHandler(async (req, res) => {
  const result = await authService.login(req.body, {
    userAgent: req.get('user-agent') || '',
    ip: req.ip,
  });
  ok(res, result);
});

const refresh = asyncHandler(async (req, res) => {
  const result = await authService.refresh(req.body.refreshToken, {
    userAgent: req.get('user-agent') || '',
    ip: req.ip,
  });
  ok(res, result);
});

const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.body?.refreshToken);
  ok(res, { loggedOut: true });
});

const logoutAll = asyncHandler(async (req, res) => {
  const { revoked } = await authService.logoutEverywhere(req.user.id);
  ok(res, { loggedOut: true, revoked });
});

module.exports = { register, login, refresh, logout, logoutAll };
