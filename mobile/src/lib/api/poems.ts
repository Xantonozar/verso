import api from './client';

export type PoemVisibility = 'public' | 'followers' | 'unlisted' | 'private_draft';

export type PoemStatus = 'draft' | 'published' | 'hidden' | 'removed' | 'under_review';

export interface PoemAuthor {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl?: string;
}

export interface PoemStats {
  reads: number;
  reactionCount: number;
  commentCount: number;
  saveCount: number;
  shareCount: number;
}

export interface Poem {
  id: string;
  authorId?: string;
  title: string;
  content: string;
  authorNote?: string;
  language?: string;
  moods?: string[];
  tags?: string[];
  visibility: PoemVisibility;
  anonymous: boolean;
  isUnsentPoem?: boolean;
  unsentRecipientLabel?: string;
  status: PoemStatus;
  currentVersionId?: string | null;
  draftSavedAt?: string | null;
  stats?: PoemStats;
  audioUrl?: string;
  videoUrl?: string;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  author?: PoemAuthor | null;
  /** Set by GET /poems/:id when this poem is a remix — the original's id. */
  remixOf?: string | null;
}

export interface CreatePoemInput {
  title: string;
  content: string;
  authorNote?: string;
  language?: string;
  moods?: string[];
  tags?: string[];
  visibility?: PoemVisibility;
  anonymous?: boolean;
  isUnsentPoem?: boolean;
  unsentRecipientLabel?: string;
}

/** Allow-list the server's updatePoemSchema accepts — never status/stats/authorId. */
export type UpdatePoemInput = Partial<Omit<CreatePoemInput, never>>;

export interface AutosaveResult {
  id: string;
  changed: boolean;
  title: string;
  content: string;
  savedAt: string;
}

export interface PoemVersionItem {
  id: string;
  title: string;
  content: string;
  versionNumber: number;
  editedAt: string;
}

export interface VersionPage {
  items: PoemVersionItem[];
  nextCursor: string | null;
}

export async function createPoem(input: CreatePoemInput): Promise<Poem> {
  const { data } = await api.post<Poem>('/poems', input);
  return data;
}

export async function getPoem(id: string): Promise<Poem> {
  const { data } = await api.get<Poem>(`/poems/${id}`);
  return data;
}

export async function updatePoem(id: string, input: UpdatePoemInput): Promise<Poem> {
  const { data } = await api.patch<Poem>(`/poems/${id}`, input);
  return data;
}

export async function deletePoem(id: string): Promise<{ id: string; deleted: boolean }> {
  const { data } = await api.delete<{ id: string; deleted: boolean }>(`/poems/${id}`);
  return data;
}

export async function autosaveDraft(
  id: string,
  input: { title?: string; content?: string },
): Promise<AutosaveResult> {
  const { data } = await api.put<AutosaveResult>(`/poems/${id}/draft`, input);
  return data;
}

export async function listVersions(
  id: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<VersionPage> {
  const { data } = await api.get<VersionPage>(`/poems/${id}/versions`, {
    params: { cursor: options.cursor, limit: options.limit },
  });
  return data;
}
