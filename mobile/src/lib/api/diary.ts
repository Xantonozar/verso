import api from './client';

export type DiaryVisibility = 'public' | 'followers';

export interface DiaryAuthor {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl?: string;
}

export interface DiaryStats {
  reactionCount: number;
  commentCount: number;
}

export interface DiaryEntry {
  id: string;
  authorId?: string;
  content: string;
  visibility: DiaryVisibility;
  anonymous: boolean;
  stats?: DiaryStats;
  createdAt: string;
  updatedAt: string;
  author?: DiaryAuthor | null;
}

export interface CreateDiaryInput {
  content: string;
  visibility?: DiaryVisibility;
  anonymous?: boolean;
}

export async function createDiary(input: CreateDiaryInput): Promise<DiaryEntry> {
  const { data } = await api.post<DiaryEntry>('/diary', input);
  return data;
}

export async function getDiary(id: string): Promise<DiaryEntry> {
  const { data } = await api.get<DiaryEntry>(`/diary/${id}`);
  return data;
}
