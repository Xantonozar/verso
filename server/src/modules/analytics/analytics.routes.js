'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, loadUser } = require('../../middleware/auth');
const { analyticsQuerySchema } = require('./analytics.schemas');
const controller = require('./analytics.controller');

const router = express.Router();

// Writer dashboard (plan step 83) - own stats only, so the caller IS the
// scope: `/writer` reads the authenticated user, no id to spoof.
router.get(
  '/writer',
  requireAuth,
  loadUser,
  validate({ query: analyticsQuerySchema }),
  controller.writer,
);

module.exports = { analyticsRouter: router };
