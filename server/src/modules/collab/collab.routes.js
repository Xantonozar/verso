'use strict';

const express = require('express');
const { validate } = require('../../middleware/validate');
const { requireAuth, loadUser } = require('../../middleware/auth');
const {
  collabPoemIdParamSchema,
  pieceIdParamSchema,
  segmentParamSchema,
  createCollabPoemSchema,
  addTurnSchema,
  createPieceSchema,
  addSegmentSchema,
  readingPathSchema,
  listQuerySchema,
  pieceListQuerySchema,
} = require('./collab.schemas');
const controller = require('./collab.controller');

/**
 * Collaboration routes (plan steps 63–65 / §5 endpoint map):
 *   POST/GET /collab-poems, GET/POST turns, POST finish
 *   POST/GET /collaborations, GET one, POST segments,
 *   GET segments/:id/children, POST/GET reading-path
 * Everything requires auth — collab visibility rules beyond "authenticated"
 * are not defined in v1 (fail closed, §7.1).
 */

const collabPoemRouter = express.Router();

collabPoemRouter.post(
  '/',
  requireAuth,
  loadUser,
  validate({ body: createCollabPoemSchema }),
  controller.createCollabPoem,
);
collabPoemRouter.get(
  '/',
  requireAuth,
  loadUser,
  validate({ query: listQuerySchema }),
  controller.listCollabPoems,
);
collabPoemRouter.get(
  '/:id',
  requireAuth,
  loadUser,
  validate({ params: collabPoemIdParamSchema }),
  controller.getCollabPoem,
);
collabPoemRouter.post(
  '/:id/turns',
  requireAuth,
  loadUser,
  validate({ params: collabPoemIdParamSchema, body: addTurnSchema }),
  controller.addTurn,
);
collabPoemRouter.post(
  '/:id/finish',
  requireAuth,
  loadUser,
  validate({ params: collabPoemIdParamSchema }),
  controller.finishCollabPoem,
);

const collaborationRouter = express.Router();

collaborationRouter.post(
  '/',
  requireAuth,
  loadUser,
  validate({ body: createPieceSchema }),
  controller.createPiece,
);
collaborationRouter.get(
  '/',
  requireAuth,
  loadUser,
  validate({ query: pieceListQuerySchema }),
  controller.listPieces,
);
collaborationRouter.get(
  '/:pieceId',
  requireAuth,
  loadUser,
  validate({ params: pieceIdParamSchema }),
  controller.getPiece,
);
collaborationRouter.get(
  '/:pieceId/segments/:segmentId',
  requireAuth,
  loadUser,
  validate({ params: segmentParamSchema }),
  controller.getSegment,
);
collaborationRouter.post(
  '/:pieceId/segments',
  requireAuth,
  loadUser,
  validate({ params: pieceIdParamSchema, body: addSegmentSchema }),
  controller.addSegment,
);
collaborationRouter.get(
  '/:pieceId/segments/:segmentId/children',
  requireAuth,
  loadUser,
  validate({ params: segmentParamSchema }),
  controller.listChildren,
);
collaborationRouter.post(
  '/:pieceId/reading-path',
  requireAuth,
  loadUser,
  validate({ params: pieceIdParamSchema, body: readingPathSchema }),
  controller.recordReadingPath,
);
collaborationRouter.get(
  '/:pieceId/reading-path',
  requireAuth,
  loadUser,
  validate({ params: pieceIdParamSchema }),
  controller.getReadingPath,
);

module.exports = { collabPoemRouter, collaborationRouter };
