'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const {
  promptIdParamSchema,
  submitSchema,
  submissionsQuerySchema,
} = require('./prompt.schemas');
const controller = require('./prompt.controller');

const router = express.Router();

// Reads are optionalAuth (mySubmission resolves only when a token is present).
router.get('/current', optionalAuth, loadUserOptional, controller.current);
router.get(
  '/:id/submissions',
  optionalAuth,
  loadUserOptional,
  validate({ params: promptIdParamSchema, query: submissionsQuerySchema }),
  controller.listSubmissions,
);
router.post(
  '/:id/submissions',
  requireAuth,
  loadUser,
  validate({ params: promptIdParamSchema, body: submitSchema }),
  controller.submit,
);

module.exports = { promptRouter: router };
