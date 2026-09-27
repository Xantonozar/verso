'use strict';

/**
 * Unsent Poem fields (Phase 7, plan step 61): isUnsentPoem/unsentRecipientLabel
 * round-trip through create/update/serialize, and a recipient label is only
 * legal while the flag is on (400 at create, 400 at update, cleared on flip).
 */

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Poem } = require('../../src/modules/poems/poem.model');
const { PoemVersion } = require('../../src/modules/poems/poem-version.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `u${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Unsent Tester',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

function postPoem(token, body) {
  return request(app).post('/api/v1/poems').set('Authorization', `Bearer ${token}`).send(body);
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Poem, PoemVersion]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /poems — Unsent Poem fields (plan step 61)', () => {
  test('flag + recipient label round-trip on create', async () => {
    const user = await register();
    const res = await postPoem(user.accessToken, {
      title: 'Never sent',
      content: 'this one stayed in the drawer',
      isUnsentPoem: true,
      unsentRecipientLabel: 'Someone I lost',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.isUnsentPoem).toBe(true);
    expect(res.body.data.unsentRecipientLabel).toBe('Someone I lost');
  });

  test('recipient label without the flag is a 400', async () => {
    const user = await register();
    const res = await postPoem(user.accessToken, {
      title: 'Incoherent',
      content: 'label but no flag',
      unsentRecipientLabel: 'oops',
    });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('unsentRecipientLabel');
  });

  test('defaults are false/empty when omitted', async () => {
    const user = await register();
    const res = await postPoem(user.accessToken, { title: 'Plain', content: 'just a poem' });
    expect(res.status).toBe(201);
    expect(res.body.data.isUnsentPoem).toBe(false);
    expect(res.body.data.unsentRecipientLabel).toBe('');
  });
});

describe('PATCH /poems/:id — Unsent coherence', () => {
  test('owner can enable flag + label, then flipping the flag off clears the label', async () => {
    const user = await register();
    const created = await postPoem(user.accessToken, { title: 'Evolving', content: 'text' });
    const id = created.body.data.id;

    const on = await request(app)
      .patch(`/api/v1/poems/${id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ isUnsentPoem: true, unsentRecipientLabel: 'for you' });
    expect(on.status).toBe(200);
    expect(on.body.data.isUnsentPoem).toBe(true);
    expect(on.body.data.unsentRecipientLabel).toBe('for you');

    const off = await request(app)
      .patch(`/api/v1/poems/${id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ isUnsentPoem: false });
    expect(off.status).toBe(200);
    expect(off.body.data.isUnsentPoem).toBe(false);
    expect(off.body.data.unsentRecipientLabel).toBe('');
  });

  test('label without enabling the flag is a 400', async () => {
    const user = await register();
    const created = await postPoem(user.accessToken, { title: 'No flag', content: 'text' });
    const res = await request(app)
      .patch(`/api/v1/poems/${created.body.data.id}`)
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ unsentRecipientLabel: 'still no flag' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('unsentRecipientLabel');
  });
});
