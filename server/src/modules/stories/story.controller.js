'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { ok, created } = require('../../middleware/respond');
const storyService = require('./story.service');

/**
 * Story controllers — thin per §2 (parse → service → respond).
 */
const create = asyncHandler(async (req, res) => {
  created(res, await storyService.createStory(req.user.id, req.body));
});

const get = asyncHandler(async (req, res) => {
  ok(res, await storyService.getStory(req.params.id, req.user));
});

const update = asyncHandler(async (req, res) => {
  ok(res, await storyService.updateStory(req.params.id, req.user, req.body));
});

const remove = asyncHandler(async (req, res) => {
  ok(res, await storyService.deleteStory(req.params.id, req.user));
});

const publish = asyncHandler(async (req, res) => {
  ok(res, await storyService.publishStory(req.params.id, req.user));
});

const unpublish = asyncHandler(async (req, res) => {
  ok(res, await storyService.unpublishStory(req.params.id, req.user, req.body));
});

const autosave = asyncHandler(async (req, res) => {
  ok(res, await storyService.autosaveStory(req.params.id, req.user, req.body));
});

const versions = asyncHandler(async (req, res) => {
  const { chapterId, cursor, limit } = req.query;
  ok(res, await storyService.listVersions(req.params.id, req.user, { chapterId, cursor, limit }));
});

const listChapters = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  ok(res, await storyService.listChapters(req.params.id, req.user, { cursor, limit }));
});

const getChapter = asyncHandler(async (req, res) => {
  ok(res, await storyService.getChapter(req.params.id, req.params.chapterId, req.user));
});

const createChapter = asyncHandler(async (req, res) => {
  created(res, await storyService.createChapter(req.params.id, req.user, req.body));
});

const updateChapter = asyncHandler(async (req, res) => {
  ok(
    res,
    await storyService.updateChapter(req.params.id, req.params.chapterId, req.user, req.body),
  );
});

const autosaveChapter = asyncHandler(async (req, res) => {
  ok(
    res,
    await storyService.autosaveChapter(req.params.id, req.params.chapterId, req.user, req.body),
  );
});

const reorderChapters = asyncHandler(async (req, res) => {
  ok(res, await storyService.reorderChapters(req.params.id, req.user, req.body.chapterIds));
});

const listByAuthor = asyncHandler(async (req, res) => {
  const { cursor, limit } = req.query;
  ok(res, await storyService.listByAuthor(req.params.id, req.user, { cursor, limit }));
});

module.exports = {
  create,
  get,
  update,
  remove,
  publish,
  unpublish,
  autosave,
  versions,
  listChapters,
  getChapter,
  createChapter,
  updateChapter,
  autosaveChapter,
  reorderChapters,
  listByAuthor,
};
