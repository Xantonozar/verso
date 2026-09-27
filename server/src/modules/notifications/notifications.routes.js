'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, loadUser } = require('../../middleware/auth');
const {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} = require('./notifications.schemas');
const controller = require('./notifications.controller');

const router = express.Router();

// Notifications (Phase 11, plan step 78) - 5: list + mark-as-read.
// Every route is authenticated; rows are scoped to the requester in the service.
router.get(
  '/',
  requireAuth,
  loadUser,
  validate({ query: listNotificationsQuerySchema }),
  controller.list,
);
router.patch(
  '/:id/read',
  requireAuth,
  loadUser,
  validate({ params: notificationIdParamSchema }),
  controller.markRead,
);

module.exports = { notificationsRouter: router };
