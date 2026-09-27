import api from './client';
import type { Poem } from './poems';

/**
 * Duels client (Phase 9, plan steps 68–71): paired poems competing on a
 * theme. The server derives the effective phase from the deadlines — the
 * `status` in every response is already derived.
 */
export type DuelStatus = 'open' | 'voting' | 'closed';
export type VoteSide = 'A' | 'B';

export interface DuelVotes {
  poemA: number;
  poemB: number;
}

export interface Duel {
  id: string;
  theme: string;
  poetAId: string;
  poetBId: string;
  poemAId: string;
  poemBId: string;
  submissionDeadline: string;
  votingDeadline: string;
  votes: DuelVotes;
  status: DuelStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DuelDetail extends Duel {
  poemA: Poem;
  poemB: Poem;
  myVote: VoteSide | null;
}

export interface DuelPage {
  items: Duel[];
  nextCursor: string | null;
}

export async function listDuels(limit = 20): Promise<DuelPage> {
  const { data } = await api.get<DuelPage>('/duels', { params: { limit } });
  return data;
}

export async function getDuel(id: string): Promise<DuelDetail> {
  const { data } = await api.get<DuelDetail>(`/duels/${encodeURIComponent(id)}`);
  return data;
}

/** 201 with the authoritative vote tally — use it to settle optimistic state. */
export async function voteDuel(id: string, votedFor: VoteSide): Promise<DuelDetail> {
  const { data } = await api.post<DuelDetail>(
    `/duels/${encodeURIComponent(id)}/vote`,
    { votedFor },
  );
  return data;
}
