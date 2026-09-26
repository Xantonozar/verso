'use strict';

const path = require('path');

// Minimal loader for Phase 0. Full fail-fast validation lives in src/config/env.js (Phase 0.5).
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

module.exports = {};
