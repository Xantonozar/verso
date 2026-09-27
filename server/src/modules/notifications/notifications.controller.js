'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok } = require('../../middleware/respond');
const notificationsService = require('./notifications.service');

/** Notification controllers - thin (parse -> service -> respond). */

const list = asyncHandler(async (req, res) => {
  ok(res, await notificationsService.listNotifications(req.user, req.query));
});

const markRead = asyncHandler(async (req, res) => {
  ok(res, await notificationsService.markNotificationRead(req.user, req.params.id));
});

module.exports = { list, markRead };
