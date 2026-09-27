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

  // Brute-force protection on every auth endpoint (§7.3, Phase 0.5 step 21).
  // AUTH_RATE_LIMIT_MAX is a test/ops knob — default stays 30/min (§7.3);
  // integration suites register far more than 30 users per minute.
  app.use(
    `${API_PREFIX}/auth`,
    createAuthRateLimiter({ max: Number(process.env.AUTH_RATE_LIMIT_MAX) || 30 }),
  );

  // Feature modules (§2: routes → controller → service → repository → model)
  const { authRouter } = require('./modules/auth/auth.routes');
  const { userRouter } = require('./modules/users/user.routes');
  const { poemRouter } = require('./modules/poems/poem.routes');
  const { storyRouter } = require('./modules/stories/story.routes');
  const { diaryRouter } = require('./modules/diary/diary.routes');
  const { engagementRouter } = require('./modules/engagement/engagement.routes');
  const { discoverRouter } = require('./modules/discover/discover.routes');
  const { collectionRouter } = require('./modules/collections/collection.routes');
  app.use(`${API_PREFIX}/auth`, authRouter);
  app.use(`${API_PREFIX}/users`, userRouter);
  app.use(`${API_PREFIX}/poems`, poemRouter);
  app.use(`${API_PREFIX}/stories`, storyRouter);
  // Diary (Phase 4): POST/GET only — felt-good/save/patch/delete routes do not
  // exist for diary at all (plan step 50, router-enforced)
  app.use(`${API_PREFIX}/diary`, diaryRouter);
  // Engagement (Phases 3-4): /poems/:id/* + /diary/:id/reactions, /comments,
  // and the /mobile BFF — full paths from API_PREFIX, mounted after the
  // poem/diary routers
  app.use(`${API_PREFIX}`, engagementRouter);
  // Discover + feed (Phase 5, plan steps 53-54): full paths from API_PREFIX
  // (/feed + /discover/*), mounted after the routers above — no collisions
  app.use(`${API_PREFIX}`, discoverRouter);
  // Collections (Phase 6, plan step 58): /collections* CRUD surface
  app.use(`${API_PREFIX}/collections`, collectionRouter);

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
