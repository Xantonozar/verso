'use strict';

const express = require('express');
const request = require('supertest');
const {
  MemoryRateLimitStore,
  RedisRateLimitStore,
  createRateLimiter,
} = require('../../src/middleware/rateLimit');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { ok } = require('../../src/middleware/respond');
const { createApp } = require('../../src/app');

describe('MemoryRateLimitStore', () => {
  test('counts hits inside the window and expires afterwards (fake clock)', async () => {
    let now = 1_000_000;
    const store = new MemoryRateLimitStore({ now: () => now });
    const first = await store.hit('k', 10_000);
    expect(first.count).toBe(1);
    expect(first.remainingMs).toBeGreaterThan(0);
    expect((await store.hit('k', 10_000)).count).toBe(2);

    // Advance clock past window
    now += 12_000;
    expect((await store.hit('k', 10_000)).count).toBe(1);
  });

  test('keys are independent', async () => {
    const store = new MemoryRateLimitStore();
    await store.hit('a', 1000);
    expect((await store.hit('b', 1000)).count).toBe(1);
  });
});

describe('RedisRateLimitStore degradation', () => {
  test('falls back to memory when the client is missing', async () => {
    const store = new RedisRateLimitStore(() => null);
    const first = await store.hit('k', 1000);
    expect(first.count).toBe(1);
    expect((await store.hit('k', 1000)).count).toBe(2);
  });

  test('falls back when Redis errors (no throw)', async () => {
    const store = new RedisRateLimitStore(() => ({
      isOpen: true,
      eval: async () => {
        throw new Error('connection lost');
      },
    }));
    await expect(store.hit('k', 1000)).resolves.toMatchObject({ count: 1 });
  });

  test('uses Redis when available', async () => {
    const store = new RedisRateLimitStore(() => ({
      isOpen: true,
      eval: async () => [7, 42_000],
    }));
    await expect(store.hit('k', 60_000)).resolves.toEqual({ count: 7, remainingMs: 42_000 });
  });
});

describe('createRateLimiter', () => {
  function buildApp({ max = 3, windowMs = 1000, keyFor }) {
    const app = express();
    app.use(
      createRateLimiter({
        store: new MemoryRateLimitStore(),
        max,
        windowMs,
        scope: 'test',
        keyFor,
      }),
    );
    app.get('/login', (req, res) => ok(res, { ok: true }));
    app.use(errorHandler);
    return app;
  }

  test('allows up to max, then 429 with Retry-After and X-RateLimit headers', async () => {
    const app = buildApp({ max: 3 });
    for (let i = 1; i <= 3; i++) {
      const res = await request(app).get('/login');
      expect(res.status).toBe(200);
      expect(res.headers['x-ratelimit-limit']).toBe('3');
      expect(res.headers['x-ratelimit-remaining']).toBe(String(3 - i));
    }

    const blocked = await request(app).get('/login');
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBeTruthy();
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.body.error.details.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  test('window expiry resets the counter (fake clock via injected store)', async () => {
    let now = 1_000_000;
    const store = new MemoryRateLimitStore({ now: () => now });
    const app = express();
    app.use(
      createRateLimiter({
        store,
        max: 1,
        windowMs: 5_000,
        scope: 'test',
      }),
    );
    app.get('/login', (req, res) => ok(res, { ok: true }));
    app.use(errorHandler);

    // First request within window
    expect((await request(app).get('/login')).status).toBe(200);
    // Second request still within window -> 429
    expect((await request(app).get('/login')).status).toBe(429);
    // Advance clock past window
    now += 6_000;
    expect((await request(app).get('/login')).status).toBe(200);
  });

  test('distinct keys are limited independently', async () => {
    const app = buildApp({ max: 1, keyFor: (req) => `ip:${req.headers['x-test-ip']}` });
    expect((await request(app).get('/login').set('X-Test-Ip', 'a')).status).toBe(200);
    expect((await request(app).get('/login').set('X-Test-Ip', 'b')).status).toBe(200);
    expect((await request(app).get('/login').set('X-Test-Ip', 'a')).status).toBe(429);
  });
});

describe('app-level /auth limiter (§7.3: 30 req/min)', () => {
  test('31st auth request from one IP is rejected', async () => {
    // setup.js raises AUTH_RATE_LIMIT_MAX suite-wide (integration suites
    // register dozens of users/min); pin the §7.3 default here explicitly.
    const prev = process.env.AUTH_RATE_LIMIT_MAX;
    process.env.AUTH_RATE_LIMIT_MAX = '30';
    try {
      const app = createApp();
      for (let i = 0; i < 30; i++) {
        const res = await request(app).post('/api/v1/auth/login').send({});
        expect(res.status).not.toBe(429);
      }
      const blocked = await request(app).post('/api/v1/auth/login').send({});
      expect(blocked.status).toBe(429);
      expect(blocked.body.error.code).toBe('RATE_LIMITED');

      // Non-auth routes are unaffected
      const health = await request(app).get('/health');
      expect(health.status).toBe(200);
    } finally {
      if (prev === undefined) delete process.env.AUTH_RATE_LIMIT_MAX;
      else process.env.AUTH_RATE_LIMIT_MAX = prev;
    }
  }, 20_000);
});