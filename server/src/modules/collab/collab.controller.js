'use strict';

const { asyncHandler } = require('../../middleware/asyncHandler');
const { created, ok } = require('../../middleware/respond');
const poemService = require('./collab-poem.service');
const pieceService = require('./collaboration.service');

/**
 * Collaboration controllers — thin per §2 (parse → service → respond).
 * Two surfaces from one module: `/collab-poems*` (fixed-turn relay) and
 * `/collaborations*` (open/branching, plan steps 63–65).
 */

// --- CollabPoem (fixed-turn) ---
const createCollabPoem = asyncHandler(async (req, res) => {
  created(res, await poemService.createCollabPoem(req.user, req.body));
});

const listCollabPoems = asyncHandler(async (req, res) => {
  ok(res, await poemService.listCollabPoems(req.query));
});

const getCollabPoem = asyncHandler(async (req, res) => {
  ok(res, await poemService.getCollabPoem(req.params.id));
});

const addTurn = asyncHandler(async (req, res) => {
  created(res, await poemService.addTurn(req.params.id, req.user, req.body));
});

const finishCollabPoem = asyncHandler(async (req, res) => {
  ok(res, await poemService.finishCollabPoem(req.params.id, req.user));
});

// --- Collaboration piece (open/branching) ---
const createPiece = asyncHandler(async (req, res) => {
  created(res, await pieceService.createPiece(req.user, req.body));
});

const listPieces = asyncHandler(async (req, res) => {
  ok(res, await pieceService.listPieces(req.query));
});

const getPiece = asyncHandler(async (req, res) => {
  ok(res, await pieceService.getPiece(req.params.pieceId));
});

const getSegment = asyncHandler(async (req, res) => {
  ok(res, await pieceService.getSegment(req.params.pieceId, req.params.segmentId));
});

const addSegment = asyncHandler(async (req, res) => {
  created(res, await pieceService.createSegment(req.params.pieceId, req.user, req.body));
});

const listChildren = asyncHandler(async (req, res) => {
  ok(res, await pieceService.listChildren(req.params.pieceId, req.params.segmentId));
});

const recordReadingPath = asyncHandler(async (req, res) => {
  ok(res, await pieceService.recordReadingPath(req.params.pieceId, req.user, req.body));
});

const getReadingPath = asyncHandler(async (req, res) => {
  ok(res, await pieceService.getReadingPath(req.params.pieceId, req.user));
});

module.exports = {
  createCollabPoem,
  listCollabPoems,
  getCollabPoem,
  addTurn,
  finishCollabPoem,
  createPiece,
  listPieces,
  getPiece,
  getSegment,
  addSegment,
  listChildren,
  recordReadingPath,
  getReadingPath,
};
