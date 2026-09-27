'use strict';

const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../../src/app');
const { createSocketServer } = require('../../src/sockets');
const { User } = require('../../src/modules/users/user.model');
const { Conversation } = require('../../src/modules/messaging/conversation.model');
const { Message } = require('../../src/modules/messaging/message.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 10 gate (plan steps 72-77):
 * - cursor-paginated history (§5, plan 74)
 * - anonymity honored in BOTH REST and socket payloads (plan 10.4)
 * - socket send while the recipient is offline → visible via REST history
 *   on next load (plan 10.6/77)
 * - explain() on history → IXSCAN, never COLLSCAN (§4)
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let httpServer;
let io;
let serverPort;
let seq = 0;

const uniq = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(displayName) {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName,
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

function connectSocket(token) {
  return ioClient(`http://localhost:${serverPort}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    auth: { token },
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

function waitForEvent(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ${event} within 3s`)), 3000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for ${event} within 3s`)), 3000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

const createConversation = (token, body) =>
  request(app).post('/api/v1/conversations').set('Authorization', `Bearer ${token}`).send(body);

const sendRest = (token, conversationId, body) =>
  request(app)
    .post(`/api/v1/conversations/${conversationId}/messages`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const getHistory = (token, conversationId, query = {}) => {
  const qs = new URLSearchParams(query).toString();
  const path = `/api/v1/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`;
  return request(app).get(path).set('Authorization', `Bearer ${token}`);
};

const getInbox = (token) =>
  request(app).get('/api/v1/conversations').set('Authorization', `Bearer ${token}`);

let alice;
let bob;
let carol;
let dave;
let erin;

// one thread per user pair (§3.19 get-or-create) — each suite owns a pair
let convHistory; // alice-carol: cursor pagination
let convUnread; // alice-dave: unread + auto-read
let convAnon; // bob-carol: anonymous thread (REST)
let convSocket; // alice-erin: named thread over sockets
let convSocketAnon; // bob-dave: anonymous thread over sockets
let convOffline; // bob-erin: offline delivery

beforeAll(async () => {
  mongod = await startTestDb([User, Conversation, Message]);
  httpServer = http.createServer(app);
  io = createSocketServer(httpServer, { corsOrigins: '*' });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  serverPort = httpServer.address().port;

  [alice, bob, carol, dave, erin] = await Promise.all([
    register('Alice'),
    register('Bob'),
    register('Carol'),
    register('Dave'),
    register('Erin'),
  ]);

  const pair = async (a, b, isAnonymous = false) => {
    const res = await createConversation(a.accessToken, {
      userId: b.user.id,
      isAnonymous,
    });
    expect(res.status).toBe(201);
    return res.body.data.id;
  };

  convHistory = await pair(alice, carol);
  convUnread = await pair(alice, dave);
  convAnon = await pair(bob, carol, true);
  convSocket = await pair(alice, erin);
  convSocketAnon = await pair(bob, dave, true);
  convOffline = await pair(bob, erin);
});

afterAll(async () => {
  io.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await stopTestDb(mongod);
});

describe('conversation get-or-create (plan 72)', () => {
  test('same pair → same thread, 201 then 200', async () => {
    const first = await createConversation(alice.accessToken, { userId: carol.user.id });
    expect(first.status).toBe(200); // pair already created in beforeAll
    const second = await createConversation(carol.accessToken, { userId: alice.user.id });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.otherUser.username).toBe(alice.user.username);
  });

  test('new pair → 201 with the other participant', async () => {
    const res = await createConversation(alice.accessToken, { userId: bob.user.id });
    expect(res.status).toBe(201);
    expect(res.body.data.otherUser.username).toBe(bob.user.username);
    expect(res.body.data.isAnonymous).toBe(false);
    expect(res.body.data.unreadCount).toBe(0);
  });

  test('self-DM → 400 SELF_CONVERSATION', async () => {
    const res = await createConversation(alice.accessToken, { userId: alice.user.id });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SELF_CONVERSATION');
  });

  test('unknown user → 404 USER_NOT_FOUND', async () => {
    const res = await createConversation(alice.accessToken, {
      userId: '000000000000000000000000',
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('USER_NOT_FOUND');
  });
});

describe('history REST — cursor pagination (plan 74, §10.2)', () => {
  beforeAll(async () => {
    for (const content of ['one', 'two', 'three', 'four']) {
      const res = await sendRest(alice.accessToken, convHistory, { content });
      expect(res.status).toBe(201);
    }
  });

  test('newest first, cursor walks backwards, never the full thread', async () => {
    const page1 = await getHistory(alice.accessToken, convHistory, { limit: 2 });
    expect(page1.status).toBe(200);
    expect(page1.body.data.items.map((m) => m.content)).toEqual(['four', 'three']);
    expect(page1.body.data.nextCursor).toBeTruthy();

    const page2 = await getHistory(alice.accessToken, convHistory, {
      limit: 2,
      cursor: page1.body.data.nextCursor,
    });
    expect(page2.body.data.items.map((m) => m.content)).toEqual(['two', 'one']);
    expect(page2.body.data.nextCursor).toBeNull();
  });

  test('sender sees isMine + identity; recipient sees the sender', async () => {
    const mine = await getHistory(alice.accessToken, convHistory, { limit: 1 });
    const asSender = mine.body.data.items[0];
    expect(asSender.isMine).toBe(true);
    expect(asSender.senderId).toBe(alice.user.id);
    expect(asSender.sender.username).toBe(alice.user.username);

    const theirs = await getHistory(carol.accessToken, convHistory, { limit: 1 });
    const asRecipient = theirs.body.data.items[0];
    expect(asRecipient.isMine).toBe(false);
    expect(asRecipient.senderId).toBe(alice.user.id);
  });

  test('non-participant → 404 CONVERSATION_NOT_FOUND', async () => {
    const res = await getHistory(dave.accessToken, convHistory);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CONVERSATION_NOT_FOUND');
    const send = await sendRest(dave.accessToken, convHistory, { content: 'intruder' });
    expect(send.status).toBe(404);
  });

  test('validation: empty content → 400 with field detail', async () => {
    const res = await sendRest(alice.accessToken, convHistory, { content: '   ' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'content')).toBe(true);
  });
});

describe('inbox unread + auto-read (plan 74)', () => {
  test('send → unread count, preview, other user; opening the thread reads it', async () => {
    await sendRest(alice.accessToken, convUnread, { content: 'first ping' });
    await sendRest(alice.accessToken, convUnread, { content: 'second ping' });

    const forDave = await getInbox(dave.accessToken);
    const row = forDave.body.data.items.find((c) => c.id === convUnread);
    expect(row).toBeTruthy();
    expect(row.unreadCount).toBe(2);
    expect(row.otherUser.username).toBe(alice.user.username);
    expect(row.lastMessage.content).toBe('second ping');

    // opening the thread marks the other side's messages read
    const history = await getHistory(dave.accessToken, convUnread);
    expect(history.status).toBe(200);
    const afterRead = await getInbox(dave.accessToken);
    expect(afterRead.body.data.items.find((c) => c.id === convUnread).unreadCount).toBe(0);
  });

  test('reply flips unread to the other side', async () => {
    await sendRest(dave.accessToken, convUnread, { content: 'pong' });
    const forAlice = await getInbox(alice.accessToken);
    const row = forAlice.body.data.items.find((c) => c.id === convUnread);
    expect(row.unreadCount).toBe(1);
    expect(row.lastMessage.content).toBe('pong');
    expect(row.otherUser.username).toBe(dave.user.username);
  });
});

describe('anonymity — REST AND socket payloads (plan 10.4)', () => {
  test('REST: anonymous thread hides senderId/sender from BOTH sides', async () => {
    const asAlice = await sendRest(bob.accessToken, convAnon, { content: 'anon from bob' });
    expect(asAlice.status).toBe(201);
    expect(asAlice.body.data.isMine).toBe(true);
    expect(asAlice.body.data.senderId).toBeNull();
    expect(asAlice.body.data.sender).toBeNull();
    expect(asAlice.body.data.isAnonymous).toBe(true);

    const forCarol = await getHistory(carol.accessToken, convAnon);
    const msg = forCarol.body.data.items[0];
    expect(msg.content).toBe('anon from bob');
    expect(msg.isMine).toBe(false);
    expect(msg.senderId).toBeNull();
    expect(msg.sender).toBeNull();

    const back = await getHistory(bob.accessToken, convAnon);
    expect(back.body.data.items[0].senderId).toBeNull();

    const inbox = await getInbox(carol.accessToken);
    const row = inbox.body.data.items.find((c) => c.id === convAnon);
    expect(row.isAnonymous).toBe(true);
    expect(row.otherUser).toBeNull();
    expect(row.lastMessage.senderId).toBeNull();
  });

  test('control: named thread keeps identity visible', async () => {
    const res = await sendRest(alice.accessToken, convHistory, { content: 'signed' });
    expect(res.body.data.senderId).toBe(alice.user.id);
    expect(res.body.data.sender.username).toBe(alice.user.username);
  });

  test('per-message toggle anonymizes one message in a named thread', async () => {
    const res = await sendRest(alice.accessToken, convHistory, {
      content: 'this one stays faceless',
      isAnonymous: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.data.isAnonymous).toBe(true);
    expect(res.body.data.senderId).toBeNull();
    expect(res.body.data.sender).toBeNull();
  });

  test('socket: message:new fan-out hides the sender on every socket', async () => {
    const bobSock = connectSocket(bob.accessToken);
    const daveSock = connectSocket(dave.accessToken);
    await Promise.all([connectSuccess(bobSock), connectSuccess(daveSock)]);

    const bobGets = waitForEvent(bobSock, 'message:new');
    const daveGets = waitForEvent(daveSock, 'message:new');

    const ack = await emitAck(bobSock, 'message:send', {
      conversationId: convSocketAnon,
      content: 'over the socket',
    });
    expect(ack.ok).toBe(true);
    expect(ack.message.isMine).toBe(true);
    expect(ack.message.senderId).toBeNull();
    expect(ack.message.sender).toBeNull();

    const forBob = await bobGets;
    const forDave = await daveGets;
    expect(forBob.senderId).toBeNull();
    expect(forDave.senderId).toBeNull();
    expect(forBob.isMine).toBe(true);
    expect(forDave.isMine).toBe(false);

    bobSock.close();
    daveSock.close();
  });

  test('socket: anonymous read receipt omits readerId', async () => {
    const bobSock = connectSocket(bob.accessToken);
    const daveSock = connectSocket(dave.accessToken);
    await Promise.all([connectSuccess(bobSock), connectSuccess(daveSock)]);

    // dave must have something unread for bob's read to emit a receipt
    const sent = await emitAck(daveSock, 'message:send', {
      conversationId: convSocketAnon,
      content: 'dave speaks',
    });
    expect(sent.ok).toBe(true);

    const receipt = waitForEvent(daveSock, 'message:read');
    const ack = await emitAck(bobSock, 'message:read', { conversationId: convSocketAnon });
    expect(ack.ok).toBe(true);

    const payload = await receipt;
    expect(payload.conversationId).toBe(convSocketAnon);
    expect(payload.readerId).toBeUndefined();

    bobSock.close();
    daveSock.close();
  });

  test('socket: named read receipt carries readerId', async () => {
    const aliceSock = connectSocket(alice.accessToken);
    const erinSock = connectSocket(erin.accessToken);
    await Promise.all([connectSuccess(aliceSock), connectSuccess(erinSock)]);

    const sent = await emitAck(aliceSock, 'message:send', {
      conversationId: convSocket,
      content: 'read me',
    });
    expect(sent.ok).toBe(true);
    expect(sent.message.senderId).toBe(alice.user.id);

    const receipt = waitForEvent(aliceSock, 'message:read');
    const ack = await emitAck(erinSock, 'message:read', { conversationId: convSocket });
    expect(ack.ok).toBe(true);

    const payload = await receipt;
    expect(payload.readerId).toBe(erin.user.id);

    aliceSock.close();
    erinSock.close();
  });

  test('socket: non-participant send rejected, no message created', async () => {
    const daveSock = connectSocket(dave.accessToken);
    await connectSuccess(daveSock);
    const before = await Message.countDocuments({ conversationId: convSocket });

    const ack = await emitAck(daveSock, 'message:send', {
      conversationId: convSocket,
      content: 'not my thread',
    });
    expect(ack.ok).toBe(false);
    expect(ack.error.code).toBe('CONVERSATION_NOT_FOUND');
    expect(await Message.countDocuments({ conversationId: convSocket })).toBe(before);

    daveSock.close();
  });
});

describe('offline delivery (plan 10.6/77)', () => {
  test('socket send while recipient is offline → REST history shows it on next load', async () => {
    // recipient (erin) has NO socket connection in this test
    const bobSock = connectSocket(bob.accessToken);
    await connectSuccess(bobSock);

    const ack = await emitAck(bobSock, 'message:send', {
      conversationId: convOffline,
      content: 'sent while you were away',
    });
    expect(ack.ok).toBe(true);
    bobSock.close();

    // next load is plain REST history — no socket required
    const history = await getHistory(erin.accessToken, convOffline);
    expect(history.status).toBe(200);
    const found = history.body.data.items.find((m) => m.content === 'sent while you were away');
    expect(found).toBeTruthy();
    expect(found.isMine).toBe(false);
    expect(found.senderId).toBe(bob.user.id);
  });
});

describe('explain() — history hot path (Phase 10 gate, §4)', () => {
  let targetConversationId;

  beforeAll(async () => {
    // decoy + target threads (30 msgs each) so conversationId stays selective
    let seedNo = 0;
    const mkThread = async () => {
      const conversation = await Conversation.create({
        participantIds: [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()],
        pairKey: `seed-${(seedNo += 1)}`,
        lastMessageAt: new Date(),
      });
      await Message.insertMany(
        Array.from({ length: 30 }, (_, i) => ({
          conversationId: conversation._id,
          senderId: new mongoose.Types.ObjectId(),
          content: `seed ${i}`,
          createdAt: new Date(Date.now() - i * 1000),
        })),
      );
      return conversation;
    };
    await mkThread();
    targetConversationId = (await mkThread())._id;
  });

  test('messages history query wins IXSCAN on { conversationId, createdAt }', async () => {
    const explain = await Message.find({ conversationId: targetConversationId })
      .sort({ createdAt: -1 })
      .limit(30)
      .explain('executionStats');
    const json = JSON.stringify(explain);
    expect(json).toContain('conversationId_1_createdAt_-1');
    expect(json).toContain('IXSCAN');
    expect(json).not.toContain('COLLSCAN');
  });
});
