'use strict';

/**
 * Socket registry (plan step 73) — a process-wide handle to the io server so
 * services can push realtime events without importing socket.io itself or
 * creating a require cycle (sockets/index → messaging.service → registry).
 * With no io running (supertest-only suites) every emit is a no-op.
 */
let io = null;

function setIO(instance) {
  io = instance;
}

function getIO() {
  return io;
}

/** Best-effort fan-out to every socket a user has open (room per user id). */
function emitToUser(userId, event, payload) {
  if (!io || !userId) return;
  io.to(`user:${String(userId)}`).emit(event, payload);
}

module.exports = { setIO, getIO, emitToUser };
