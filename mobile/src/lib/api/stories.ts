import api from './client';

export type StoryStatus =
  | 'draft'
  | 'published'
  | 'unlisted'
  | 'private_draft'
  | 'under_review'
  | 'removed';

export interface StoryAuthor {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl?: string;
}

export interface StoryStats {
  reads: number;
  reactionCount?: number;
  commentCount?: number;
  saveCount?: number;
  shareCount?: number;
}

export interface Story {
  id: string;
  authorId: string;
  title: string;
  coverUrl: string;
  synopsis: string;
  language?: 'bn' | 'en';
  tags: string[];
  status: StoryStatus;
  chapterCount: number;
  currentVersionId: string | null;
  draftSavedAt: string | null;
  stats?: StoryStats;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  author?: StoryAuthor | null;
}

export interface AuthorStoryItem {
  id: string;
  title: string;
  coverUrl: string;
  synopsis: string;
  tags: string[];
  language?: 'bn' | 'en';
  status: StoryStatus;
  chapterCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryChapter {
  id: string;
  storyId: string;
  chapterNumber: number;
  title: string;
  content: string;
  wordCount: number;
  currentVersionId: string | null;
  draftSavedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoryChapterSummary {
  id: string;
  chapterNumber: number;
  title: string;
  wordCount: number;
  updatedAt: string;
}

export interface ChapterPage {
  items: StoryChapterSummary[];
  nextCursor: string | null;
}

export interface AuthorStoryPage {
  items: AuthorStoryItem[];
  nextCursor: string | null;
}

export interface StoryVersionItem {
  id: string;
  chapterId: string | null;
  versionNumber: number;
  title: string;
  content: string;
  editedAt: string;
}

export interface VersionPage {
  items: StoryVersionItem[];
  nextCursor: string | null;
}

export interface CreateStoryInput {
  title: string;
  coverUrl?: string;
  synopsis?: string;
  language?: 'bn' | 'en';
  tags?: string[];
}

/** Allow-list the server's updateStorySchema accepts — never status/stats. */
export type UpdateStoryInput = Partial<CreateStoryInput>;

export interface StoryAutosaveResult {
  id: string;
  changed: boolean;
  title: string;
  coverUrl: string;
  synopsis: string;
  savedAt: string;
}

export interface ChapterAutosaveResult {
  id: string;
  changed: boolean;
  title: string;
  content: string;
  savedAt: string;
}

export async function createStory(input: CreateStoryInput): Promise<Story> {
  const { data } = await api.post<Story>('/stories', input);
  return data;
}

export async function getStory(id: string): Promise<Story> {
  const { data } = await api.get<Story>(`/stories/${id}`);
  return data;
}

export async function updateStory(id: string, input: UpdateStoryInput): Promise<Story> {
  const { data } = await api.patch<Story>(`/stories/${id}`, input);
  return data;
}

export async function deleteStory(id: string): Promise<{ id: string; deleted: boolean }> {
  const { data } = await api.delete<{ id: string; deleted: boolean }>(`/stories/${id}`);
  return data;
}

export async function publishStory(id: string): Promise<Story> {
  const { data } = await api.post<Story>(`/stories/${id}/publish`, {});
  return data;
}

export async function unpublishStory(id: string, to?: 'draft' | 'private_draft'): Promise<Story> {
  const { data } = await api.post<Story>(`/stories/${id}/unpublish`, to ? { to } : {});
  return data;
}

export async function autosaveStoryDraft(
  id: string,
  input: UpdateStoryInput,
): Promise<StoryAutosaveResult> {
  const { data } = await api.put<StoryAutosaveResult>(`/stories/${id}/draft`, input);
  return data;
}

export async function listStoryVersions(
  id: string,
  options: { chapterId?: string; cursor?: string; limit?: number } = {},
): Promise<VersionPage> {
  const { data } = await api.get<VersionPage>(`/stories/${id}/versions`, {
    params: { chapterId: options.chapterId, cursor: options.cursor, limit: options.limit },
  });
  return data;
}

export async function listChapters(
  storyId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<ChapterPage> {
  const { data } = await api.get<ChapterPage>(`/stories/${storyId}/chapters`, {
    params: { cursor: options.cursor, limit: options.limit },
  });
  return data;
}

export async function getChapter(storyId: string, chapterId: string): Promise<StoryChapter> {
  const { data } = await api.get<StoryChapter>(`/stories/${storyId}/chapters/${chapterId}`);
  return data;
}

export async function createChapter(
  storyId: string,
  input: { title?: string; content?: string },
): Promise<StoryChapter> {
  const { data } = await api.post<StoryChapter>(`/stories/${storyId}/chapters`, input);
  return data;
}

export async function updateChapter(
  storyId: string,
  chapterId: string,
  input: { title?: string; content?: string },
): Promise<StoryChapter> {
  const { data } = await api.patch<StoryChapter>(
    `/stories/${storyId}/chapters/${chapterId}`,
    input,
  );
  return data;
}

export async function autosaveChapterDraft(
  storyId: string,
  chapterId: string,
  input: { title?: string; content?: string },
): Promise<ChapterAutosaveResult> {
  const { data } = await api.put<ChapterAutosaveResult>(
    `/stories/${storyId}/chapters/${chapterId}/draft`,
    input,
  );
  return data;
}

/** Payload must be exactly the story's chapters — server rejects anything else. */
export async function reorderChapters(
  storyId: string,
  chapterIds: string[],
): Promise<{ items: StoryChapterSummary[] }> {
  const { data } = await api.post<{ items: StoryChapterSummary[] }>(
    `/stories/${storyId}/chapters/reorder`,
    { chapterIds },
  );
  return data;
}

export async function listAuthorStories(
  authorId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<AuthorStoryPage> {
  const { data } = await api.get<AuthorStoryPage>(`/users/${authorId}/stories`, {
    params: { cursor: options.cursor, limit: options.limit },
  });
  return data;
}
