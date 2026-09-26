'use strict';

// Load and validate .env once for all tests (JWT secrets, etc.)
require('../src/config/env').loadEnv();

// Quiet the pino request/error logs so jest failure output stays readable.
// Set TEST_LOG=1 to see them while debugging.
if (!process.env.TEST_LOG) process.env.LOG_LEVEL = 'silent';
