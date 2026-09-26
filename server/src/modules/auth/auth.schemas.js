'use strict';

const { z } = require('zod');

/**
 * Auth request schemas (Phase 1). Weak passwords are rejected with a
 * field-level 400 (§7 step 25) — validate() middleware surfaces each issue
 * as { field, message }.
 */
const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3, 'must be at least 3 characters')
    .max(30, 'must be at most 30 characters')
    .regex(/^[a-zA-Z0-9_]+$/, 'can only contain letters, numbers and underscores'),
  displayName: z.string().trim().min(1, 'is required').max(50, 'must be at most 50 characters'),
  email: z.string().trim().toLowerCase().email('must be a valid email').max(254),
  password: z
    .string()
    .min(8, 'must be at least 8 characters')
    .regex(/[a-zA-Z]/, 'must contain at least one letter')
    .regex(/[0-9]/, 'must contain at least one number'),
});

/** Single "email or username" field — mobile login screen contract (§9). */
const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'is required').max(254),
  password: z.string().min(1, 'is required'),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1, 'is required'),
});

const logoutSchema = z.object({
  refreshToken: z.string().min(1).optional(),
});

module.exports = { registerSchema, loginSchema, refreshSchema, logoutSchema };
