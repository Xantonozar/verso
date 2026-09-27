import React from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import ProfileScreen from '../app/(app)/profile';
import { AuthUser } from '../context/AuthContext';
import { default as api } from '../lib/api/client';
import { listAuthorStories } from '../lib/api/stories';

/**
 * Phase 13 mobile gate (plan step 86): the reading-streak badge on the
 * own-profile screen (present for zero and non-zero streaks, absent when
 * the payload predates the field) plus the non-blocking personal-best
 * moment - a subtle in-place pulse + caption the FIRST time `longest`
 * grows past what this device last showed, silent on the baseline seed.
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

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    __store: store,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      setItem: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve(null);
      }),
      removeItem: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve(null);
      }),
    },
  };
});

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

const apiMock = api as unknown as { get: jest.Mock; post: jest.Mock };
const listAuthorStoriesMock = listAuthorStories as jest.Mock;
const storageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
  __store: Map<string, string>;
  default: { getItem: jest.Mock; setItem: jest.Mock };
};

const BEST_SEEN_KEY = 'verso:bestStreakSeen';

function meFixture(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    username: 'author',
    displayName: 'Author Name',
    email: 'author@example.com',
    bio: '',
    profilePhotoUrl: '',
    followerCount: 0,
    followingCount: 0,
    readingStreak: { current: 3, longest: 5, lastReadDate: '2026-09-26T00:00:00.000Z' },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  storageMock.__store.clear();
  listAuthorStoriesMock.mockResolvedValue({ items: [], nextCursor: null });
});

describe('reading-streak badge on profile (plan step 86)', () => {
  test('shows the current streak for a reader mid-streak', async () => {
    apiMock.get.mockResolvedValue({ data: meFixture() });
    await render(<ProfileScreen />);

    expect(await screen.findByTestId('streak-badge')).toBeTruthy();
    expect(await screen.findByText('3-day reading streak')).toBeTruthy();
    // first sight of this best only seeds the baseline - no celebration
    expect(screen.queryByTestId('streak-new-best')).toBeNull();
    await waitFor(() => expect(storageMock.default.getItem).toHaveBeenCalledWith(BEST_SEEN_KEY));
    expect(storageMock.__store.get(BEST_SEEN_KEY)).toBe('5');
  });

  test('new reader with no streak yet shows the empty state', async () => {
    apiMock.get.mockResolvedValue({
      data: meFixture({ readingStreak: { current: 0, longest: 0, lastReadDate: null } }),
    });
    await render(<ProfileScreen />);

    expect(await screen.findByText('No reading streak yet')).toBeTruthy();
    expect(screen.queryByTestId('streak-new-best')).toBeNull();
    // longest 0: nothing worth remembering, storage untouched
    expect(storageMock.default.getItem).not.toHaveBeenCalled();
  });

  test('payload without readingStreak renders no badge (back-compat)', async () => {
    apiMock.get.mockResolvedValue({ data: meFixture({ readingStreak: undefined }) });
    await render(<ProfileScreen />);

    expect(await screen.findByText('Author Name')).toBeTruthy();
    expect(screen.queryByTestId('streak-badge')).toBeNull();
    expect(storageMock.default.getItem).not.toHaveBeenCalled();
  });
});

describe('new personal-best moment (plan step 86)', () => {
  test('best growth past the last seen value celebrates in place', async () => {
    storageMock.__store.set(BEST_SEEN_KEY, '2');
    apiMock.get.mockResolvedValue({
      data: meFixture({ readingStreak: { current: 3, longest: 3, lastReadDate: '2026-09-28T00:00:00.000Z' } }),
    });
    await render(<ProfileScreen />);

    expect(await screen.findByText('New personal best!')).toBeTruthy();
    expect(await screen.findByTestId('streak-badge')).toBeTruthy();
    expect(storageMock.__store.get(BEST_SEEN_KEY)).toBe('3');
  });

  test('an already-seen best stays quiet and does not re-celebrate', async () => {
    storageMock.__store.set(BEST_SEEN_KEY, '5');
    apiMock.get.mockResolvedValue({ data: meFixture() });
    await render(<ProfileScreen />);

    expect(await screen.findByTestId('streak-badge')).toBeTruthy();
    await waitFor(() => expect(storageMock.default.getItem).toHaveBeenCalled());
    expect(screen.queryByTestId('streak-new-best')).toBeNull();
    expect(storageMock.__store.get(BEST_SEEN_KEY)).toBe('5');
  });
});
