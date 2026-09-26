'use strict';

const { Server } = require('socket.io');
const { logger } = require('../config/logger');
const { extractBearer, verifyAccessToken } = require('../middleware/auth');

/**
 * Socket.io foundation with JWT handshake auth (Phase 0.5 step 20).
 * Real-time namespaces/handlers (messaging, collab notices) come in Phase 10/8.
 */
function createSocketServer(httpServer, { corsOrigins } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    },
  });

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
    logger.info(
      {
        event: 'socket:connected',
        socketId: socket.id,
        userId: socket.data.user?.id,
        transport: socket.conn.transport.name,
      },
      'Socket connected',
    );

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
