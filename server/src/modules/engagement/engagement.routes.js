'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const {
  idParamSchema,
  reactionParamsSchema,
  reactionBodySchema,
  feltGoodBodySchema,
  createCommentSchema,
  listCommentsQuerySchema,
  commentIdParamSchema,
} = require('./engagement.schemas');
const controller = require('./engagement.controller');

/**
 * Engagement routes (plan steps 45–49). Mounted at API_PREFIX (after the poem
 * router) — poem-scoped sub-paths that poem.routes doesn't own, plus /comments
 * and the /mobile BFF read model.
 */
const router = express.Router();

// reactions — POST creates (409 on duplicate), DELETE is the idempotent toggle
router.post(
  '/poems/:id/reactions',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: reactionBodySchema }),
  controller.addReaction,
);
router.delete(
  '/poems/:id/reactions/:type',
  requireAuth,
  loadUser,
  validate({ params: reactionParamsSchema }),
  controller.removeReaction,
);

// felt good — POST = first rating (409 if exists), PATCH = update path (step 47)
router.post(
  '/poems/:id/felt-good',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: feltGoodBodySchema }),
  controller.rate,
);
router.patch(
  '/poems/:id/felt-good',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: feltGoodBodySchema }),
  controller.updateRating,
);

// saves — both verbs idempotent; counts move only on real state change
router.post('/poems/:id/save', requireAuth, loadUser, validate({ params: idParamSchema }), controller.save);
router.delete(
  '/poems/:id/save',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema }),
  controller.unsave,
);

// comments — list is optionalAuth (viewability resolved per requester)
router.post('/comments', requireAuth, loadUser, validate({ body: createCommentSchema }), controller.createComment);
router.get(
  '/comments',
  optionalAuth,
  loadUserOptional,
  validate({ query: listCommentsQuerySchema }),
  controller.listComments,
);
router.delete(
  '/comments/:id',
  requireAuth,
  loadUser,
  validate({ params: commentIdParamSchema }),
  controller.removeComment,
);

// mobile BFF — poem + author + reaction/Felt Good/viewer state in one call
router.get(
  '/mobile/poems/:id',
  optionalAuth,
  loadUserOptional,
  validate({ params: idParamSchema }),
  controller.getMobilePoem,
);

module.exports = { engagementRouter: router };
