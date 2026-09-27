import api from './client';

/**
 * Messaging client (Phase 10, plan steps 72–76): DM conversations and
 * cursor-paginated history. Anonymity is server-derived — `senderId`/`sender`
 * arrive `null` when the message (or whole thread) is anonymous; the client
 * never filters identities itself.
 */
export interface ConversationUser {
  id: string;
  username: string;
  displayName: string;
  profilePhotoUrl: string;
}

export interface Message {
  id: string;
  conversationId: string;
  content: string;
  isAnonymous: boolean;
  isMine: boolean;
  senderId: string | null;
  sender: ConversationUser | null;
  readAt: string | null;
  createdAt: string;
}

export interface ConversationSummary {
  id: string;
  isAnonymous: boolean;
  lastMessageAt: string;
  createdAt: string;
  otherUser: ConversationUser | null;
  lastMessage: Message | null;
  unreadCount: number;
}

export interface MessagePage {
  items: Message[];
  nextCursor: string | null;
}

export interface ConversationPage {
  items: ConversationSummary[];
  nextCursor: string | null;
}

export async function listConversations(limit = 20): Promise<ConversationPage> {
  const { data } = await api.get<ConversationPage>('/conversations', { params: { limit } });
  return data;
}

/** Get-or-create the thread with another user (201 new / 200 existing). */
export async function createConversation(
  userId: string,
  isAnonymous = false,
): Promise<ConversationSummary> {
  const { data } = await api.post<ConversationSummary>('/conversations', {
    userId,
    isAnonymous,
  });
  return data;
}

export async function listMessages(
  conversationId: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<MessagePage> {
  const { data } = await api.get<MessagePage>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { params: options },
  );
  return data;
}

/** 201 with the authoritative message — use it to settle optimistic rows. */
export async function sendMessage(
  conversationId: string,
  content: string,
  isAnonymous?: boolean,
): Promise<Message> {
  const { data } = await api.post<Message>(
    `/conversations/${encodeURIComponent(conversationId)}/messages`,
    { content, isAnonymous },
  );
  return data;
}
