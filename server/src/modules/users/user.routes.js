'use strict';

const express = require('express');
const multer = require('multer');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const { ValidationError } = require('../../errors');
const { updateProfileSchema, pushTokenSchema } = require('./user.schemas');
const {
  idParamSchema,
  authorStoriesQuerySchema,
} = require('../stories/story.schemas');
const storyController = require('../stories/story.controller');
const controller = require('./user.controller');

const router = express.Router();

/**
 * Photo upload (§0: uploads routed through Express, never direct-to-Cloudinary).
 * Memory storage → service uploads the buffer to Cloudinary.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype?.startsWith('image/')) return cb(null, true);
    return cb(
      new ValidationError('Only image files are allowed', {
        code: 'INVALID_FILE_TYPE',
        details: { field: 'photo' },
      }),
    );
  },
});

/** Translate multer errors into our envelope instead of a generic 500. */
function uploadSingle(mw) {
  return (req, res, next) =>
    mw(req, res, (err) => {
      if (!err) return next();
      if (err.name === 'MulterError' && err.code === 'LIMIT_FILE_SIZE') {
        return next(
          new ValidationError('Photo must be 5MB or smaller', {
            code: 'FILE_TOO_LARGE',
            details: { field: 'photo' },
          }),
        );
      }
      return next(err);
    });
}

// /me routes must be registered before /:id so "me" isn't captured as an id.
router.get('/me', requireAuth, loadUser, controller.getMe);
router.patch('/me', requireAuth, loadUser, validate({ body: updateProfileSchema }), controller.updateMe);
router.post('/me/photo', requireAuth, loadUser, uploadSingle(upload.single('photo')), controller.uploadPhoto);
// Push token registration (Phase 11 step 80) - null clears (turned off)
router.put(
  '/me/push-token',
  requireAuth,
  loadUser,
  validate({ body: pushTokenSchema }),
  controller.setPushToken,
);

router.get('/:id', optionalAuth, controller.getProfile);
// Profile story list (plan 41B) — lives in the stories module, routed under
// /users because the profile owns the page.
router.get(
  '/:id/stories',
  optionalAuth,
  loadUserOptional,
  validate({ params: idParamSchema, query: authorStoriesQuerySchema }),
  storyController.listByAuthor,
);
router.post('/:id/follow', requireAuth, loadUser, controller.follow);
router.delete('/:id/follow', requireAuth, loadUser, controller.unfollow);

module.exports = { userRouter: router };
