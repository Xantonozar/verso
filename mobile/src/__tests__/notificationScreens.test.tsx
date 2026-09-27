import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import NotificationsScreen from '../app/(app)/notifications';
import {
  listNotifications,
  markNotificationRead,
  NotificationItem,
  setPushToken,
} from '../lib/api/notifications';

/**
 * Phase 11 mobile gate (plan steps 78/81): notifications inbox rendering,
 * unread badge + mark-as-read on view, cursor pagination, empty/error
 * states, and the push permission explainer flow (grant + denied + dismiss).
 */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../lib/api/notifications', () => ({
  listNotifications: jest.fn(),
  markNotificationRead: jest.fn(),
  setPushToken: jest.fn(),
}));

jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4, MAX: 5 },
}));

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: { extra: { eas: { projectId: 'test-project' } } },
    easConfig: null,
  },
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

const { router } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
};
const { getPermissionsAsync, requestPermissionsAsync, getExpoPushTokenAsync } =
  jest.requireMock('expo-notifications') as {
    getPermissionsAsync: jest.Mock;
    requestPermissionsAsync: jest.Mock;
    getExpoPushTokenAsync: jest.Mock;
  };

const listNotificationsMock = listNotifications as jest.Mock;
const markNotificationReadMock = markNotificationRead as jest.Mock;
const setPushTokenMock = setPushToken as jest.Mock;

const ISO = '2026-09-01T12:00:00.000Z';

function makeNotification(overrides: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    type: 'reaction',
    poeticMessage: 'A poet admired your verse.',
    relatedType: 'poem',
    relatedId: 'p1',
    readAt: null,
    createdAt: ISO,
    isUnread: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  listNotificationsMock.mockResolvedValue({ items: [], nextCursor: null, unreadCount: 0 });
  markNotificationReadMock.mockImplementation(async (id: string) =>
    makeNotification({ id, isUnread: false, readAt: ISO }),
  );
  getPermissionsAsync.mockResolvedValue({ status: 'undetermined', granted: false });
  requestPermissionsAsync.mockResolvedValue({ status: 'granted', granted: true });
  getExpoPushTokenAsync.mockResolvedValue({ data: 'ExpoPushToken[Test]' });
  setPushTokenMock.mockResolvedValue({ pushToken: 'ExpoPushToken[Test]' });
});

describe('Notifications inbox (plan steps 78/81)', () => {
  test('renders rows with the poetic message', async () => {
    listNotificationsMock.mockResolvedValue({
      items: [makeNotification()],
      nextCursor: null,
      unreadCount: 1,
    });
    await render(<NotificationsScreen />);

    expect(await screen.findByText('A poet admired your verse.')).toBeTruthy();
    expect(screen.getByTestId('notification-item-n1')).toBeTruthy();
  });

  test('unread badge appears and clears after mark-as-read on view', async () => {
    let resolveMark: ((value: NotificationItem) => void) | undefined;
    markNotificationReadMock.mockReturnValue(
      new Promise<NotificationItem>((resolve) => {
        resolveMark = resolve;
      }),
    );
    listNotificationsMock.mockResolvedValue({
      items: [makeNotification()],
      nextCursor: null,
      unreadCount: 1,
    });
    await render(<NotificationsScreen />);

    expect(await screen.findByTestId('unread-badge')).toBeTruthy();
    await waitFor(() => expect(markNotificationReadMock).toHaveBeenCalledWith('n1'));

    await act(async () => {
      resolveMark?.(makeNotification({ id: 'n1', isUnread: false, readAt: ISO }));
    });
    await waitFor(() => expect(screen.queryByTestId('unread-badge')).toBeNull());
  });

  test('already-read rows keep a stable badge and show load-more', async () => {
    listNotificationsMock.mockResolvedValue({
      items: [makeNotification({ id: 'n1', isUnread: false, readAt: ISO })],
      nextCursor: 'cursor-1',
      unreadCount: 2,
    });
    await render(<NotificationsScreen />);

    expect(await screen.findByTestId('unread-badge')).toBeTruthy();
    expect(screen.getByLabelText('2 unread')).toBeTruthy();
    expect(screen.getByTestId('notifications-load-more')).toBeTruthy();
    expect(markNotificationReadMock).not.toHaveBeenCalled();
  });

  test('load-more appends the next cursor page', async () => {
    listNotificationsMock.mockResolvedValueOnce({
      items: [makeNotification({ id: 'n1', isUnread: false, readAt: ISO })],
      nextCursor: 'cursor-1',
      unreadCount: 0,
    });
    await render(<NotificationsScreen />);
    expect(await screen.findByTestId('notification-item-n1')).toBeTruthy();

    listNotificationsMock.mockResolvedValueOnce({
      items: [makeNotification({ id: 'n2', isUnread: false, readAt: ISO })],
      nextCursor: null,
      unreadCount: 0,
    });
    await fireEvent.press(screen.getByTestId('notifications-load-more'));

    expect(await screen.findByTestId('notification-item-n2')).toBeTruthy();
    expect(listNotificationsMock).toHaveBeenCalledWith({ cursor: 'cursor-1' });
  });

  test('empty state shows the catch-up copy', async () => {
    await render(<NotificationsScreen />);

    expect(await screen.findByTestId('notifications-empty')).toBeTruthy();
    expect(screen.getByText("You're all caught up.")).toBeTruthy();
    expect(markNotificationReadMock).not.toHaveBeenCalled();
  });

  test('tapping a poem row routes to the poem', async () => {
    listNotificationsMock.mockResolvedValue({
      items: [makeNotification()],
      nextCursor: null,
      unreadCount: 1,
    });
    await render(<NotificationsScreen />);

    await fireEvent.press(await screen.findByTestId('notification-item-n1'));
    expect(router.push).toHaveBeenCalledWith('/poem/p1');
  });

  test('load error → retry recovers', async () => {
    listNotificationsMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({
        items: [makeNotification({ isUnread: false, readAt: ISO })],
        nextCursor: null,
        unreadCount: 0,
      });
    await render(<NotificationsScreen />);

    expect(await screen.findByText("Couldn't load your notifications.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Retry'));

    expect(await screen.findByTestId('notification-item-n1')).toBeTruthy();
  });
});

describe('Push permission explainer (plan step 81)', () => {
  test('grant flow registers the Expo push token', async () => {
    await render(<NotificationsScreen />);

    expect(await screen.findByTestId('push-explainer')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('push-enable'));

    await waitFor(() => expect(requestPermissionsAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getExpoPushTokenAsync).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(setPushTokenMock).toHaveBeenCalledWith('ExpoPushToken[Test]'));
    await waitFor(() => expect(screen.queryByTestId('push-explainer')).toBeNull());
  });

  test('denied permission shows the settings note', async () => {
    getPermissionsAsync.mockResolvedValue({ status: 'denied', granted: false });
    await render(<NotificationsScreen />);

    expect(await screen.findByTestId('push-denied-note')).toBeTruthy();
    expect(screen.queryByTestId('push-enable')).toBeNull();
  });

  test('Not now dismisses the explainer', async () => {
    await render(<NotificationsScreen />);
    expect(await screen.findByTestId('push-explainer')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('push-dismiss'));

    expect(screen.queryByTestId('push-explainer')).toBeNull();
    expect(requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
