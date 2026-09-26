'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, optionalAuth, loadUser, loadUserOptional } = require('../../middleware/auth');
const {
  idParamSchema,
  chapterParamsSchema,
  createStorySchema,
  updateStorySchema,
  storyAutosaveSchema,
  publishSchema,
  unpublishSchema,
  chapterInputSchema,
  reorderSchema,
  chaptersQuerySchema,
  versionsQuerySchema,
} = require('./story.schemas');
const controller = require('./story.controller');

const router = express.Router();

// Reads are optionalAuth: visibility (published/unlisted vs private) resolves
// against the requester when a token is present (plan 36B).
router.post('/', requireAuth, loadUser, validate({ body: createStorySchema }), controller.create);
router.get(
  '/:id',
  optionalAuth,
  loadUserOptional,
  validate({ params: idParamSchema }),
  controller.get,
);
router.patch(
  '/:id',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: updateStorySchema }),
  controller.update,
);
router.delete('/:id', requireAuth, loadUser, validate({ params: idParamSchema }), controller.remove);

router.post(
  '/:id/publish',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: publishSchema }),
  controller.publish,
);
router.post(
  '/:id/unpublish',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: unpublishSchema }),
  controller.unpublish,
);
router.put(
  '/:id/draft',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: storyAutosaveSchema }),
  controller.autosave,
);
router.get(
  '/:id/versions',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, query: versionsQuerySchema }),
  controller.versions,
);

router.get(
  '/:id/chapters',
  optionalAuth,
  loadUserOptional,
  validate({ params: idParamSchema, query: chaptersQuerySchema }),
  controller.listChapters,
);
router.post(
  '/:id/chapters/reorder',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: reorderSchema }),
  controller.reorderChapters,
);
router.post(
  '/:id/chapters',
  requireAuth,
  loadUser,
  validate({ params: idParamSchema, body: chapterInputSchema }),
  controller.createChapter,
);
router.get(
  '/:id/chapters/:chapterId',
  optionalAuth,
  loadUserOptional,
  validate({ params: chapterParamsSchema }),
  controller.getChapter,
);
router.patch(
  '/:id/chapters/:chapterId',
  requireAuth,
  loadUser,
  validate({ params: chapterParamsSchema, body: chapterInputSchema }),
  controller.updateChapter,
);
router.put(
  '/:id/chapters/:chapterId/draft',
  requireAuth,
  loadUser,
  validate({ params: chapterParamsSchema, body: chapterInputSchema }),
  controller.autosaveChapter,
);

module.exports = { storyRouter: router };
