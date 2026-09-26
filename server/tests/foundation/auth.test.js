'use strict';

const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { requireAuth, optionalAuth, extractBearer, verifyAccessToken } = require('../../src/middleware/auth');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { ok } = require('../../src/middleware/respond');

const SECRET = process.env.JWT_ACCESS_SECRET;

function sign(payload, { secret = SECRET, expiresIn = '10m' } = {}) {
  return jwt.sign(payload, secret, { expiresIn });
}

describe('extractBearer', () => {
  test('parses Authorization headers, tolerates spacing/casing', () => {
    expect(extractBearer('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearer('bearer   spaced ')).toBe('spaced');
    expect(extractBearer('Basic dXNlcjpwdw==')).toBeNull();
    expect(extractBearer(undefined)).toBeNull();
  });
});

describe('verifyAccessToken', () => {
  test('accepts a valid access token', () => {
    const payload = verifyAccessToken(sign({ sub: 'u1', type: 'access' }));
    expect(payload.sub).toBe('u1');
  });

  test('rejects garbage with AUTH_INVALID_TOKEN', () => {
    expect(() => verifyAccessToken('not.a.jwt')).toThrow(/Invalid access token/);
    try {
      verifyAccessToken('not.a.jwt');
    } catch (err) {
      expect(err.code).toBe('AUTH_INVALID_TOKEN');
      expect(err.statusCode).toBe(401);
    }
  });

  test('rejects a token signed with the wrong secret', () => {
    const forged = sign({ sub: 'u1' }, { secret: 'wrong-secret-that-is-long-enough-1234' });
    expect(() => verifyAccessToken(forged)).toThrow(/Invalid/);
  });

  test('rejects expired tokens with AUTH_TOKEN_EXPIRED', () => {
    const expired = jwt.sign({ sub: 'u1' }, SECRET, { expiresIn: -10 });
    try {
      verifyAccessToken(expired);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.code).toBe('AUTH_TOKEN_EXPIRED');
      expect(err.statusCode).toBe(401);
    }
  });

  test('rejects tokens missing sub or with wrong type', () => {
    expect(() => verifyAccessToken(sign({ type: 'access' }))).toThrow(/Invalid/);
    expect(() => verifyAccessToken(sign({ sub: 'u1', type: 'refresh' }))).toThrow(/type/);
  });
});

function buildApp(middleware) {
  const app = express();
  app.get('/me', middleware, (req, res) => ok(res, { user: req.user }));
  app.use(errorHandler);
  return app;
}

describe('requireAuth', () => {
  test('anonymous → 401 AUTH_REQUIRED', async () => {
    const res = await request(buildApp(requireAuth)).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('valid token → req.user.id attached', async () => {
    const token = sign({ sub: 'user-42', type: 'access' });
    const res = await request(buildApp(requireAuth))
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe('user-42');
  });

  test('expired token → 401 AUTH_TOKEN_EXPIRED', async () => {
    const token = jwt.sign({ sub: 'u1' }, SECRET, { expiresIn: -10 });
    const res = await request(buildApp(requireAuth))
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
  });
});

describe('optionalAuth', () => {
  test('anonymous passes through with no user', async () => {
    const res = await request(buildApp(optionalAuth)).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.data.user).toBeUndefined();
  });

  test('valid token attaches user', async () => {
    const token = sign({ sub: 'u9', type: 'access' });
    const res = await request(buildApp(optionalAuth))
      .get('/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data.user.id).toBe('u9');
  });

  test('present-but-invalid token still 401s (no silent downgrade)', async () => {
    const res = await request(buildApp(optionalAuth))
      .get('/me')
      .set('Authorization', 'Bearer bogus.token.here');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });
});
