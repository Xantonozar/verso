'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const messagingService = require('./messaging.service');

/** Messaging controllers — thin (parse → service → respond). */

const list = asyncHandler(async (req, res) => {
  ok(res, await messagingService.listConversations(req.user, req.query));
});

const create = asyncHandler(async (req, res) => {
  const { conversation, created: isNew } = await messagingService.createOrGetConversation(
    req.user,
    req.body,
  );
  if (isNew) created(res, conversation);
  else ok(res, conversation);
});

const listMessages = asyncHandler(async (req, res) => {
  ok(res, await messagingService.listMessages(req.user, req.params.id, req.query));
});

const send = asyncHandler(async (req, res) => {
  created(res, await messagingService.sendMessage(req.user, req.params.id, req.body));
});

module.exports = { list, create, listMessages, send };
