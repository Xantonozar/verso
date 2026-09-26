'use strict';

/**
 * Standard success envelope helpers (§7.1):
 *   { success: true, data: {...}, meta: {...} }
 * Error responses are shaped exclusively by the error middleware.
 */
function ok(res, data, { meta, status = 200 } = {}) {
  const body = { success: true, data };
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
}

function created(res, data, { meta } = {}) {
  return ok(res, data, { meta, status: 201 });
}

function noContent(res) {
  return res.status(204).end();
}

module.exports = { ok, created, noContent };
