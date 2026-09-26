# Redis (§7.3)

## Role

Redis is **optional infrastructure**: caching and rate limiting degrade, the API keeps serving. MongoDB is the only hard dependency at boot.

## Clients

| Client | Module | Used for |
|---|---|---|
| `node-redis` v6 | `src/config/redis.js` | cache, rate-limit counters |
| `ioredis` v6 | `src/jobs/connection.js` | BullMQ (requires `maxRetriesPerRequest: null`) |

## Degradation contract

- `connectRedis()` races connect against a **3s timeout** — boot never blocks on Redis.
- On connection error the client logs `redis:error` **once per outage** (`warn`) and keeps retrying (backoff ≤ 5s). When Redis returns, `redis:ready` re-enables usage — no restart.
- Consumers must check `isRedisUp()` (cache paths) or rely on store-level fallback.

## Rate limiting

`src/middleware/rateLimit.js`:

- **Redis store** — atomic `INCR` + `PEXPIRE` + `PTTL` via one Lua `EVAL` (fixed window, no key-leak on crash).
- **Memory fallback** — if Redis is down/unavailable, counts fall back to an in-process map (`memory` store, per-instance only) and log `rate-limit:redis-degraded` once.
- **Fail-open** — an unexpected limiter error never blocks the request (`rate-limit:error` warn).
- **Policy (§7.3)**: `/api/v1/auth` → 30 req/min per IP per method+path; exceeded → `429 RATE_LIMITED` with `Retry-After` and `X-RateLimit-*` headers.

Multi-instance deployments need the Redis store (memory fallback doesn't share counts across processes).

## BullMQ

Queues live in Redis (`verso:*` keys). Defaults: 3 attempts, exponential backoff 1s base (`src/jobs/options.js`); permanent failures are copied to the `verso:dead-letter` queue by `src/jobs/worker.js`.

## Local development

No Redis required locally: cache is skipped, rate limiting uses the memory store, job processors aren't exercised by tests. For full behavior run any Redis 7+ (`docker run -p 6379:6379 redis:7`).
