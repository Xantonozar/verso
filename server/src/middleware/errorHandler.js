'use strict';

const { logger } = require('../config/logger');
const { AppError, ValidationError, ConflictError } = require('../errors');

/**
 * Translate framework/library errors into our AppError hierarchy — Mongoose
 * and Zod errors are translated, never leaked (§7.1).
 */
function normalizeError(err) {
  if (err instanceof AppError) return err;

  // Zod: defensive — validation middleware normally catches these first
  if (err?.name === 'ZodError' && Array.isArray(err.issues)) {
    const details = err.issues.map((i) => ({
      field: i.path?.join('.') || '(root)',
      message: i.message,
      code: i.code,
    }));
    return new ValidationError('Request validation failed', { details });
  }

  // Mongoose bad ObjectId / bad field type
  if (err?.name === 'CastError') {
    return new AppError(`Invalid value for "${err.path}"`, {
      statusCode: 400,
      code: 'CAST_ERROR',
      details: { field: err.path, value: err.value },
    });
  }

  // Mongoose schema validation
  if (err?.name === 'ValidationError') {
    const details = Object.values(err.errors || {}).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return new ValidationError('Request validation failed', { details });
  }

  // Mongoose duplicate key (unique index)
  if (err?.code === 11000) {
    const fields = Object.keys(err.keyPattern || err.keyValue || {});
    const field = fields[0];
    return new ConflictError(
      field ? `${field} already exists` : 'Resource already exists',
      { code: 'DUPLICATE_KEY', ...(field && { details: { field } }) },
    );
  }

  // express.json() parse failure
  if (err?.type === 'entity.parse.failed' || (err instanceof SyntaxError && err.status === 400)) {
    return new AppError('Malformed JSON body', { statusCode: 400, code: 'INVALID_JSON' });
  }

  // Unknown — hide internals from clients (production) but keep them server-side
  const appError = new AppError('Something went wrong', { statusCode: 500, code: 'INTERNAL_ERROR' });
  appError.expose = false;
  appError.originalMessage = err?.message;
  appError.stack = err?.stack || appError.stack;
  return appError;
}

/**
 * Global error-handling middleware (§7.1/§7.2): the ONLY place that logs the
 * error, decides the response shape, and strips internal detail in production.
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  const appError = normalizeError(err);
  const isProduction = process.env.NODE_ENV === 'production';
  const statusCode = appError.statusCode || 500;

  logger[statusCode >= 500 ? 'error' : 'warn'](
    {
      event: 'http:error',
      requestId: req.id,
      method: req.method,
      path: req.path,
      statusCode,
      code: appError.code,
      userId: req.user?.id,
      err: {
        name: appError.name,
        message: appError.expose === false ? appError.originalMessage : appError.message,
        stack: appError.stack,
      },
    },
    'Request failed',
  );

  const body = { success: false, error: { code: appError.code, message: appError.message } };
  if (appError.details !== undefined) body.error.details = appError.details;
  if (!isProduction && appError.stack) body.error.stack = appError.stack;

  if (appError.retryAfterSeconds != null) {
    res.setHeader('Retry-After', String(appError.retryAfterSeconds));
  }

  res.status(statusCode).json(body);
}

module.exports = { errorHandler, normalizeError };
