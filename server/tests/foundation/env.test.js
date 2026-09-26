'use strict';

const { parseEnv, EnvValidationError } = require('../../src/config/env');

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  API_PREFIX: '/api/v1',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster.example.mongodb.net/verso_dev',
  REDIS_HOST: '127.0.0.1',
  REDIS_PORT: '6379',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  JWT_ACCESS_TTL: '15m',
  REFRESH_TOKEN_TTL_DAYS: '30',
  BCRYPT_ROUNDS: '12',
  CLOUDINARY_CLOUD_NAME: '',
  CLOUDINARY_API_KEY: '',
  CLOUDINARY_API_SECRET: '',
  CORS_ORIGINS: '*',
  LOG_LEVEL: 'info',
};

describe('env validation (step 12)', () => {
  test('accepts a complete valid environment and coerces types', () => {
    const cfg = parseEnv(validEnv);
    expect(cfg.PORT).toBe(4000);
    expect(cfg.BCRYPT_ROUNDS).toBe(12);
    expect(cfg.REFRESH_TOKEN_TTL_DAYS).toBe(30);
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  test('fills defaults for optional fields', () => {
    const cfg = parseEnv({ ...validEnv, NODE_ENV: undefined, LOG_LEVEL: undefined });
    expect(cfg.NODE_ENV).toBe('development');
    expect(cfg.LOG_LEVEL).toBe('info');
    expect(cfg.API_PREFIX).toBe('/api/v1');
  });

  test('missing required env fails with a per-field report, not a crash', () => {
    const { MONGODB_URI, JWT_ACCESS_SECRET, ...rest } = validEnv;
    expect(MONGODB_URI && JWT_ACCESS_SECRET).toBeTruthy();
    let error;
    try {
      parseEnv(rest);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    expect(error.message).toMatch(/MONGODB_URI/);
    expect(error.message).toMatch(/JWT_ACCESS_SECRET/);
    expect(error.issues.map((i) => i.path.join('.'))).toEqual(
      expect.arrayContaining(['MONGODB_URI', 'JWT_ACCESS_SECRET']),
    );
  });

  test('rejects a non-Mongo connection scheme', () => {
    expect(() => parseEnv({ ...validEnv, MONGODB_URI: 'postgres://x' })).toThrow(
      EnvValidationError,
    );
  });

  test('rejects identical access/refresh secrets', () => {
    expect(() => parseEnv({ ...validEnv, JWT_REFRESH_SECRET: validEnv.JWT_ACCESS_SECRET })).toThrow(
      /must differ/,
    );
  });

  test('rejects bad PORT and LOG_LEVEL', () => {
    expect(() => parseEnv({ ...validEnv, PORT: '0' })).toThrow(EnvValidationError);
    expect(() => parseEnv({ ...validEnv, LOG_LEVEL: 'chatty' })).toThrow(EnvValidationError);
  });

  // getConfig() throws before loadEnv() — verified by boot smoke test (wrong JWT secret → FATAL + exit 1).
  // Can't test here because tests/setup.js calls loadEnv() before any test runs.
});