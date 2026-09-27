'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, loadUser } = require('../../middleware/auth');
const { createRemixSchema } = require('./remix.schemas');
const controller = require('./remix.controller');

const router = express.Router();

// Remix creation is a write — session required (§5, plan step 70).
router.post('/', requireAuth, loadUser, validate({ body: createRemixSchema }), controller.create);

module.exports = { remixRouter: router };
