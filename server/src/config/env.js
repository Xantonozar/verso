'use strict';

const path = require('path');
const { z } = require('zod');

// Load .env once at require time; validation happens in parseEnv/loadEnv.
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().max(65535).default(4000),
    API_PREFIX: z
      .string()
      .regex(/^\/[^\s]*$/, 'must start with "/" and contain no spaces')
      .default('/api/v1'),

    MONGODB_URI: z
      .string()
      .min(1)
      .refine((v) => v.startsWith('mongodb://') || v.startsWith('mongodb+srv://'), {
        message: 'must start with mongodb:// or mongodb+srv://',
      }),

    REDIS_HOST: z.string().default('127.0.0.1'),
    REDIS_PORT: z.coerce.number().int().positive().max(65535).default(6379),
    REDIS_PASSWORD: z.string().default(''),

    JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'must be at least 32 characters'),
    JWT_ACCESS_TTL: z
      .string()
      .regex(/^\d+[smhd]$/, 'must look like 15m, 12h, 7d')
      .default('15m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),

    CLOUDINARY_CLOUD_NAME: z.string().default(''),
    CLOUDINARY_API_KEY: z.string().default(''),
    CLOUDINARY_API_SECRET: z.string().default(''),

    CORS_ORIGINS: z.string().default('*'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_REFRESH_SECRET'],
        message: 'must differ from JWT_ACCESS_SECRET',
      });
    }
  });

class EnvValidationError extends Error {
  constructor(issues) {
    const lines = issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/**
 * Validate an environment source. Throws EnvValidationError with a readable,
 * per-field list — never a cryptic crash (Phase 0.5 step 12).
 */
function parseEnv(source = process.env) {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((i) => ({ path: i.path.map(String), message: i.message })),
    );
  }
  return Object.freeze(result.data);
}

let config = null;

function loadEnv(source = process.env) {
  config = parseEnv(source);
  return config;
}

function getConfig() {
  if (!config) {
    throw new Error('Environment not loaded — call loadEnv() first');
  }
  return config;
}

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

module.exports = { parseEnv, loadEnv, getConfig, isProduction, EnvValidationError };
