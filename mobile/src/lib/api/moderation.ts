import api from './client';

/**
 * Moderation client (Phase 14, plan steps 87 + 90). Readers file reports
 * against poems/stories/comments/users/diaries; the review queue itself is
 * moderator-only and lives server-side (optional admin panel deferred).
 */
export type ReportTargetType = 'poem' | 'story' | 'comment' | 'user' | 'diary';

export type ReportReason =
  | 'spam'
  | 'harassment'
  | 'hate_speech'
  | 'sexual_content'
  | 'violence'
  | 'self_harm'
  | 'impersonation'
  | 'copyright'
  | 'other';

export type ReportStatus = 'pending' | 'reviewed' | 'actioned' | 'dismissed';

export interface ReportReasonOption {
  value: ReportReason;
  label: string;
}

export const REPORT_REASON_OPTIONS: ReportReasonOption[] = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'hate_speech', label: 'Hate speech' },
  { value: 'sexual_content', label: 'Sexual content' },
  { value: 'violence', label: 'Violence or threat' },
  { value: 'self_harm', label: 'Self-harm' },
  { value: 'impersonation', label: 'Impersonation' },
  { value: 'copyright', label: 'Copyright violation' },
  { value: 'other', label: 'Something else' },
];

export interface ReportSummary {
  id: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details: string;
  status: ReportStatus;
  createdAt: string;
}

export interface CreateReportInput {
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string;
}

export async function createReport(input: CreateReportInput): Promise<ReportSummary> {
  const { data } = await api.post<ReportSummary>('/reports', input);
  return data;
}
