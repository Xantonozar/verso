'use strict';

const request = require('supertest');
const crypto = require('crypto');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `r${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register() {
  const id = uniq();
  const res = await request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Refresh User',
    email: `${id}@example.com`,
    password: 'Password1',
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

async function refresh(token) {
  return request(app).post('/api/v1/auth/refresh').send({ refreshToken: token });
}

function statusOf(rawToken) {
  // The service looks tokens up by SHA-256 hash — recompute it for assertions.
  const hash = crypto.createHash('sha256').update(rawToken).digest('hex');
  return RefreshToken.findOne({ tokenHash: hash }).lean();
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /auth/refresh — rotation', () => {
  test('valid token → 200 with a NEW access + refresh pair; old token becomes rotated', async () => {
    const { accessToken, refreshToken: oldToken } = await register();

    const res = await refresh(oldToken);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.refreshToken).not.toBe(oldToken);
    expect(res.body.data.accessToken).not.toBe(accessToken);

    const oldDoc = await statusOf(oldToken);
    expect(oldDoc.status).toBe('rotated');
    expect(oldDoc.replacedByTokenId).toBeTruthy();
  });

  test('rotated token still refreshes its chain (new token is active)', async () => {
    const { refreshToken: t0 } = await register();
    const r1 = await refresh(t0);
    expect(r1.status).toBe(200);

    const r2 = await refresh(r1.body.data.refreshToken);
    expect(r2.status).toBe(200);

    const newDoc = await statusOf(r2.body.data.refreshToken);
    expect(newDoc.status).toBe('active');
  });

  test('unknown/garbage token → 401 AUTH_REFRESH_INVALID', async () => {
    const res = await refresh('not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REFRESH_INVALID');
  });
});

describe('POST /auth/refresh — reuse detection (§7 step 27)', () => {
  test('replaying a rotated token revokes the ENTIRE family → 401 AUTH_REFRESH_REUSED', async () => {
    const { refreshToken: t0 } = await register();
    const r1 = await refresh(t0);
    expect(r1.status).toBe(200);
    const t1 = r1.body.data.refreshToken;

    // Attacker replays the already-rotated t0
    const reuse = await refresh(t0);
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('AUTH_REFRESH_REUSED');

    // The victim's legitimate successor token is now dead too (family revoked)
    const afterFamilyRevoked = await refresh(t1);
    expect(afterFamilyRevoked.status).toBe(401);

    const t1Doc = await statusOf(t1);
    expect(t1Doc.status).toBe('revoked');
    const t0Doc = await statusOf(t0);
    expect(t0Doc.status).toBe('revoked');
  });

  test('a revoked token (after logout) presented to refresh → 401', async () => {
    const { refreshToken: t0 } = await register();

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: t0 });
    expect(logoutRes.status).toBe(200);

    const res = await refresh(t0);
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout & logout-all', () => {
  test('logout revokes the whole family (refresh afterwards fails)', async () => {
    const { refreshToken: t0 } = await register();
    const r1 = await refresh(t0);
    expect(r1.status).toBe(200);

    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: r1.body.data.refreshToken });
    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.data.loggedOut).toBe(true);

    const after = await refresh(r1.body.data.refreshToken);
    expect(after.status).toBe(401);
  });

  test('logout with garbage token stays idempotent 200', async () => {
    const res = await request(app).post('/api/v1/auth/logout').send({});
    expect(res.status).toBe(200);
  });

  test('logout-all revokes every session of the user', async () => {
    const user = await register();
    // second session = second login → second family
    const secondLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ identifier: user.user.email, password: 'Password1' });
    expect(secondLogin.status).toBe(200);

    const res = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${user.accessToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.revoked).toBeGreaterThanOrEqual(2);

    const dead1 = await refresh(user.refreshToken);
    const dead2 = await refresh(secondLogin.body.data.refreshToken);
    expect(dead1.status).toBe(401);
    expect(dead2.status).toBe(401);
  });

  test('logout-all requires authentication → 401 AUTH_REQUIRED', async () => {
    const res = await request(app).post('/api/v1/auth/logout-all');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });
});

describe('POST /auth/refresh — expiry', () => {
  test('expired refresh token → 401 AUTH_REFRESH_EXPIRED and is revoked', async () => {
    const { refreshToken: t0 } = await register();
    const doc = await statusOf(t0);
    await RefreshToken.updateOne({ _id: doc._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await refresh(t0);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REFRESH_EXPIRED');

    const after = await statusOf(t0);
    expect(after.status).toBe('revoked');
  });
});
