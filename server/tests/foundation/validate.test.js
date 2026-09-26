'use strict';

const request = require('supertest');
const express = require('express');
const { z } = require('zod');
const { validate } = require('../../src/middleware/validate');
const { errorHandler } = require('../../src/middleware/errorHandler');
const { ok, created } = require('../../src/middleware/respond');

const CreateSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  tags: z.array(z.string()).max(5, 'At most 5 tags').optional(),
});

function appWith(schema) {
  const app = express();
  app.use(express.json());
  app.post('/poems', validate(schema), (req, res) => ok(res, req.body, { status: 201 }));
  app.use(errorHandler);
  return app;
}

describe('validate middleware (step 15)', () => {
  test('valid body passes and is replaced by parsed data (unknown keys stripped)', async () => {
    const res = await request(appWith({ body: CreateSchema }))
      .post('/poems')
      .send({ title: 'Haiku', tags: ['dawn'], evil: 'dropped' });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ title: 'Haiku', tags: ['dawn'] });
  });

  test('invalid body → 400 with field-level details', async () => {
    const res = await request(appWith({ body: CreateSchema }))
      .post('/poems')
      .send({ title: '', tags: ['a', 'b', 'c', 'd', 'e', 'f'] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['title', 'tags']));
    expect(res.body.error.details[0].message).toBeTruthy();
  });

  test('query schema errors are namespaced (query.x)', async () => {
    const app = express();
    app.get(
      '/feed',
      validate({ query: z.object({ page: z.coerce.number().int().positive() }) }),
      (req, res) => ok(res, { page: req.query.page }),
    );
    app.use(errorHandler);

    const res = await request(app).get('/feed?page=-1');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('query.page');
  });

  // Regression (Phase 2): Express 5 `req.query` is getter-only — success-path
  // replacement must shadow it, not assign (assignment threw a 500).
  test('valid query is parsed, coerced, and readable via req.query', async () => {
    const app = express();
    app.get(
      '/feed',
      validate({ query: z.object({ page: z.coerce.number().int().positive() }) }),
      (req, res) => ok(res, { page: req.query.page, type: typeof req.query.page }),
    );
    app.use(errorHandler);

    const res = await request(app).get('/feed?page=3');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ page: 3, type: 'number' });
  });

  test('params schema errors are namespaced (params.x)', async () => {
    const app = express();
    app.get(
      '/poems/:id',
      validate({ params: z.object({ id: z.string().uuid() }) }),
      (req, res) => ok(res, { id: req.params.id }),
    );
    app.use(errorHandler);

    const res = await request(app).get('/poems/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('params.id');
  });
});

describe('respond helpers', () => {
  test('ok/created wrap data in the standard envelope', async () => {
    const app = express();
    app.get('/a', (req, res) => ok(res, { v: 1 }, { meta: { total: 9 } }));
    app.post('/a', (req, res) => created(res, { v: 2 }));
    app.use(errorHandler);

    const get = await request(app).get('/a');
    expect(get.body).toEqual({ success: true, data: { v: 1 }, meta: { total: 9 } });
    const post = await request(app).post('/a');
    expect(post.status).toBe(201);
    expect(post.body.success).toBe(true);
  });
});