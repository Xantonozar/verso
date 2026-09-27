'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth } = require('../../middleware/auth');
const { pageQuerySchema, moodParamSchema, tagParamSchema } = require('./discover.schemas');
const controller = require('./discover.controller');

const router = express.Router();

// Following feed is authenticated (it resolves "who I follow"). Discovery is
// public reads: optionalAuth only decorates a present token (plan 54).
router.get('/feed', requireAuth, validate({ query: pageQuerySchema }), controller.feed);
router.get(
  '/discover/mood/:mood',
  optionalAuth,
  validate({ params: moodParamSchema, query: pageQuerySchema }),
  controller.byMood,
);
router.get(
  '/discover/tags/:tag',
  optionalAuth,
  validate({ params: tagParamSchema, query: pageQuerySchema }),
  controller.byTag,
);
router.get(
  '/discover/trending',
  optionalAuth,
  validate({ query: pageQuerySchema }),
  controller.trending,
);
router.get('/discover/random', optionalAuth, controller.random);

module.exports = { discoverRouter: router };
