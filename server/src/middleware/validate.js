'use strict';

const { ValidationError } = require('../errors');

/**
 * Zod validation middleware (Phase 0.5 step 15): runs BEFORE controllers and
 * returns field-level 400s per §7.1. Parsed (and stripped) values replace the
 * originals, so controllers only ever see valid input.
 *
 *   router.post('/', validate({ body: CreatePoemSchema }), handler)
 */
function validate(schemas) {
  return (req, res, next) => {
    for (const key of ['params', 'query', 'body']) {
      const schema = schemas[key];
      if (!schema) continue;

      const result = schema.safeParse(req[key]);
      if (!result.success) {
        const details = result.error.issues.map((issue) => ({
          field:
            key === 'body'
              ? issue.path.join('.') || '(root)'
              : [key, ...issue.path].filter(Boolean).join('.'),
          message: issue.message,
          code: issue.code,
        }));
        return next(new ValidationError('Request validation failed', { details }));
      }
      // Express 5 defines `req.query` as a getter-only prototype property —
      // plain assignment throws. Shadow it with an own data property instead.
      if (key === 'query') {
        Object.defineProperty(req, 'query', {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        req[key] = result.data;
      }
    }
    return next();
  };
}

module.exports = { validate };
