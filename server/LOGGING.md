# Logging (§7.2)

Structured JSON via **pino** (`src/config/logger.js`), one line per event.

## Rules

- **Always** log objects (`logger.info({ event, ... }, 'message')`) — never string-concatenate state into the message.
- Every event carries a stable `event` key in snake/lower camel (`http:error`, `job:enqueued`, `socket:connected`).
- HTTP requests are logged by `pino-http`; `/health` is excluded from access logs.
- **The global error middleware is the only place that logs request failures** (`event: 'http:error'`), including `requestId`, method, path, status, code, and (server-side) the stack.

## Correlation

- `req.id` comes from the incoming `X-Request-Id` header, or is generated (UUID).
- The id is echoed back in the `X-Request-Id` response header and included in every error log and error body (`error.stack` region in dev only).
- Jobs/sockets carry their own ids (`jobId`, `socketId`) in every log line.

## Levels

| Level | Use |
|---|---|
| `fatal` | process exiting (uncaught exception, boot failure, invalid env) |
| `error` | request failed (5xx), job dead-lettered, worker crashed |
| `warn` | request failed (4xx/429), Redis degraded, socket auth rejected, retry scheduled |
| `info` | boot/lifecycle, job enqueued/started/completed, socket connect/disconnect |
| `debug` | high-frequency diagnostics |

## BullMQ lifecycle (§7.2)

`job:enqueued` → `job:started` → `job:completed` | `job:retry-scheduled` (with attempt count) | `job:failed-permanent` (copied to `verso:dead-letter`).

## Environment

`LOG_LEVEL` (`fatal…trace`, `silent`) — validated by `src/config/env.js` at boot.
Dev/test: pretty-printed via `pino-pretty`. Production: raw JSON to stdout.
