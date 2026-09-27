'use strict';

const http = require('http');
const mongoose = require('mongoose');
const request = require('supertest');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../../src/app');
const { createSocketServer } = require('../../src/sockets');
const { logger } = require('../../src/config/logger');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { Reaction } = require('../../src/modules/engagement/reaction.model');
const { Comment } = require('../../src/modules/engagement/comment.model');
const { CollabPoem } = require('../../src/modules/collab/collab-poem.model');
const { Duel } = require('../../src/modules/duels/duel.model');
const { DuelVote } = require('../../src/modules/duels/duel-vote.model');
const { Notification } = require('../../src/modules/notifications/notification.model');
const notificationsService = require('../../src/modules/notifications/notifications.service');
const dispatcher = require('../../src/modules/notifications/notifications.dispatcher');
const { TEMPLATES, renderPoeticMessage } = require('../../src/modules/notifications/templates');
const duelService = require('../../src/modules/duels/duel.service');
const {
  processNotificationJob,
  deliverExpoPush,
  startNotificationsWorker,
} = require('../../src/jobs/notifications');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

/**
 * Phase 11 gate (plan steps 78-81):
 * - inbox list (cursor + unreadCount) and mark-as-read idempotency (§5, 78)
 * - worker insert idempotent on eventKey (11.5, §10.15) + poetic templates (79)
 * - `notification:push` socket fan-out (79) and best-effort Expo push with
 *   logged delivery failures / token clearing (80)
 * - producers dispatch after their primary write: reaction, comment, follow,
 *   collab turn, duel result (79)
 * - Redis-down degradation: dispatch and worker both skip, API stays up
 * - explain() on the inbox query → IXSCAN on { userId, readAt, createdAt } (§4)
 */

jest.setTimeout(60_000);

const app = createApp();
let mongod;
let httpServer;
let io;
let serverPort;
let seq = 0;

const uniq = () => `n${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(displayName = 'Reader') {
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

async function createPublishedPoem(token) {
  const create = await request(app)
    .post('/api/v1/poems')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'First Light', content: 'dawn\nspills over', visibility: 'public' });
  expect(create.status).toBe(201);
  const publish = await request(app)
    .post(`/api/v1/poems/${create.body.data.id}/publish`)
    .set('Authorization', `Bearer ${token}`);
  expect(publish.status).toBe(200);
  return publish.body.data;
}

let notifSeed = 0;
async function makeNotification(userId, overrides = {}) {
  return Notification.create({
    userId,
    type: 'follow',
    poeticMessage: 'A new reader joined your circle - Reader.',
    relatedType: 'user',
    relatedId: new mongoose.Types.ObjectId(),
    eventKey: `seed-${(notifSeed += 1)}-${Date.now()}`,
    ...overrides,
  });
}

function listNotifs(token, query = {}) {
  const qs = new URLSearchParams(query).toString();
  return request(app)
    .get(`/api/v1/notifications${qs ? `?${qs}` : ''}`)
    .set('Authorization', `Bearer ${token}`);
}

function markRead(token, id) {
  return request(app)
    .patch(`/api/v1/notifications/${id}/read`)
    .set('Authorization', `Bearer ${token}`);
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

let alice; // notification owner
let bob; // second user (rows must never leak across)

beforeAll(async () => {
  mongod = await startTestDb([
    User,
    RefreshToken,
    Follow,
    Poem,
    PoemVersion,
    Reaction,
    Comment,
    CollabPoem,
    Duel,
    DuelVote,
    Notification,
  ]);
  httpServer = http.createServer(app);
  io = createSocketServer(httpServer, { corsOrigins: '*' });
  await new Promise((resolve) => httpServer.listen(0, resolve));
  serverPort = httpServer.address().port;

  alice = await register('Alice Owner');
  bob = await register('Bob Other');
});

afterAll(async () => {
  io?.close();
  await new Promise((resolve) => httpServer.close(resolve));
  await stopTestDb(mongod);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GET /notifications — list (plan 78, §5)', () => {
  test('401 without a token', async () => {
    const res = await request(app).get('/api/v1/notifications');
    expect(res.status).toBe(401);
  });

  test('own rows only + unreadCount ignores other users', async () => {
    await Notification.deleteMany({});
    await makeNotification(alice.user.id, { poeticMessage: 'mine 1', readAt: null });
    await makeNotification(alice.user.id, { poeticMessage: 'mine 2', readAt: new Date() });
    await makeNotification(alice.user.id, { poeticMessage: 'mine 3', readAt: null });
    await makeNotification(bob.user.id, { poeticMessage: 'theirs 1', readAt: null });
    await makeNotification(bob.user.id, { poeticMessage: 'theirs 2', readAt: null });

    const res = await listNotifs(alice.accessToken);
    expect(res.status).toBe(200);
    const { items, unreadCount, nextCursor } = res.body.data;
    expect(items).toHaveLength(3);
    expect(items.map((n) => n.poeticMessage).sort()).toEqual(['mine 1', 'mine 2', 'mine 3']);
    expect(unreadCount).toBe(2);
    expect(nextCursor).toBeNull();
    expect(items.every((n) => !('userId' in n))).toBe(true);
    expect(items.filter((n) => n.isUnread)).toHaveLength(2);
  });

  test('cursor pagination walks newest → oldest without overlap', async () => {
    await Notification.deleteMany({});
    const base = Date.now();
    const docs = [];
    for (let i = 0; i < 5; i++) {
      docs.push(
        await makeNotification(alice.user.id, {
          poeticMessage: `page row ${i}`,
          createdAt: new Date(base + i * 1000),
        }),
      );
    }

    const first = await listNotifs(alice.accessToken, { limit: '2' });
    expect(first.status).toBe(200);
    const page1 = first.body.data;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    expect(page1.items[0].poeticMessage).toBe('page row 4');
    expect(page1.items[1].poeticMessage).toBe('page row 3');

    const second = await listNotifs(alice.accessToken, {
      limit: '2',
      cursor: page1.nextCursor,
    });
    expect(second.status).toBe(200);
    const page2 = second.body.data;
    expect(page2.items.map((n) => n.poeticMessage)).toEqual(['page row 2', 'page row 1']);
    const ids = new Set([...page1.items, ...page2.items].map((n) => n.id));
    expect(ids.size).toBe(4);
  });

  test('limit out of range → 400', async () => {
    for (const limit of ['0', '51']) {
      const res = await listNotifs(alice.accessToken, { limit });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
  });
});

describe('PATCH /notifications/:id/read (plan 78, §5)', () => {
  test('mark as read → isUnread false, readAt persisted; second call idempotent', async () => {
    const row = await makeNotification(alice.user.id, { readAt: null });

    const first = await markRead(alice.accessToken, row.id);
    expect(first.status).toBe(200);
    expect(first.body.data.isUnread).toBe(false);
    expect(first.body.data.readAt).toBeTruthy();
    const afterFirst = first.body.data.readAt;

    const again = await markRead(alice.accessToken, row.id);
    expect(again.status).toBe(200);
    expect(again.body.data.isUnread).toBe(false);
    expect(again.body.data.readAt).toBe(afterFirst);

    const dbRow = await Notification.findById(row.id).lean();
    expect(dbRow.readAt).not.toBeNull();
  });

  test("another user's row → 404 NOTIFICATION_NOT_FOUND", async () => {
    const row = await makeNotification(bob.user.id, { readAt: null });
    const res = await markRead(alice.accessToken, row.id);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    const stillUnread = await Notification.findById(row.id).lean();
    expect(stillUnread.readAt).toBeNull();
  });

  test('malformed id → 400', async () => {
    const res = await markRead(alice.accessToken, 'not-an-id');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('worker job — idempotency + templates (11.5, §10.15, plan 79)', () => {
  const payload = () => ({
    recipientId: alice.user.id,
    type: 'reaction',
    relatedType: 'poem',
    relatedId: String(new mongoose.Types.ObjectId()),
    eventKey: `reaction:${new mongoose.Types.ObjectId()}`,
    actor: { id: bob.user.id, displayName: 'Bob Other', username: 'ignored' },
    occurredAt: new Date().toISOString(),
  });

  test('same eventKey processed twice → exactly one row', async () => {
    await Notification.deleteMany({ eventKey: { $regex: '^reaction:' } });
    const jobData = payload();

    const first = await processNotificationJob({ data: jobData });
    expect(first.duplicate).toBe(false);
    expect(first.notificationId).toBeTruthy();

    const second = await processNotificationJob({ data: jobData });
    expect(second.duplicate).toBe(true);
    expect(second.duplicateOf).toBe(first.notificationId);

    expect(await Notification.countDocuments({ eventKey: jobData.eventKey })).toBe(1);
  });

  test('poetic template renders the actor name from the bank', async () => {
    await Notification.deleteMany({ eventKey: { $regex: '^reaction:' } });
    const jobData = payload();
    await processNotificationJob({ data: jobData });

    const row = await Notification.findOne({ eventKey: jobData.eventKey }).lean();
    const expected = TEMPLATES.reaction.map((t) => t.split('{actor}').join('Bob Other'));
    expect(expected).toContain(row.poeticMessage);
  });

  test('anonymous actor renders as "Someone"', async () => {
    await Notification.deleteMany({ eventKey: { $regex: '^comment:' } });
    const jobData = {
      ...payload(),
      type: 'comment',
      eventKey: `comment:${new mongoose.Types.ObjectId()}`,
      actor: null,
    };
    await processNotificationJob({ data: jobData });

    const row = await Notification.findOne({ eventKey: jobData.eventKey }).lean();
    const expected = TEMPLATES.comment.map((t) => t.split('{actor}').join('Someone'));
    expect(expected).toContain(row.poeticMessage);
  });

  test('recipient missing → job completes without a row', async () => {
    const jobData = { ...payload(), recipientId: new mongoose.Types.ObjectId() };
    const res = await processNotificationJob({ data: jobData });
    expect(res.duplicate).toBe(true);
    expect(res.skipped).toBe('recipient-missing');
  });

  test('missing eventKey → job completes without a row', async () => {
    const res = await processNotificationJob({ data: { ...payload(), eventKey: undefined } });
    expect(res.duplicate).toBe(true);
    expect(res.skipped).toBe('missing-event-key');
  });
});

describe('socket fan-out notification:push (plan 79)', () => {
  test('connected recipient receives the serialized row', async () => {
    await Notification.deleteMany({ eventKey: { $regex: '^reaction:' } });
    const socket = connectSocket(alice.accessToken);
    await connectSuccess(socket);

    try {
      const jobData = {
        recipientId: alice.user.id,
        type: 'reaction',
        relatedType: 'poem',
        relatedId: String(new mongoose.Types.ObjectId()),
        eventKey: `reaction:${new mongoose.Types.ObjectId()}`,
        actor: { id: bob.user.id, displayName: 'Bob Other' },
        occurredAt: new Date().toISOString(),
      };
      const waiting = waitForEvent(socket, 'notification:push');
      const result = await processNotificationJob({ data: jobData });
      expect(result.duplicate).toBe(false);

      const payload = await waiting;
      expect(payload.id).toBe(result.notificationId);
      expect(payload.type).toBe('reaction');
      expect(payload.isUnread).toBe(true);
      expect(payload.poeticMessage).toContain('Bob Other');
      expect(payload.relatedId).toBe(jobData.relatedId);
      expect(payload.readAt).toBeNull();
    } finally {
      socket.close();
    }
  });

  test('a duplicate job does not re-emit notification:push', async () => {
    await Notification.deleteMany({ eventKey: { $regex: '^reaction:' } });
    const socket = connectSocket(alice.accessToken);
    await connectSuccess(socket);

    try {
      const jobData = {
        recipientId: alice.user.id,
        type: 'reaction',
        relatedType: 'poem',
        relatedId: String(new mongoose.Types.ObjectId()),
        eventKey: `reaction:${new mongoose.Types.ObjectId()}`,
        actor: null,
        occurredAt: new Date().toISOString(),
      };
      const waiting = waitForEvent(socket, 'notification:push');
      await processNotificationJob({ data: jobData });
      await waiting;

      let emitted = false;
      socket.on('notification:push', () => {
        emitted = true;
      });
      const second = await processNotificationJob({ data: jobData });
      expect(second.duplicate).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(emitted).toBe(false);
    } finally {
      socket.close();
    }
  });
});

describe('Expo push delivery (plan 80)', () => {
  test('no push token → deliverNotificationPush quiet no-op (no fetch)', async () => {
    await User.updateOne({ _id: alice.user.id }, { $set: { pushToken: '' } });
    const { deliverNotificationPush } = require('../../src/jobs/notifications');
    const res = await deliverNotificationPush(alice.user.id, { id: 'noid', poeticMessage: 'x' }, {
      fetchImpl: async () => {
        throw new Error('should not fetch without a token');
      },
    });
    expect(res).toEqual({ attempted: false, reason: 'no-token' });
  });

  test('network failure → job completes, logs push:delivery-failed', async () => {
    await User.updateOne({ _id: alice.user.id }, { $set: { pushToken: 'ExpoPushToken[ok]' } });
    const warnSpy = jest.spyOn(logger, 'warn');

    await Notification.deleteMany({ eventKey: { $regex: '^reaction:' } });
    const jobData = {
      recipientId: alice.user.id,
      type: 'reaction',
      relatedType: 'poem',
      relatedId: String(new mongoose.Types.ObjectId()),
      eventKey: `reaction:${new mongoose.Types.ObjectId()}`,
      actor: { id: bob.user.id, displayName: 'Bob Other' },
      occurredAt: new Date().toISOString(),
    };

    const res = await processNotificationJob({
      data: jobData,
      fetchImpl: async () => {
        throw new Error('network down');
      },
    });
    expect(res.duplicate).toBe(false);
    expect(res.push.attempted).toBe(true);
    expect(res.push.delivered).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'push:delivery-failed' }),
      expect.any(String),
    );
    // the row still exists: push failure never fails the job
    expect(await Notification.countDocuments({ eventKey: jobData.eventKey })).toBe(1);
    await User.updateOne({ _id: alice.user.id }, { $set: { pushToken: '' } });
  });

  test('DeviceNotRegistered → token cleared for future attempts', async () => {
    await User.updateOne({ _id: alice.user.id }, { $set: { pushToken: 'ExpoPushToken[dead]' } });
    const warnSpy = jest.spyOn(logger, 'warn');

    const res = await deliverExpoPush(
      { token: 'ExpoPushToken[dead]', title: 't', body: 'b' },
      {
        userId: alice.user.id,
        fetchImpl: async () => ({
          ok: true,
          json: async () => ({ data: [{ status: 'error', details: { error: 'DeviceNotRegistered' } }] }),
        }),
      },
    );
    expect(res.delivered).toBe(false);
    expect(res.reason).toBe('DeviceNotRegistered');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'push:token-cleared', error: 'DeviceNotRegistered' }),
      expect.any(String),
    );
    const user = await User.findById(alice.user.id).lean();
    expect(user.pushToken).toBe('');
  });

  test('HTTP non-2xx → logged failure, delivered false', async () => {
    const res = await deliverExpoPush(
      { token: 'ExpoPushToken[x]', title: 't', body: 'b' },
      { fetchImpl: async () => ({ ok: false, status: 503 }) },
    );
    expect(res).toMatchObject({ attempted: true, delivered: false, reason: 'http-503' });
  });

  test('delivered → { attempted: true, delivered: true }', async () => {
    const res = await deliverExpoPush(
      { token: 'ExpoPushToken[good]', title: 't', body: 'b' },
      { fetchImpl: async () => ({ ok: true, json: async () => ({ data: [{ status: 'ok' }] }) }) },
    );
    expect(res).toEqual({ attempted: true, delivered: true });
  });
});

describe('Redis-down degradation (0.5 step 3, plan 79)', () => {
  test('dispatchNotification → { queued:false, reason:"redis-down" } without throwing', async () => {
    const res = await dispatcher.dispatchNotification({
      recipientId: alice.user.id,
      type: 'follow',
      relatedType: 'user',
      relatedId: bob.user.id,
      eventKey: `follow:${bob.user.id}:${alice.user.id}`,
      actor: { id: bob.user.id },
    });
    expect(res).toEqual({ queued:false, reason: 'redis-down' });
  });

  test('invalid payload → { queued:false, reason:"invalid" }', async () => {
    const res = await dispatcher.dispatchNotification({ recipientId: alice.user.id });
    expect(res).toEqual({ queued: false, reason: 'invalid' });
  });

  test('startNotificationsWorker skips cleanly when Redis is down', () => {
    expect(startNotificationsWorker()).toEqual({ started: false, reason: 'redis-down' });
  });
});

describe('templates (plan 79)', () => {
  test('every type renders a bank phrase for rng edges', () => {
    for (const type of Object.keys(TEMPLATES)) {
      for (const rng of [() => 0, () => 0.999]) {
        const msg = renderPoeticMessage({ type, actorName: 'Test Actor' }, rng);
        expect(TEMPLATES[type].map((t) => t.split('{actor}').join('Test Actor'))).toContain(msg);
      }
    }
  });

  test('missing actorName → "Someone"', () => {
    const msg = renderPoeticMessage({ type: 'follow' }, () => 0);
    expect(msg).toContain('Someone');
  });

  test('unknown type throws', () => {
    expect(() => renderPoeticMessage({ type: 'nope' })).toThrow('Unknown notification type');
  });
});

describe('producers dispatch after their primary write (plan 79)', () => {
  let dispatched;
  let spy;

  beforeEach(() => {
    dispatched = [];
    spy = jest.spyOn(dispatcher, 'dispatchNotification').mockImplementation(async (input) => {
      dispatched.push(input);
      return { queued: true };
    });
  });

  afterEach(() => {
    spy.mockRestore();
  });

  test('reaction → one dispatch to the poem author with a reaction eventKey', async () => {
    const author = await register('Author One');
    const reader = await register('Reacting Reader');
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'loved' });
    expect(res.status).toBe(201);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe('reaction');
    expect(dispatched[0].relatedType).toBe('poem');
    expect(String(dispatched[0].recipientId)).toBe(author.user.id);
    expect(String(dispatched[0].relatedId)).toBe(poem.id);
    expect(dispatched[0].eventKey).toMatch(/^reaction:/);
    expect(dispatched[0].actor).toMatchObject({ id: reader.user.id, displayName: 'Reacting Reader' });
  });

  test('anonymous reaction → actor null', async () => {
    const author = await register('Author Two');
    const reader = await register('Quiet Reader');
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${reader.accessToken}`)
      .send({ type: 'dark', anonymous: true });
    expect(res.status).toBe(201);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].actor).toBeNull();
    expect(String(dispatched[0].recipientId)).toBe(author.user.id);
  });

  test('reaction on own poem → no dispatch', async () => {
    const author = await register('Author Three');
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post(`/api/v1/poems/${poem.id}/reactions`)
      .set('Authorization', `Bearer ${author.accessToken}`)
      .send({ type: 'beautiful' });
    expect(res.status).toBe(201);
    expect(dispatched).toHaveLength(0);
  });

  test('comment → one dispatch to the author', async () => {
    const author = await register('Author Four');
    const commenter = await register('Commenter');
    const poem = await createPublishedPoem(author.accessToken);

    const res = await request(app)
      .post('/api/v1/comments')
      .set('Authorization', `Bearer ${commenter.accessToken}`)
      .send({ targetType: 'poem', targetId: poem.id, content: 'these lines stayed with me' });
    expect(res.status).toBe(201);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe('comment');
    expect(dispatched[0].relatedType).toBe('poem');
    expect(String(dispatched[0].recipientId)).toBe(author.user.id);
    expect(String(dispatched[0].relatedId)).toBe(poem.id);
    expect(dispatched[0].eventKey).toMatch(/^comment:/);
  });

  test('follow → dispatch to the target with a deterministic eventKey', async () => {
    const target = await register('Follow Target');
    const follower = await register('Follower');

    const res = await request(app)
      .post(`/api/v1/users/${target.user.id}/follow`)
      .set('Authorization', `Bearer ${follower.accessToken}`);
    expect(res.status).toBe(201);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toMatchObject({
      recipientId: target.user.id,
      type: 'follow',
      relatedType: 'user',
      relatedId: follower.user.id,
      eventKey: `follow:${follower.user.id}:${target.user.id}`,
    });
    expect(dispatched[0].actor).toEqual({ id: follower.user.id });
  });

  test('collab turn → notifies the creator; own turn stays silent', async () => {
    const creator = await register('Collab Creator');
    const poet = await register('Collab Poet');

    const created = await request(app)
      .post('/api/v1/collab-poems')
      .set('Authorization', `Bearer ${creator.accessToken}`)
      .send({ title: 'Relay', linesPerTurn: 2 });
    expect(created.status).toBe(201);
    const collabId = created.body.data.id;

    const turn = await request(app)
      .post(`/api/v1/collab-poems/${collabId}/turns`)
      .set('Authorization', `Bearer ${poet.accessToken}`)
      .send({ content: 'first two lines\nsecond of them' });
    expect(turn.status).toBe(201);
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].type).toBe('collab_turn');
    expect(dispatched[0].relatedType).toBe('collab_poem');
    expect(String(dispatched[0].recipientId)).toBe(creator.user.id);
    expect(String(dispatched[0].relatedId)).toBe(collabId);
    expect(dispatched[0].eventKey).toContain(collabId);

    const own = await request(app)
      .post(`/api/v1/collab-poems/${collabId}/turns`)
      .set('Authorization', `Bearer ${creator.accessToken}`)
      .send({ content: 'creator takes a turn\ntoo' });
    expect(own.status).toBe(201);
    expect(dispatched).toHaveLength(1); // creator's own turn → no self-notify
  });

  test('duel results → both poets dispatched with per-poet eventKeys; open duel silent', async () => {
    const closed = await Duel.create({
      theme: 'Moon',
      poetAId: new mongoose.Types.ObjectId(),
      poetBId: new mongoose.Types.ObjectId(),
      poemAId: new mongoose.Types.ObjectId(),
      poemBId: new mongoose.Types.ObjectId(),
      submissionDeadline: new Date(Date.now() - 60_000),
      votingDeadline: new Date(Date.now() - 30_000),
      status: 'closed',
    });

    const first = duelService.dispatchDuelResults(closed);
    expect(first.dispatched).toBe(true);
    expect(dispatched).toHaveLength(2);
    const keys = dispatched.map((d) => d.eventKey).sort();
    expect(keys).toEqual([
      `duel_result:${closed._id}:${closed.poetAId}`,
      `duel_result:${closed._id}:${closed.poetBId}`,
    ].sort());
    expect(dispatched.every((d) => d.type === 'duel_result' && d.relatedType === 'duel')).toBe(true);

    // repeated observation → identical eventKeys (idempotent downstream)
    dispatched.length = 0;
    duelService.dispatchDuelResults(closed);
    expect(dispatched.map((d) => d.eventKey).sort()).toEqual(keys);

    // still inside voting → no dispatch
    dispatched.length = 0;
    const open = await Duel.create({
      theme: 'Tide',
      poetAId: new mongoose.Types.ObjectId(),
      poetBId: new mongoose.Types.ObjectId(),
      poemAId: new mongoose.Types.ObjectId(),
      poemBId: new mongoose.Types.ObjectId(),
      submissionDeadline: new Date(Date.now() - 1000),
      votingDeadline: new Date(Date.now() + 60_000),
      status: 'voting',
    });
    const res = duelService.dispatchDuelResults(open);
    expect(res.dispatched).toBe(false);
    expect(dispatched).toHaveLength(0);
  });
});

describe('PUT /users/me/push-token (plan 80)', () => {
  test('set → stored; null → cleared', async () => {
    const user = await register('Push Owner');

    const set = await request(app)
      .put('/api/v1/users/me/push-token')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ token: 'ExpoPushToken[abc]' });
    expect(set.status).toBe(200);
    expect(set.body.data.pushToken).toBe('ExpoPushToken[abc]');
    let dbRow = await User.findById(user.user.id).lean();
    expect(dbRow.pushToken).toBe('ExpoPushToken[abc]');

    const clear = await request(app)
      .put('/api/v1/users/me/push-token')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ token: null });
    expect(clear.status).toBe(200);
    expect(clear.body.data.pushToken).toBe('');
    dbRow = await User.findById(user.user.id).lean();
    expect(dbRow.pushToken).toBe('');
  });

  test('401 without token; 400 on wrong shape', async () => {
    const user = await register('Push Guard');
    const unauth = await request(app)
      .put('/api/v1/users/me/push-token')
      .send({ token: 'x' });
    expect(unauth.status).toBe(401);

    const bad = await request(app)
      .put('/api/v1/users/me/push-token')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ token: 12345 });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('explain() — inbox hot path (11.5 gate, §4)', () => {
  beforeAll(async () => {
    await Notification.deleteMany({});
    const now = Date.now();
    const rows = [];
    for (let i = 0; i < 40; i++) {
      rows.push({
        userId: alice.user.id,
        type: 'follow',
        poeticMessage: `seed ${i}`,
        relatedType: 'user',
        relatedId: new mongoose.Types.ObjectId(),
        eventKey: `explain-${i}-${now}`,
        readAt: i % 2 === 0 ? new Date(now - i * 1000) : null,
        createdAt: new Date(now - i * 1000),
      });
    }
    for (let i = 0; i < 40; i++) {
      rows.push({
        userId: bob.user.id,
        type: 'follow',
        poeticMessage: `decoy ${i}`,
        relatedType: 'user',
        relatedId: new mongoose.Types.ObjectId(),
        eventKey: `explain-decoy-${i}-${now}`,
        readAt: null,
        createdAt: new Date(now - i * 1000),
      });
    }
    await Notification.insertMany(rows);
  });

  test('unread inbox query wins IXSCAN on { userId, readAt, createdAt }', async () => {
    const explain = await Notification.find({ userId: alice.user.id, readAt: null })
      .sort({ createdAt: -1 })
      .limit(20)
      .explain('executionStats');
    const json = JSON.stringify(explain);
    expect(json).toContain('userId_1_readAt_1_createdAt_-1');
    expect(json).toContain('IXSCAN');
    expect(json).not.toContain('COLLSCAN');
  });

  test('unreadCount through the service stays a single indexed count', async () => {
    const page = await notificationsService.listNotifications({ id: alice.user.id }, { limit: 10 });
    expect(page.unreadCount).toBe(20);
    expect(page.items).toHaveLength(10);
    expect(page.nextCursor).toBeTruthy();
  });
});
