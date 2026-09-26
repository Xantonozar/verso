'use strict';

const request = require('supertest');
const { createApp } = require('../../src/app');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refresh-token.model');
const { Follow } = require('../../src/modules/users/follow.model');
const { startTestDb, stopTestDb } = require('../helpers/testDb');

const app = createApp();
let mongod;
let seq = 0;

const uniq = () => `t${Date.now().toString(36)}${(seq++).toString(36)}`;

async function register(overrides = {}) {
  const id = uniq();
  return request(app).post('/api/v1/auth/register').send({
    username: `user_${id}`,
    displayName: 'Test User',
    email: `${id}@example.com`,
    password: 'Password1',
    ...overrides,
  });
}

async function login(identifier, password) {
  return request(app).post('/api/v1/auth/login').send({ identifier, password });
}

beforeAll(async () => {
  mongod = await startTestDb([User, RefreshToken, Follow]);
}, 120_000);

afterAll(async () => {
  await stopTestDb(mongod);
});

describe('POST /auth/register', () => {
  test('success → 201 with user, access + refresh tokens', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.username).toMatch(/^user_/);
    expect(res.body.data.user.email).toContain('@example.com');
    expect(res.body.data.accessToken.split('.')).toHaveLength(3);
    expect(res.body.data.refreshToken).toBeTruthy();
    // passwordHash must never appear in any response
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('Password1');
  });

  test('duplicate email → 409 with field detail (no enumeration worry: register is allowed to say so)', async () => {
    const first = await register();
    expect(first.status).toBe(201);

    const res = await register({ email: first.body.data.user.email });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUTH_EMAIL_TAKEN');
    expect(res.body.error.details.field).toBe('email');
  });

  test('duplicate username → 409 with field detail', async () => {
    const first = await register();
    expect(first.status).toBe(201);

    const res = await register({ username: first.body.data.user.username });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('AUTH_USERNAME_TAKEN');
    expect(res.body.error.details.field).toBe('username');
  });

  test('weak password (too short) → 400 with password field detail', async () => {
    const res = await register({ password: 'Sh0rt' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'password')).toBe(true);
  });

  test('weak password (no number) → 400 with password field detail', async () => {
    const res = await register({ password: 'longpasswordonly' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'password')).toBe(true);
  });

  test('weak password (no letter) → 400 with password field detail', async () => {
    const res = await register({ password: '12345678' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'password')).toBe(true);
  });

  test('invalid email → 400 with email field detail', async () => {
    const res = await register({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'email')).toBe(true);
  });

  test('invalid username (too short / bad chars) → 400 with username field detail', async () => {
    const short = await register({ username: 'ab' });
    expect(short.status).toBe(400);
    expect(short.body.error.details.some((d) => d.field === 'username')).toBe(true);

    const badChars = await register({ username: 'has space!' });
    expect(badChars.status).toBe(400);
    expect(badChars.body.error.details.some((d) => d.field === 'username')).toBe(true);
  });
});

describe('POST /auth/login', () => {
  test('success with email → 200 tokens', async () => {
    const created = await register();
    const { email } = created.body.data.user;

    const res = await login(email, 'Password1');
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
  });

  test('success with username (case-insensitive) → 200 tokens', async () => {
    const created = await register();
    const { username } = created.body.data.user;

    const res = await login(username.toUpperCase(), 'Password1');
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
  });

  test('wrong password → 401 AUTH_INVALID_CREDENTIALS', async () => {
    const created = await register();
    const res = await login(created.body.data.user.email, 'WrongPass1');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  test('unknown email → 401 identical to wrong-password (no user enumeration)', async () => {
    const created = await register();
    const wrongPw = await login(created.body.data.user.email, 'WrongPass1');
    const unknown = await login(`${uniq()}@example.com`, 'WrongPass1');

    expect(wrongPw.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect({
      code: unknown.body.error.code,
      message: unknown.body.error.message,
    }).toEqual({
      code: wrongPw.body.error.code,
      message: wrongPw.body.error.message,
    });
  });

  test('missing password → 400', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ identifier: 'someone' });
    expect(res.status).toBe(400);
    expect(res.body.error.details.some((d) => d.field === 'password')).toBe(true);
  });
});
