'use strict';

const { Server } = require('socket.io');
const { logger } = require('../config/logger');

/**
 * Socket.io foundation (Phase 0 step 7): attach to the Express HTTP server with
 * connection/disconnection logging. JWT handshake auth is added in Phase 0.5 (step 20);
 * real-time namespaces/handlers (messaging, collab notices) come in Phase 10/8.
 */
function createSocketServer(httpServer, { corsOrigins } = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins === '*' ? true : corsOrigins,
      credentials: true,
    },
  });

  io.on('connection', (socket) => {
    logger.info(
      { event: 'socket:connected', socketId: socket.id, transport: socket.conn.transport.name },
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
