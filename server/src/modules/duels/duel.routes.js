'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const {
  createDuelSchema,
  voteSchema,
  duelIdParamSchema,
  duelListQuerySchema,
} = require('./duel.schemas');
const controller = require('./duel.controller');

const router = express.Router();

// Listing/detail are optionalAuth (read-only); create/vote require a session.
router.get('/', optionalAuth, loadUserOptional, validate({ query: duelListQuerySchema }), controller.list);
router.post('/', requireAuth, loadUser, validate({ body: createDuelSchema }), controller.create);
router.get('/:id', optionalAuth, loadUserOptional, validate({ params: duelIdParamSchema }), controller.get);
router.post('/:id/vote', requireAuth, loadUser, validate({ params: duelIdParamSchema, body: voteSchema }), controller.vote);

module.exports = { duelRouter: router };
