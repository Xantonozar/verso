import api from './client';

/**
 * Prompts client (Phase 9, plan steps 69–71): current weekly prompt,
 * submissions list, the submission entry point, and `GET /poems/mine`
 * (the picker of the caller's own poems — there is no public poem list).
 */
export interface PromptSubmissionSummary {
  id: string;
  promptId: string;
  poemId: string;
  createdAt: string;
}

export interface Prompt {
  id: string;
  text: string;
  weekOf: string;
  featuredPoemIds: string[];
  createdAt: string;
  mySubmission: PromptSubmissionSummary | null;
}

export interface FeedPoemAuthor {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl: string;
}

/** Mixed-feed item (server serializers/feed-item.serializer) — poem variant. */
export interface FeedPoemItem {
  type: 'poem';
  id: string;
  title: string;
  status: string;
  excerpt: string;
  language?: string;
  moods?: string[];
  tags?: string[];
  anonymous: boolean;
  publishedAt: string | null;
  author: FeedPoemAuthor | null;
}

export interface PromptSubmission {
  id: string;
  promptId: string;
  poemId: string;
  createdAt: string;
  poem: FeedPoemItem;
}

export interface SubmissionPage {
  items: PromptSubmission[];
  nextCursor: string | null;
}

export interface MyPoemsPage {
  items: FeedPoemItem[];
  nextCursor: string | null;
}

export async function getCurrentPrompt(): Promise<Prompt> {
  const { data } = await api.get<Prompt>('/prompts/current');
  return data;
}

export async function listPromptSubmissions(
  promptId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<SubmissionPage> {
  const { data } = await api.get<SubmissionPage>(
    `/prompts/${encodeURIComponent(promptId)}/submissions`,
    { params: { cursor: options.cursor, limit: options.limit } },
  );
  return data;
}

export async function submitToPrompt(promptId: string, poemId: string): Promise<PromptSubmissionSummary> {
  const { data } = await api.post<PromptSubmissionSummary>(
    `/prompts/${encodeURIComponent(promptId)}/submissions`,
    { poemId },
  );
  return data;
}

export async function listMyPoems(
  options: { status?: 'draft' | 'published'; cursor?: string; limit?: number } = {},
): Promise<MyPoemsPage> {
  const { data } = await api.get<MyPoemsPage>('/poems/mine', {
    params: { status: options.status, cursor: options.cursor, limit: options.limit },
  });
  return data;
}
