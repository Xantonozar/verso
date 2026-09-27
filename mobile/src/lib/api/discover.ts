import api from './client';
import { PoemAuthor } from './poems';

/**
 * Discovery + following-feed client (Phase 5, plan steps 53-54).
 * One item shape for every surface — the server's feed-item.serializer poem
 * branch (plan 41B); `author` is null for anonymous poems.
 */
export interface FeedItem {
  type: 'poem';
  id: string;
  title: string;
  status: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  stats: {
    reads?: number;
    reactionCount?: number;
    commentCount?: number;
    saveCount?: number;
    shareCount?: number;
  } | null;
  author: PoemAuthor | null;
  excerpt: string;
  language?: string;
  moods: string[];
  tags: string[];
  anonymous: boolean;
}

export interface FeedItemPage {
  items: FeedItem[];
  nextCursor: string | null;
}

export interface TrendingPage extends FeedItemPage {
  generatedAt?: string;
}

interface PageOptions {
  cursor?: string | null;
  limit?: number;
}

export async function getFeed(options: PageOptions = {}): Promise<FeedItemPage> {
  const { data } = await api.get<FeedItemPage>('/feed', {
    params: { cursor: options.cursor ?? undefined, limit: options.limit ?? 20 },
  });
  return data;
}

export async function getMoodFeed(
  mood: string,
  options: PageOptions = {},
): Promise<FeedItemPage> {
  const { data } = await api.get<FeedItemPage>(`/discover/mood/${encodeURIComponent(mood)}`, {
    params: { cursor: options.cursor ?? undefined, limit: options.limit ?? 20 },
  });
  return data;
}

export async function getTagFeed(tag: string, options: PageOptions = {}): Promise<FeedItemPage> {
  const { data } = await api.get<FeedItemPage>(`/discover/tags/${encodeURIComponent(tag)}`, {
    params: { cursor: options.cursor ?? undefined, limit: options.limit ?? 20 },
  });
  return data;
}

export async function getTrending(options: PageOptions = {}): Promise<TrendingPage> {
  const { data } = await api.get<TrendingPage>('/discover/trending', {
    params: { cursor: options.cursor ?? undefined, limit: options.limit ?? 20 },
  });
  return data;
}

/** Single random poem; server answers 404 DISCOVER_EMPTY on an empty corpus. */
export async function getRandomPoem(): Promise<FeedItem> {
  const { data } = await api.get<FeedItem>('/discover/random');
  return data;
}
