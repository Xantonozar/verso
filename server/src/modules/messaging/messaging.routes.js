'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, loadUser } = require('../../middleware/auth');
const {
  createConversationSchema,
  conversationIdParamSchema,
  listConversationsQuerySchema,
  messagesQuerySchema,
  sendMessageSchema,
} = require('./messaging.schemas');
const controller = require('./messaging.controller');

const router = express.Router();

// Messaging (Phase 10, plan step 74) — §5: /conversations* history surface.
// Every route is authenticated; membership is enforced in the service.
router.get(
  '/',
  requireAuth,
  loadUser,
  validate({ query: listConversationsQuerySchema }),
  controller.list,
);
router.post(
  '/',
  requireAuth,
  loadUser,
  validate({ body: createConversationSchema }),
  controller.create,
);
router.get(
  '/:id/messages',
  requireAuth,
  loadUser,
  validate({ params: conversationIdParamSchema, query: messagesQuerySchema }),
  controller.listMessages,
);
router.post(
  '/:id/messages',
  requireAuth,
  loadUser,
  validate({ params: conversationIdParamSchema, body: sendMessageSchema }),
  controller.send,
);

module.exports = { messagingRouter: router };
