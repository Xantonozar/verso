'use strict';

const { logger } = require('../config/logger');
const { RateLimitError } = require('../errors');

/**
 * Fixed-window rate limiting (Phase 0.5 step 21), §7.3: 30 req/min on all
 * /auth routes. The store is injectable so we degrade to in-memory when Redis
 * is down (and tests run with no Redis at all).
 */

const EVAL_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local t = redis.call('PTTL', KEYS[1])
return { c, t }
`;

class MemoryRateLimitStore {
  constructor({ now = Date.now, maxKeys = 10000 } = {}) {
    this.now = now;
    this.map = new Map();
    this.maxKeys = maxKeys;
  }

  async hit(key, windowMs) {
    const now = this.now();
    let entry = this.map.get(key);
    if (!entry || entry.expiresAt <= now) {
      entry = { count: 0, expiresAt: now + windowMs };
      this.map.set(key, entry);
    }
    entry.count += 1;

    if (this.map.size > this.maxKeys) {
      for (const [k, v] of this.map) {
        if (v.expiresAt <= now) this.map.delete(k);
      }
      if (this.map.size > this.maxKeys) this.map.delete(this.map.keys().next().value);
    }

    return { count: entry.count, remainingMs: entry.expiresAt - now };
  }
}

class RedisRateLimitStore {
  constructor(getClient) {
    this.getClient = typeof getClient === 'function' ? getClient : () => getClient;
    this.fallback = new MemoryRateLimitStore();
    this.warned = false;
  }

  async hit(key, windowMs) {
    try {
      const client = this.getClient();
      if (!client || client.isOpen === false) throw new Error('redis unavailable');
      const result = await client.eval(EVAL_SCRIPT, {
        keys: [`verso:rl:${key}`],
        arguments: [String(windowMs)],
      });
      this.warned = false;
      return { count: Number(result[0]), remainingMs: Number(result[1]) };
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        logger.warn(
          { event: 'rate-limit:redis-degraded', reason: err.message },
          'Redis unavailable — rate limiting falls back to memory',
        );
      }
      return this.fallback.hit(key, windowMs);
    }
  }
}

/**
 * Factory.
 *   max / windowMs — allowed hits per window per key
 *   scope          — logical bucket in the counter key (e.g. 'auth')
 *   keyFor         — (req) => string, defaults to scope:ip+path
 */
function createRateLimiter({
  store,
  max = 30,
  windowMs = 60_000,
  scope = 'default',
  keyFor = (req) => `${scope}:${req.ip}`,
} = {}) {
  const limiter = async (req, res, next) => {
    try {
      const { count, remainingMs } = await store.hit(keyFor(req), windowMs);
      res.setHeader('X-RateLimit-Limit', String(max));
      res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - count)));

      if (count > max) {
        const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
        logger.warn(
          {
            event: 'rate-limit:exceeded',
            scope,
            ip: req.ip,
            path: req.path,
            count,
            max,
          },
          'Rate limit exceeded',
        );
        return next(
          new RateLimitError('Too many requests — please retry later', {
            retryAfterSeconds,
            limit: max,
            windowMs,
          }),
        );
      }
      return next();
    } catch (err) {
      logger.warn({ event: 'rate-limit:error', scope, reason: err.message }, 'Rate limiter error');
      return next();
    }
  };
  limiter.scope = scope;
  return limiter;
}

/**
 * Auth-bruteforce limiter (§7.3): 30 req/min per IP across /api/v1/auth.
 * Scoped by IP + path so login/signup are each capped, not the whole mount.
 */
function createAuthRateLimiter({ store, max = 30, windowMs = 60_000 } = {}) {
  return createRateLimiter({
    store: store || new RedisRateLimitStore(() => require('../config/redis').getRedis()),
    max,
    windowMs,
    scope: 'auth',
    keyFor: (req) => `auth:${req.ip}:${req.method}:${req.path}`,
  });
}

module.exports = {
  createRateLimiter,
  createAuthRateLimiter,
  MemoryRateLimitStore,
  RedisRateLimitStore,
};
