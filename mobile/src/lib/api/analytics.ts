import api from './client';

/**
 * Analytics client (Phase 12, plan steps 82-84): the writer dashboard
 * aggregation and the best-effort read ping fired when a poem screen mounts.
 * Both unwrap the axios envelope like every other client module.
 */
export interface WriterTotals {
  poems: number;
  reads: number;
  reactions: number;
  comments: number;
  saves: number;
  followers: number;
}

export interface WriterDayStat {
  date: string;
  reads: number;
  reactions: number;
  comments: number;
  saves: number;
  followers: number;
}

export interface WriterAnalytics {
  range: { from: string; to: string; days: number };
  totals: WriterTotals;
  days: WriterDayStat[];
}

export async function getWriterAnalytics(days = 30): Promise<WriterAnalytics> {
  const { data } = await api.get<WriterAnalytics>('/analytics/writer', { params: { days } });
  return data;
}

/**
 * Fire-and-forget: the reader screen never awaits this. The response body
 * is intentionally not destructured — bare test mocks resolve undefined,
 * and the server does the visibility check + queueing (plan step 82).
 */
export async function recordPoemRead(id: string): Promise<void> {
  await api.post(`/poems/${encodeURIComponent(id)}/read`);
}
