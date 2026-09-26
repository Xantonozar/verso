'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { pinoHttp } = require('pino-http');
const { logger } = require('./config/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { NotFoundError } = require('./errors');
const { createAuthRateLimiter } = require('./middleware/rateLimit');

const API_PREFIX = process.env.API_PREFIX || '/api/v1';

function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  // Request logging with request-id correlation (§7.2)
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.headers['x-request-id'] || crypto.randomUUID(),
      customProps: (req) => ({ requestId: req.id }),
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );

  // Echo the correlation id so clients can report it in bug reports (§7.2)
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', String(req.id));
    next();
  });

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGINS === '*' ? true : (process.env.CORS_ORIGINS || '').split(','),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Brute-force protection on every auth endpoint (§7.3, Phase 0.5 step 21)
  app.use(`${API_PREFIX}/auth`, createAuthRateLimiter());

  // Feature modules (§2: routes → controller → service → repository → model)
  const { authRouter } = require('./modules/auth/auth.routes');
  const { userRouter } = require('./modules/users/user.routes');
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/users`, userRouter);

  // Health probe (load balancer / deploy checks)
  app.get('/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
  });

  // 404 funnels into the centralized error middleware (Express 5: bare '*' removed)
  app.use((req, res, next) => {
    next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
  });

  // Centralized error handling — the only response shaper for failures (§7.1)
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, API_PREFIX };
