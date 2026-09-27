'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const {
  idParamSchema,
  createPoemSchema,
  updatePoemSchema,
  autosaveDraftSchema,
  versionsQuerySchema,
  mineQuerySchema,
} = require('./poem.schemas');
const controller = require('./poem.controller');

const router = express.Router();

// Reads are optionalAuth: anonymous/unlisted/public poems resolve visibility
// against the requester when a token is present (plan step 39).
router.post('/', requireAuth, loadUser, validate({ body: createPoemSchema }), controller.create);
// Own poems for the prompt-submission picker (Phase 9) — must precede '/:id'.
router.get('/mine', requireAuth, loadUser, validate({ query: mineQuerySchema }), controller.mine);
router.get(
  '/:id',
  optionalAuth,
  loadUserOptional,
  validate({ params: idParamSchema }),
  controller.get,
);
router.patch(
  '/:id',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: updatePoemSchema }),
  controller.update,
);
router.delete('/:id', requireAuth, loadUser, validate({ params: idParamSchema }), controller.remove);
router.get(
  '/:id/versions',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, query: versionsQuerySchema }),
  controller.versions,
);
router.put(
  '/:id/draft',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: autosaveDraftSchema }),
  controller.autosave,
);
// publish lifecycle — deferred from Phase 2 (user decision), mirrors stories
router.post('/:id/publish', requireAuth, loadUser, validate({ params: idParamSchema }), controller.publish);
router.delete('/:id/publish', requireAuth, loadUser, validate({ params: idParamSchema }), controller.unpublish);

module.exports = { poemRouter: router };
