'use strict';

// Load and validate .env once for all tests (JWT secrets, etc.)
require('../src/config/env').loadEnv();

// Quiet the pino request/error logs so jest failure output stays readable.
// Set TEST_LOG=1 to see them while debugging.
if (!process.env.TEST_LOG) process.env.LOG_LEVEL = 'silent';

// Integration suites register dozens of users per minute; the auth limiter's
// production default (30/min) would 429 mid-suite. The limiter itself is
// covered with explicit maxes in tests/foundation/rateLimit.test.js.
process.env.AUTH_RATE_LIMIT_MAX = '100000';
