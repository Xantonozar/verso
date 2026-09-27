'use strict';

const { z } = require('zod');

/**
 * Messaging request validation (plan step 72). Conversation membership is
 * checked against the DB in the service — a schema only expresses shape.
 */

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be a valid id');

const cursorField = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date cursor')
  .optional();

const limitField = (max) =>
  z.coerce
    .number()
    .int('must be an integer')
    .min(1, 'must be at least 1')
    .max(max, `must be at most ${max}`)
    .optional();

const createConversationSchema = z.object({
  userId: objectId,
  isAnonymous: z.boolean().optional(),
});

const conversationIdParamSchema = z.object({ id: objectId });

const listConversationsQuerySchema = z.object({
  cursor: cursorField,
  limit: limitField(50),
});

const messagesQuerySchema = z.object({
  cursor: cursorField,
  limit: limitField(100),
});

const sendMessageSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, 'is required')
    .max(4000, 'must be at most 4000 characters'),
  isAnonymous: z.boolean().optional(),
});

// socket.io envelope for `message:send` — body plus the thread id
const socketSendSchema = sendMessageSchema.extend({ conversationId: objectId });
const socketReadSchema = z.object({ conversationId: objectId });

module.exports = {
  createConversationSchema,
  conversationIdParamSchema,
  listConversationsQuerySchema,
  messagesQuerySchema,
  sendMessageSchema,
  socketSendSchema,
  socketReadSchema,
};
