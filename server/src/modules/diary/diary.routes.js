'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const { diaryIdParamSchema, createDiarySchema } = require('./diary.schemas');
const controller = require('./diary.controller');

/**
 * Diary routes (plan step 50) — POST create + GET read only. Deliberately
 * absent here (and therefore 404 at the router, not just undocumented):
 * felt-good, save, patch, delete. Diary is reactions/comments only; reactions
 * mount in engagement.routes at /diary/:id/reactions alongside comments.
 */
const router = express.Router();

router.post('/', requireAuth, loadUser, validate({ body: createDiarySchema }), controller.create);
router.get(
  '/:id',
  optionalAuth,
  loadUserOptional,
  validate({ params: diaryIdParamSchema }),
  controller.get,
);

module.exports = { diaryRouter: router };
