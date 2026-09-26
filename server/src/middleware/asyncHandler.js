'use strict';

/**
 * Wraps an async route handler so rejections reach the centralized error
 * middleware — never a bare try/catch per controller (§7.1).
 */
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { asyncHandler };
