import api from './client';

/**
 * Notifications client (Phase 11, plan steps 78/81): inbox listing with
 * cursor pagination + unread badge count, mark-as-read, and push-token
 * registration (null clears the stored token server-side).
 */
export type NotificationType = 'reaction' | 'comment' | 'follow' | 'collab_turn' | 'duel_result';

export interface NotificationItem {
  id: string;
  type: NotificationType;
  poeticMessage: string;
  relatedType: string;
  relatedId: string;
  readAt: string | null;
  createdAt: string;
  isUnread: boolean;
}

export interface NotificationPage {
  items: NotificationItem[];
  nextCursor: string | null;
  unreadCount: number;
}

export async function listNotifications(
  options: { cursor?: string; limit?: number } = {},
): Promise<NotificationPage> {
  const { data } = await api.get<NotificationPage>('/notifications', { params: options });
  return data;
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const { data } = await api.patch<NotificationItem>(
    `/notifications/${encodeURIComponent(id)}/read`,
  );
  return data;
}

/** Store (or clear, with null) this device's Expo push token. */
export async function setPushToken(token: string | null): Promise<{ pushToken: string }> {
  const { data } = await api.put<{ pushToken: string }>('/users/me/push-token', { token });
  return data;
}
