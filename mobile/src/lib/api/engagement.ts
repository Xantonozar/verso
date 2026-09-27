import api from './client';
import { Poem, PoemStats } from './poems';

/** Server §3.6 — keep in sync with server reaction.model REACTION_TYPES. */
export const REACTION_TYPES = [
  'loved',
  'hurt',
  'felt_this',
  'powerful',
  'comforting',
  'dark',
  'beautiful',
] as const;

export type ReactionType = (typeof REACTION_TYPES)[number];

export const REACTION_LABELS: Record<ReactionType, string> = {
  loved: 'Loved',
  hurt: 'Hurt',
  felt_this: 'Felt this',
  powerful: 'Powerful',
  comforting: 'Comforting',
  dark: 'Dark',
  beautiful: 'Beautiful',
};

export type CommentTargetType = 'poem' | 'diary' | 'collabSegment';

export type ReactionCounts = Partial<Record<ReactionType, number>>;

export interface FeltGoodSummary {
  average: number | null;
  count: number;
}

export interface ViewerState {
  reactions: ReactionType[];
  saved: boolean;
  feltGood: { score: number; comment: string } | null;
}

/** GET /mobile/poems/:id — one round-trip read model (Phase 3, plan step 49). */
export interface MobilePoemResponse {
  poem: Poem;
  reactionCounts: ReactionCounts;
  feltGood: FeltGoodSummary;
  viewer: ViewerState | null;
}

export interface ReactionResult {
  reaction: { id: string; type: ReactionType };
  stats: PoemStats;
}

export interface RemoveReactionResult {
  removed: boolean;
  type: ReactionType;
  stats: PoemStats;
}

export interface FeltGoodRating {
  id: string;
  poemId: string;
  score: number;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaveResult {
  saved: boolean;
  stats: PoemStats;
}

export interface CommentAuthor {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl?: string;
}

export interface Comment {
  id: string;
  targetType: CommentTargetType;
  targetId: string;
  parentCommentId: string | null;
  anonymous: boolean;
  content: string;
  createdAt: string;
  authorId?: string;
  author?: CommentAuthor | null;
  replyCount?: number;
  replies?: Comment[];
}

export interface CommentPage {
  items: Comment[];
  nextCursor: string | null;
}

export interface CreateCommentInput {
  targetType: CommentTargetType;
  targetId: string;
  content: string;
  parentCommentId?: string;
  /** Omitted when false — the server default keeps payloads minimal. */
  anonymous?: boolean;
}

export async function getMobilePoem(id: string): Promise<MobilePoemResponse> {
  const { data } = await api.get<MobilePoemResponse>(`/mobile/poems/${id}`);
  return data;
}

export async function addReaction(
  id: string,
  type: ReactionType,
  options?: { anonymous?: boolean },
): Promise<ReactionResult> {
  const { data } = await api.post<ReactionResult>(`/poems/${id}/reactions`, {
    type,
    ...(options?.anonymous ? { anonymous: true } : {}),
  });
  return data;
}

export async function removeReaction(
  id: string,
  type: ReactionType,
): Promise<RemoveReactionResult> {
  const { data } = await api.delete<RemoveReactionResult>(`/poems/${id}/reactions/${type}`);
  return data;
}

export async function ratePoem(
  id: string,
  score: number,
  comment?: string,
): Promise<FeltGoodRating> {
  const { data } = await api.post<FeltGoodRating>(`/poems/${id}/felt-good`, {
    score,
    ...(comment !== undefined ? { comment } : {}),
  });
  return data;
}

export async function updateFeltGood(
  id: string,
  score: number,
  comment?: string,
): Promise<FeltGoodRating> {
  const { data } = await api.patch<FeltGoodRating>(`/poems/${id}/felt-good`, {
    score,
    ...(comment !== undefined ? { comment } : {}),
  });
  return data;
}

export async function savePoem(id: string): Promise<SaveResult> {
  const { data } = await api.post<SaveResult>(`/poems/${id}/save`);
  return data;
}

export async function unsavePoem(id: string): Promise<SaveResult> {
  const { data } = await api.delete<SaveResult>(`/poems/${id}/save`);
  return data;
}

export async function listComments(options: {
  targetType: CommentTargetType;
  targetId: string;
  cursor?: string;
  limit?: number;
}): Promise<CommentPage> {
  const { data } = await api.get<CommentPage>('/comments', { params: options });
  return data;
}

export async function createComment(input: CreateCommentInput): Promise<Comment> {
  const { data } = await api.post<Comment>('/comments', input);
  return data;
}

export async function deleteComment(id: string): Promise<{ id: string; deleted: boolean }> {
  const { data } = await api.delete<{ id: string; deleted: boolean }>(`/comments/${id}`);
  return data;
}

export async function publishPoem(id: string): Promise<Poem> {
  const { data } = await api.post<Poem>(`/poems/${id}/publish`);
  return data;
}

export async function unpublishPoem(id: string): Promise<Poem> {
  const { data } = await api.delete<Poem>(`/poems/${id}/publish`);
  return data;
}
