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
} = require('./poem.schemas');
const controller = require('./poem.controller');

const router = express.Router();

// Reads are optionalAuth: anonymous/unlisted/public poems resolve visibility
// against the requester when a token is present (plan step 39).
router.post('/', requireAuth, loadUser, validate({ body: createPoemSchema }), controller.create);
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

module.exports = { poemRouter: router };
