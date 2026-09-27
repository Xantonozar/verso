'use strict';

const { Server } = require('socket.io');
const { logger } = require('../config/logger');
const { extractBearer, verifyAccessToken } = require('../middleware/auth');
const { setIO } = require('./registry');
const { socketSendSchema, socketReadSchema } = require('../modules/messaging/messaging.schemas');
const messagingService = require('../modules/messaging/messaging.service');

/**
 * Socket.io foundation with JWT handshake auth (Phase 0.5 step 20) plus the
 * messaging surface (plan step 73): every connection joins a `user:{id}` room
 * for per-user fan-out, and `message:send`/`message:read` run through the
 * same service as REST so anonymity + membership rules hold on both paths.
 */
function createSocketServer(httpServer, { corsOrigins } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    },
  });
  // registry makes emitToUser() available to services (no-op without io)
  setIO(io);

  // Handshake auth: token via `auth: { token }` or Authorization header.
  // Rejections are logged with the reason (§7.2) and surfaced to the client.
  io.use((socket, next) => {
    try {
      const header = socket.handshake.headers?.authorization;
      const token = socket.handshake.auth?.token || extractBearer(header);
      if (!token) {
        logger.warn(
          { event: 'socket:auth-rejected', socketId: socket.id, reason: 'missing-token' },
          'Socket handshake rejected: missing token',
        );
        return next(Object.assign(new Error('Authentication required'), { data: { code: 'AUTH_REQUIRED' } }));
      }
      const payload = verifyAccessToken(token);
      socket.data.user = { id: payload.sub };
      socket.data.auth = payload;
      return next();
    } catch (err) {
      logger.warn(
        {
          event: 'socket:auth-rejected',
          socketId: socket.id,
          reason: err.code || err.message,
        },
        'Socket handshake rejected: invalid token',
      );
      return next(Object.assign(new Error(err.message || 'Invalid token'), { data: { code: err.code || 'AUTH_INVALID_TOKEN' } }));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.user?.id;
    // room for per-user fan-out (message:new / message:read → emitToUser)
    socket.join(`user:${userId}`);

    logger.info(
      {
        event: 'socket:connected',
        socketId: socket.id,
        userId,
        transport: socket.conn.transport.name,
      },
      'Socket connected',
    );

    // Messaging (plan step 73): send through the shared service — the
    // `message:new` fan-out already reaches every participant's room (and
    // other devices of the sender); the ack carries the sender's view.
    socket.on('message:send', async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      const parsed = socketSendSchema.safeParse(payload);
      if (!parsed.success) {
        logger.warn(
          { event: 'socket:message-rejected', socketId: socket.id, userId, reason: 'validation' },
          'Socket message rejected: invalid payload',
        );
        return respond({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid message payload' },
        });
      }
      const { conversationId, ...body } = parsed.data;
      try {
        const message = await messagingService.sendMessage({ id: userId }, conversationId, body);
        logger.info(
          { event: 'socket:message-sent', socketId: socket.id, userId, conversationId, messageId: message.id },
          'Socket message sent',
        );
        return respond({ ok: true, message });
      } catch (err) {
        logger.warn(
          { event: 'socket:message-rejected', socketId: socket.id, userId, conversationId, code: err.code },
          'Socket message rejected',
        );
        return respond({
          ok: false,
          error: { code: err.code || 'SEND_FAILED', message: err.message },
        });
      }
    });

    socket.on('message:read', async (payload, ack) => {
      const respond = typeof ack === 'function' ? ack : () => {};
      const parsed = socketReadSchema.safeParse(payload);
      if (!parsed.success) {
        return respond({
          ok: false,
          error: { code: 'VALIDATION_ERROR', message: 'Invalid read payload' },
        });
      }
      try {
        await messagingService.markRead({ id: userId }, parsed.data.conversationId);
        return respond({ ok: true });
      } catch (err) {
        return respond({
          ok: false,
          error: { code: err.code || 'READ_FAILED', message: err.message },
        });
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info({ event: 'socket:disconnected', socketId: socket.id, reason }, 'Socket disconnected');
    });
  });

  io.engine.on('connection_error', (err) => {
    logger.warn(
      { event: 'socket:connection-error', code: err.code, message: err.message },
      'Socket connection error',
    );
  });

  return io;
}

module.exports = { createSocketServer };
