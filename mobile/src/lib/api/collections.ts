import api from './client';
import { FeedItem } from './discover';

/**
 * Collections client (Phase 6, plan steps 58-59). Summaries carry `poemIds`
 * (raw membership) so the add-to-collection picker can compute in/out without
 * fetching every detail; only GET /collections/:id hydrates `poems`, ordered
 * by `poemIds`.
 */
export type CollectionVisibility = 'public' | 'followers' | 'private';

export interface CollectionSummary {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  visibility: CollectionVisibility;
  poemIds: string[];
  poemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionDetail extends CollectionSummary {
  poems: FeedItem[];
}

export interface CollectionPage {
  items: CollectionSummary[];
  nextCursor: string | null;
}

export interface CreateCollectionInput {
  title: string;
  description?: string;
  visibility?: CollectionVisibility;
}

export async function listCollections(limit = 50): Promise<CollectionPage> {
  const { data } = await api.get<CollectionPage>('/collections', { params: { limit } });
  return data;
}

export async function getCollection(id: string): Promise<CollectionDetail> {
  const { data } = await api.get<CollectionDetail>(`/collections/${encodeURIComponent(id)}`);
  return data;
}

export async function createCollection(input: CreateCollectionInput): Promise<CollectionSummary> {
  const { data } = await api.post<CollectionSummary>('/collections', input);
  return data;
}

export async function addPoemToCollection(
  collectionId: string,
  poemId: string,
): Promise<CollectionSummary> {
  const { data } = await api.post<CollectionSummary>(
    `/collections/${encodeURIComponent(collectionId)}/poems`,
    { poemId },
  );
  return data;
}

export async function removePoemFromCollection(
  collectionId: string,
  poemId: string,
): Promise<void> {
  await api.delete(`/collections/${encodeURIComponent(collectionId)}/poems/${encodeURIComponent(poemId)}`);
}
