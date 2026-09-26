'use strict';

const http = require('http');
const jwt = require('jsonwebtoken');
const { io: ioClient } = require('socket.io-client');
const { createSocketServer } = require('../../src/sockets');

const SECRET = process.env.JWT_ACCESS_SECRET;

function connect(extra = {}) {
  return ioClient(`http://localhost:${serverPort}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...extra,
  });
}

function connectError(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no connect_error within 3s')), 3000);
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      resolve(err);
    });
    socket.on('connect', () => {
      clearTimeout(timer);
      reject(new Error('unexpectedly connected'));
    });
  });
}

function connectSuccess(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no connect within 3s')), 3000);
    socket.on('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

let httpServer;
let io;
let serverPort;

beforeAll(async () => {
  httpServer = http.createServer();
  io = createSocketServer(httpServer, { corsOrigins: '*' });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  serverPort = httpServer.address().port;
});

afterAll(async () => {
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
});

describe('socket.io JWT handshake auth (step 20)', () => {
  test('missing token → rejected with AUTH_REQUIRED', async () => {
    const socket = connect();
    const err = await connectError(socket);
    expect(err.message).toMatch(/Authentication required/);
    expect(err.data?.code).toBe('AUTH_REQUIRED');
    socket.close();
  });

  test('invalid token → rejected with AUTH_INVALID_TOKEN', async () => {
    const socket = connect({ auth: { token: 'not.a.jwt' } });
    const err = await connectError(socket);
    expect(err.data?.code).toBe('AUTH_INVALID_TOKEN');
    socket.close();
  });

  test('valid access token → connected with user identity', async () => {
    const token = jwt.sign({ sub: 'user-7', type: 'access' }, SECRET, { expiresIn: '5m' });
    const socket = connect({ auth: { token } });
    await connectSuccess(socket);
    expect(socket.connected).toBe(true);
    socket.close();
  });
});
