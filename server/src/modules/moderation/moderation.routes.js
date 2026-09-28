'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, loadUser } = require('../../middleware/auth');
const {
  createReportSchema,
  reportIdParamSchema,
  listReportsQuerySchema,
  updateReportSchema,
  createModerationActionSchema,
} = require('./moderation.schemas');
const controller = require('./moderation.controller');

const router = express.Router();

// Moderation (Phase 14, plan steps 87-90):
//   POST   /reports           any signed-in user files a report (§5)
//   GET    /moderation/reports  moderator review queue
//   PATCH  /moderation/reports/:id  moderator triage (reviewed/dismissed/actioned)
//   POST   /moderation/actions    moderator enforcement (warning→restriction→ban→identity_revealed)
// Authorization (moderator-only, self-action bans, confirmIdentity gate) lives
// in the service layer per §2.
router.post(
  '/reports',
  requireAuth,
  loadUser,
  validate({ body: createReportSchema }),
  controller.createReport,
);
router.get(
  '/moderation/reports',
  requireAuth,
  loadUser,
  validate({ query: listReportsQuerySchema }),
  controller.listReports,
);
router.patch(
  '/moderation/reports/:id',
  requireAuth,
  loadUser,
  validate({ params: reportIdParamSchema, body: updateReportSchema }),
  controller.updateReport,
);
router.post(
  '/moderation/actions',
  requireAuth,
  loadUser,
  validate({ body: createModerationActionSchema }),
  controller.createAction,
);

module.exports = { moderationRouter: router };
