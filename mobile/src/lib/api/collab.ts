import api from './client';

/**
 * Collaboration client (Phase 8, plan steps 63–65). Two surfaces:
 * `/collab-poems*` (fixed-turn relay) and `/collaborations*`
 * (open/branching segments + append-only reading path).
 */
export type CollabStatus = 'open' | 'finished';
export type PieceMode = 'single_ending' | 'multi_ending';

export interface CollabAuthor {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl: string;
}

export interface CollabTurn {
  order: number;
  lines: string;
  author: CollabAuthor | null;
  createdAt: string;
}

export interface CollabPoem {
  id: string;
  creatorId: string;
  title: string;
  linesPerTurn: number;
  status: CollabStatus;
  turnCount: number;
  turns: CollabTurn[];
  createdAt: string;
  updatedAt: string;
}

export interface CollabPoemPage {
  items: CollabPoem[];
  nextCursor: string | null;
}

export interface PieceSummary {
  id: string;
  creatorId: string;
  title: string;
  mode: PieceMode;
  maxBranches: number;
  status: 'open' | 'locked' | 'complete';
  rootSegmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Segment {
  id: string;
  pieceId: string;
  parentId: string | null;
  ancestorPath: string[];
  author: CollabAuthor | null;
  content: string;
  childCount: number;
  depth: number;
  createdAt: string;
}

export interface PiecePage {
  items: PieceSummary[];
  nextCursor: string | null;
}

export interface PieceDetail {
  piece: PieceSummary;
  rootSegment: Segment | null;
}

export interface ChildrenResult {
  parentId: string;
  childCount: number;
  cap: number;
  items: Segment[];
}

export interface ReadingPathState {
  pieceId: string;
  visitedSegmentIds: string[];
  currentSegmentId: string | null;
  updatedAt: string;
}

export interface CreateCollabPoemInput {
  title: string;
  linesPerTurn: number;
}

export interface CreatePieceInput {
  title: string;
  mode: PieceMode;
  maxBranches?: number;
  content: string;
}

// --- CollabPoem (fixed-turn relay) ---

export async function listCollabPoems(limit = 20): Promise<CollabPoemPage> {
  const { data } = await api.get<CollabPoemPage>('/collab-poems', { params: { limit } });
  return data;
}

export async function getCollabPoem(id: string): Promise<CollabPoem> {
  const { data } = await api.get<CollabPoem>(`/collab-poems/${encodeURIComponent(id)}`);
  return data;
}

export async function createCollabPoem(input: CreateCollabPoemInput): Promise<CollabPoem> {
  const { data } = await api.post<CollabPoem>('/collab-poems', input);
  return data;
}

export async function addCollabTurn(id: string, content: string): Promise<CollabPoem> {
  const { data } = await api.post<CollabPoem>(
    `/collab-poems/${encodeURIComponent(id)}/turns`,
    { content },
  );
  return data;
}

export async function finishCollabPoem(id: string): Promise<CollabPoem> {
  const { data } = await api.post<CollabPoem>(`/collab-poems/${encodeURIComponent(id)}/finish`);
  return data;
}

// --- Collaboration pieces (open/branching) ---

export async function listPieces(limit = 20): Promise<PiecePage> {
  const { data } = await api.get<PiecePage>('/collaborations', { params: { limit } });
  return data;
}

export async function getPiece(pieceId: string): Promise<PieceDetail> {
  const { data } = await api.get<PieceDetail>(
    `/collaborations/${encodeURIComponent(pieceId)}`,
  );
  return data;
}

export async function createPiece(input: CreatePieceInput): Promise<PieceSummary> {
  const { data } = await api.post<PieceSummary>('/collaborations', input);
  return data;
}

export async function getSegment(pieceId: string, segmentId: string): Promise<Segment> {
  const { data } = await api.get<Segment>(
    `/collaborations/${encodeURIComponent(pieceId)}/segments/${encodeURIComponent(segmentId)}`,
  );
  return data;
}

export async function listSegmentChildren(
  pieceId: string,
  segmentId: string,
): Promise<ChildrenResult> {
  const { data } = await api.get<ChildrenResult>(
    `/collaborations/${encodeURIComponent(pieceId)}/segments/${encodeURIComponent(segmentId)}/children`,
  );
  return data;
}

export async function addSegment(
  pieceId: string,
  input: { parentId: string; content: string },
): Promise<Segment> {
  const { data } = await api.post<Segment>(
    `/collaborations/${encodeURIComponent(pieceId)}/segments`,
    input,
  );
  return data;
}

export async function getReadingPath(pieceId: string): Promise<ReadingPathState | null> {
  const { data } = await api.get<ReadingPathState | null>(
    `/collaborations/${encodeURIComponent(pieceId)}/reading-path`,
  );
  return data;
}

export async function recordReadingPath(
  pieceId: string,
  segmentId: string,
): Promise<ReadingPathState> {
  const { data } = await api.post<ReadingPathState>(
    `/collaborations/${encodeURIComponent(pieceId)}/reading-path`,
    { segmentId },
  );
  return data;
}
