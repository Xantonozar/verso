'use strict';

const express = require('express');
const request = require('supertest');
const { z } = require('zod');
const mongoose = require('mongoose');
const { errorHandler, normalizeError } = require('../../src/middleware/errorHandler');
const {
  AppError,
  ValidationError,
  AuthError,
  NotFoundError,
  ConflictError,
  RateLimitError,
} = require('../../src/errors');

describe('error classes', () => {
  test('map to §7.1 status codes and stable codes', () => {
    expect(new ValidationError()).toMatchObject({ statusCode: 400, code: 'VALIDATION_ERROR' });
    expect(new AuthError()).toMatchObject({ statusCode: 401, code: 'AUTH_ERROR' });
    expect(new AppError('x', { statusCode: 403 })).toMatchObject({ statusCode: 403 });
    expect(new NotFoundError()).toMatchObject({ statusCode: 404, code: 'NOT_FOUND' });
    expect(new ConflictError()).toMatchObject({ statusCode: 409, code: 'CONFLICT' });
    expect(new RateLimitError('slow down', { retryAfterSeconds: 30 })).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 30,
      details: { retryAfterSeconds: 30 },
    });
  });
});

describe('normalizeError translations', () => {
  test('passes AppError through untouched', () => {
    const err = new NotFoundError('gone');
    expect(normalizeError(err)).toBe(err);
  });

  test('translates ZodError into ValidationError with field details', () => {
    const result = z.object({ title: z.string().min(1) }).safeParse({ title: '' });
    const appError = normalizeError(result.error);
    expect(appError).toBeInstanceOf(ValidationError);
    expect(appError.details[0].field).toBe('title');
  });

  test('translates Mongoose CastError into 400 CAST_ERROR', () => {
    const castErr = new mongoose.Error.CastError('ObjectId', 'nope', 'id');
    const appError = normalizeError(castErr);
    expect(appError.statusCode).toBe(400);
    expect(appError.code).toBe('CAST_ERROR');
    expect(appError.details.field).toBe('id');
  });

  test('translates Mongoose duplicate key (11000) into 409', () => {
    const dup = Object.assign(new Error('E11000 duplicate key'), {
      code: 11000,
      keyPattern: { email: 1 },
    });
    const appError = normalizeError(dup);
    expect(appError).toBeInstanceOf(ConflictError);
    expect(appError.code).toBe('DUPLICATE_KEY');
    expect(appError.details.field).toBe('email');
  });

  test('unknown errors become a non-exposed 500', () => {
    const appError = normalizeError(new Error('secret internal detail'));
    expect(appError.statusCode).toBe(500);
    expect(appError.code).toBe('INTERNAL_ERROR');
    expect(appError.expose).toBe(false);
    expect(appError.message).toBe('Something went wrong');
    expect(appError.originalMessage).toBe('secret internal detail');
  });

  test('translates Mongoose schema ValidationError into 400 with field details', () => {
    const schema = new mongoose.Schema({ title: { type: String, required: true } });
    const Model = mongoose.model('ErrorTestModel', schema);
    const doc = new Model({ title: '' }); // invalid: empty required string
    const validateErr = doc.validateSync();
    expect(validateErr).toBeInstanceOf(mongoose.Error.ValidationError);
    const appError = normalizeError(validateErr);
    expect(appError).toBeInstanceOf(ValidationError);
    expect(appError.statusCode).toBe(400);
    expect(appError.code).toBe('VALIDATION_ERROR');
    expect(appError.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'title' })]),
    );
    delete mongoose.models.ErrorTestModel;
  });
});

describe('error middleware envelope', () => {
  function buildApp(handler) {
    const app = express();
    app.use(express.json());
    app.get('/boom', handler);
    app.use(errorHandler);
    return app;
  }

  test('thrown AppError → success:false envelope with code', async () => {
    const app = buildApp(() => {
      throw new NotFoundError('Poem not found');
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Poem not found');
  });

  test('async rejection is caught by the middleware', async () => {
    const app = buildApp(async () => {
      throw new AuthError('nope', { code: 'AUTH_REQUIRED' });
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  test('error details are included when present', async () => {
    const app = buildApp(() => {
      throw new ValidationError('bad', { details: [{ field: 'title', message: 'required' }] });
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'title', message: 'required' }]);
  });

  test('RateLimitError sets Retry-After header', async () => {
    const app = buildApp(() => {
      throw new RateLimitError('slow down', { retryAfterSeconds: 42 });
    });
    const res = await request(app).get('/boom');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('42');
  });

  test('500 message is hidden in production and stack is stripped', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const app = buildApp(() => {
        throw new Error('db password is hunter2');
      });
      const res = await request(app).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body.error.message).toBe('Something went wrong');
      expect(res.body.error.stack).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain('hunter2');
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  test('dev mode includes stack in the body', async () => {
    const app = buildApp(() => {
      throw new NotFoundError('gone');
    });
    const res = await request(app).get('/boom');
    expect(res.body.error.stack).toContain('NotFound');
  });
});
