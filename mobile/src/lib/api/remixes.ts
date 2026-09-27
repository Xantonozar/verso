import api from './client';
import type { Poem } from './poems';

/**
 * Remix client (Phase 9, plan step 70): one call creates the new poem and
 * the attribution link. `GET /poems/:id` carries `remixOf` for the reader's
 * attribution card.
 */
export interface RemixLink {
  id: string;
  originalPoemId: string;
  remixPoemId: string;
  createdAt: string;
}

export interface CreateRemixInput {
  originalPoemId: string;
  title: string;
  content: string;
  authorNote?: string;
  language?: string;
  moods?: string[];
  tags?: string[];
  visibility?: 'public' | 'unlisted' | 'followers';
}

export interface RemixResult {
  remix: RemixLink;
  poem: Poem;
}

export async function createRemix(input: CreateRemixInput): Promise<RemixResult> {
  const { data } = await api.post<RemixResult>('/remixes', input);
  return data;
}
