'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const {
  collectionIdParamSchema,
  removePoemParamSchema,
  createCollectionSchema,
  addPoemSchema,
  listQuerySchema,
} = require('./collection.schemas');
const controller = require('./collection.controller');

/**
 * Collection routes (plan step 58 / §5): POST create, GET list-mine, GET read,
 * POST add poem, DELETE remove poem. Nothing else exists — no collection
 * update/delete endpoints in v1 (plan-defined surface only).
 */
const router = express.Router();

router.post('/', requireAuth, loadUser, validate({ body: createCollectionSchema }), controller.create);
router.get('/', requireAuth, loadUser, validate({ query: listQuerySchema }), controller.list);
router.get(
  '/:id',
  optionalAuth,
  loadUserOptional,
  validate({ params: collectionIdParamSchema }),
  controller.get,
);
router.post(
  '/:id/poems',
  requireAuth,
  loadUser,
  validate({ params: collectionIdParamSchema, body: addPoemSchema }),
  controller.addPoem,
);
router.delete(
  '/:id/poems/:poemId',
  requireAuth,
  loadUser,
  validate({ params: removePoemParamSchema }),
  controller.removePoem,
);

module.exports = { collectionRouter: router };
