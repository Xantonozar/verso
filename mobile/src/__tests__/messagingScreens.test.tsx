import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import MessagesScreen from '../app/(app)/messages';
import ChatScreen from '../app/(app)/chat/[id]';
import ProfileScreen from '../app/(app)/profile';
import UserProfileScreen from '../app/(app)/user/[id]';
import { default as api } from '../lib/api/client';
import {
  ConversationSummary,
  createConversation,
  listConversations,
  listMessages,
  Message,
  sendMessage,
} from '../lib/api/messaging';
import { listAuthorStories } from '../lib/api/stories';

/**
 * Phase 10 mobile gate (plan step 76): DM inbox rows, chat with optimistic
 * pending/sent/failed + retry, the anonymous toggle, and both navigation
 * entries (profile inbox, other-user Message button).
 */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../lib/toast', () => ({
  toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() },
}));

jest.mock('../lib/api/client', () => {
  const actual = jest.requireActual('../lib/api/client');
  return {
    __esModule: true,
    ...actual,
    default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
  };
});

jest.mock('../lib/api/messaging', () => ({
  listConversations: jest.fn(),
  createConversation: jest.fn(),
  listMessages: jest.fn(),
  sendMessage: jest.fn(),
}));

jest.mock('../lib/api/stories', () => ({
  listAuthorStories: jest.fn(),
}));

jest.mock('../context/AuthContext', () => {
  const value = {
    status: 'authenticated',
    user: { id: 'u1', username: 'author', displayName: 'Author Name' },
    signIn: jest.fn(),
    register: jest.fn(),
    signOut: jest.fn(),
    updateUser: jest.fn(),
  };
  return {
    AuthProvider: ({ children }: { children: React.ReactNode }) => children,
    useAuth: () => value,
  };
});

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: false })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('react-native-safe-area-context', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(View, null, children),
    SafeAreaView: ({ children, style }: { children: React.ReactNode; style?: unknown }) =>
      ReactModule.createElement(View, { style }, children),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
    initialWindowMetrics: null,
  };
});

const { router, useLocalSearchParams } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
  useLocalSearchParams: jest.Mock;
};
const apiMock = api as unknown as { get: jest.Mock; post: jest.Mock };
const listConversationsMock = listConversations as jest.Mock;
const listMessagesMock = listMessages as jest.Mock;
const sendMessageMock = sendMessage as jest.Mock;
const createConversationMock = createConversation as jest.Mock;
const listAuthorStoriesMock = listAuthorStories as jest.Mock;

const ISO = '2026-09-01T12:00:00.000Z';

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'm1',
    conversationId: 'c1',
    content: 'hello there',
    isAnonymous: false,
    isMine: false,
    senderId: 'u2',
    sender: { id: 'u2', username: 'carol', displayName: 'Carol', profilePhotoUrl: '' },
    readAt: null,
    createdAt: ISO,
    ...overrides,
  };
}

function makeConversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: 'c1',
    isAnonymous: false,
    lastMessageAt: ISO,
    createdAt: ISO,
    otherUser: { id: 'u2', username: 'carol', displayName: 'Carol', profilePhotoUrl: '' },
    lastMessage: makeMessage(),
    unreadCount: 2,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useLocalSearchParams.mockReturnValue({ id: 'c1', other: 'Carol', anon: '0' });
  listMessagesMock.mockResolvedValue({ items: [], nextCursor: null });
  listConversationsMock.mockResolvedValue({ items: [], nextCursor: null });
  listAuthorStoriesMock.mockResolvedValue({ items: [], nextCursor: null });
});

describe('DM inbox (plan step 76)', () => {
  test('renders rows with other user, preview, and unread badge', async () => {
    listConversationsMock.mockResolvedValue({
      items: [makeConversation()],
      nextCursor: null,
    });
    await render(<MessagesScreen />);

    expect(await screen.findByText('Carol')).toBeTruthy();
    expect(screen.getByText('@carol')).toBeTruthy();
    expect(screen.getByText('hello there')).toBeTruthy();
    expect(screen.getByLabelText('2 unread')).toBeTruthy();
    expect(screen.getByTestId('conversation-item-c1')).toBeTruthy();
  });

  test('anonymous conversation shows the indicator and hides the handle', async () => {
    listConversationsMock.mockResolvedValue({
      items: [makeConversation({ isAnonymous: true, otherUser: null })],
      nextCursor: null,
    });
    await render(<MessagesScreen />);

    expect(await screen.findByText('Anonymous conversation')).toBeTruthy();
    expect(screen.getByText('Anonymous: hello there')).toBeTruthy();
    expect(screen.queryByText('@carol')).toBeNull();
  });

  test('load error → retry recovers', async () => {
    listConversationsMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ items: [makeConversation()], nextCursor: null });
    await render(<MessagesScreen />);

    expect(await screen.findByText("Couldn't load your messages.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));
    expect(await screen.findByText('Carol')).toBeTruthy();
    expect(listConversationsMock).toHaveBeenCalledTimes(2);
  });

  test('empty inbox copy', async () => {
    await render(<MessagesScreen />);
    expect(await screen.findByText('No conversations yet')).toBeTruthy();
  });

  test('tapping a row routes to the chat with context params', async () => {
    listConversationsMock.mockResolvedValue({
      items: [makeConversation()],
      nextCursor: null,
    });
    await render(<MessagesScreen />);

    await fireEvent.press(await screen.findByTestId('conversation-item-c1'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'c1', other: 'Carol', anon: '0' },
    });
  });
});

describe('chat thread (plan step 76)', () => {
  test('loads history and offers older pages via cursor', async () => {
    listMessagesMock.mockResolvedValue({
      items: [
        makeMessage({ id: 'm2', content: 'newer message' }),
        makeMessage({ id: 'm1', content: 'older message' }),
      ],
      nextCursor: 'cursor-1',
    });
    await render(<ChatScreen />);

    expect(await screen.findByText('older message')).toBeTruthy();
    expect(screen.getByText('newer message')).toBeTruthy();
    expect(screen.getByTestId('chat-load-older')).toBeTruthy();
    expect(screen.getAllByText('Carol').length).toBeGreaterThan(0);
  });

  test('load earlier prepends the next cursor page', async () => {
    listMessagesMock
      .mockResolvedValueOnce({
        items: [makeMessage({ id: 'm2', content: 'recent' })],
        nextCursor: 'cursor-1',
      })
      .mockResolvedValueOnce({
        items: [makeMessage({ id: 'm0', content: 'much older' })],
        nextCursor: null,
      });
    await render(<ChatScreen />);
    expect(await screen.findByText('recent')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('chat-load-older'));
    expect(await screen.findByText('much older')).toBeTruthy();
    expect(listMessagesMock).toHaveBeenLastCalledWith('c1', {
      cursor: 'cursor-1',
      limit: 30,
    });
    await waitFor(() => expect(screen.queryByTestId('chat-load-older')).toBeNull());
  });

  test('optimistic send settles to sent (pending → sent)', async () => {
    sendMessageMock.mockResolvedValue(
      makeMessage({ id: 'm9', content: 'hello', isMine: true }),
    );
    await render(<ChatScreen />);
    await screen.findByTestId('chat-empty');

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'hello');
    await fireEvent.press(screen.getByTestId('chat-send'));

    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith('c1', 'hello', false),
    );
    await waitFor(() => expect(screen.queryByText('Sending…')).toBeNull());
    expect(screen.getAllByText('hello')).toHaveLength(1);
    expect(screen.getByText('Send')).toBeTruthy(); // button restored (draft cleared)
  });

  test('failed send shows retry and succeeds on the second attempt', async () => {
    sendMessageMock
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(makeMessage({ id: 'm9', content: 'try again', isMine: true }));
    await render(<ChatScreen />);
    await screen.findByTestId('chat-empty');

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'try again');
    await fireEvent.press(screen.getByTestId('chat-send'));

    const retryButton = await screen.findByText('Failed — tap to retry');
    await fireEvent.press(retryButton);

    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Failed — tap to retry')).toBeNull());
    expect(screen.getByText('try again')).toBeTruthy();
  });

  test('anonymous toggle marks outgoing messages anonymous', async () => {
    sendMessageMock.mockResolvedValue(
      makeMessage({ id: 'm9', content: 'faceless', isMine: true, isAnonymous: true }),
    );
    await render(<ChatScreen />);
    await screen.findByTestId('chat-empty');

    await fireEvent.press(screen.getByTestId('chat-anon-toggle'));
    expect(await screen.findByText('Anonymous: On')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('chat-input'), 'faceless');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith('c1', 'faceless', true),
    );
  });

  test('fully anonymous thread hides the toggle and forces anonymity', async () => {
    useLocalSearchParams.mockReturnValue({ id: 'c1', other: 'Carol', anon: '1' });
    sendMessageMock.mockResolvedValue(
      makeMessage({ id: 'm9', content: 'shh', isMine: true, isAnonymous: true }),
    );
    await render(<ChatScreen />);

    expect(await screen.findByTestId('chat-thread-anon')).toBeTruthy();
    expect(screen.queryByTestId('chat-anon-toggle')).toBeNull();
    expect(screen.getByText('Anonymous conversation')).toBeTruthy();

    await waitFor(() => expect(listMessagesMock).toHaveBeenCalled());
    await fireEvent.changeText(screen.getByTestId('chat-input'), 'shh');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await waitFor(() =>
      expect(sendMessageMock).toHaveBeenCalledWith('c1', 'shh', true),
    );
  });
});

describe('navigation entries (plan step 76)', () => {
  test('profile shows a Messages button that opens the inbox', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        id: 'u1',
        username: 'author',
        displayName: 'Author Name',
        email: 'author@example.com',
        bio: '',
        profilePhotoUrl: '',
        followerCount: 0,
        followingCount: 0,
      },
    });
    await render(<ProfileScreen />);

    await fireEvent.press(await screen.findByTestId('open-messages'));
    expect(router.push).toHaveBeenCalledWith('/messages');
  });

  test('profile shows a Notifications button that opens the inbox (plan step 81)', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        id: 'u1',
        username: 'author',
        displayName: 'Author Name',
        email: 'author@example.com',
        bio: '',
        profilePhotoUrl: '',
        followerCount: 0,
        followingCount: 0,
      },
    });
    await render(<ProfileScreen />);

    await fireEvent.press(await screen.findByTestId('open-notifications'));
    expect(router.push).toHaveBeenCalledWith('/notifications');
  });

  test('other-user profile Message button starts the thread and opens chat', async () => {
    apiMock.get.mockResolvedValue({
      data: {
        id: 'u2',
        username: 'carol',
        displayName: 'Carol',
        bio: '',
        profilePhotoUrl: '',
        followerCount: 1,
        followingCount: 2,
        isFollowing: false,
      },
    });
    createConversationMock.mockResolvedValue(makeConversation());
    useLocalSearchParams.mockReturnValue({ id: 'u2' });
    await render(<UserProfileScreen />);

    await fireEvent.press(await screen.findByTestId('message-user'));
    await waitFor(() => expect(createConversationMock).toHaveBeenCalledWith('u2'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/chat/[id]',
      params: { id: 'c1', other: 'Carol', anon: '0' },
    });
  });
});
