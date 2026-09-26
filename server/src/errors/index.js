'use strict';

/**
 * Centralized error hierarchy (§7.1). Business logic throws these with a stable
 * `code`; the global error middleware is the only place that shapes the response.
 *
 * Signature: options = { statusCode, code, details }
 * - `code`     stable machine-readable string clients/monitors key on
 * - `details`  structured payload (field errors, retry hints) — never stacks
 */
class AppError extends Error {
  constructor(message, { statusCode = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    if (details !== undefined) this.details = details;
    this.isOperational = true;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(message = 'Validation failed', { code = 'VALIDATION_ERROR', details, ...rest } = {}) {
    super(message, { statusCode: 400, code, details, ...rest });
  }
}

class AuthError extends AppError {
  constructor(message = 'Authentication required', { code = 'AUTH_ERROR', ...rest } = {}) {
    super(message, { statusCode: 401, code, ...rest });
  }
}

class ForbiddenError extends AppError {
  constructor(message = 'Not allowed', { code = 'FORBIDDEN', ...rest } = {}) {
    super(message, { statusCode: 403, code, ...rest });
  }
}

class NotFoundError extends AppError {
  constructor(message = 'Resource not found', { code = 'NOT_FOUND', ...rest } = {}) {
    super(message, { statusCode: 404, code, ...rest });
  }
}

class ConflictError extends AppError {
  constructor(message = 'Resource already exists', { code = 'CONFLICT', ...rest } = {}) {
    super(message, { statusCode: 409, code, ...rest });
  }
}

class RateLimitError extends AppError {
  constructor(
    message = 'Too many requests',
    { code = 'RATE_LIMITED', retryAfterSeconds, limit, windowMs, ...rest } = {},
  ) {
    super(message, {
      statusCode: 429,
      code,
      details: { ...(limit != null && { limit }), ...(windowMs != null && { windowMs }) },
      ...rest,
    });
    this.retryAfterSeconds = retryAfterSeconds;
    if (retryAfterSeconds != null) this.details = { ...this.details, retryAfterSeconds };
  }
}

module.exports = {
  AppError,
  ValidationError,
  AuthError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  RateLimitError,
};
