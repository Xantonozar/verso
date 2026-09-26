'use strict';

const pino = require('pino');

const level = process.env.LOG_LEVEL || 'info';
const isProd = process.env.NODE_ENV === 'production';

// Production: structured JSON to stdout (captured by PM2/log rotation).
// Dev: pretty-ish single-line JSON for readability.
const logger = pino({
  level,
  base: { env: process.env.NODE_ENV || 'development' },
  redact: {
    paths: [
      'password',
      '*.password',
      'passwordHash',
      'token',
      'accessToken',
      'refreshToken',
      'req.headers.authorization',
      'headers.authorization',
      'secret',
      '*.secret',
    ],
    censor: '[REDACTED]',
  },
  ...(isProd
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }),
});

module.exports = { logger };
