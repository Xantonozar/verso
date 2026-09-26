'use strict';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const { pinoHttp } = require('pino-http');
const { logger } = require('./config/logger');

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

  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGINS === '*' ? true : (process.env.CORS_ORIGINS || '').split(','),
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Health probe (load balancer / deploy checks)
  app.get('/health', (req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
  });

  // 404 for unknown API routes (Express 5: bare '*' pattern removed)
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` },
    });
  });

  // Phase 0.5 (step 10) replaces this placeholder with the centralized
  // error-handling middleware (custom error classes, envelope, stack stripping).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    logger.error({ err, requestId: req.id }, 'Unhandled error');
    res.status(err.statusCode || 500).json({
      success: false,
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message,
      },
    });
  });

  return app;
}

module.exports = { createApp, API_PREFIX };
