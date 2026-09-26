'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth } = require('../../middleware/auth');
const { registerSchema, loginSchema, refreshSchema, logoutSchema } = require('./auth.schemas');
const controller = require('./auth.controller');

const router = express.Router();

// Rate-limited at the app mount (createAuthRateLimiter on /api/v1/auth).
router.post('/register', validate({ body: registerSchema }), controller.register);
router.post('/login', validate({ body: loginSchema }), controller.login);
router.post('/refresh', validate({ body: refreshSchema }), controller.refresh);
router.post('/logout', validate({ body: logoutSchema }), controller.logout);
router.post('/logout-all', requireAuth, controller.logoutAll);

module.exports = { authRouter: router };
