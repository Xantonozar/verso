import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DiscoverScreen from '../app/(app)/discover';
import FeedScreen from '../app/(app)/feed';
import ProfileScreen from '../app/(app)/profile';
import { ApiError, default as api } from '../lib/api/client';
import {
  FeedItem,
  getFeed,
  getMoodFeed,
  getRandomPoem,
  getTagFeed,
  getTrending,
} from '../lib/api/discover';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: () => ({}),
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

jest.mock('../lib/api/discover', () => ({
  getFeed: jest.fn(),
  getMoodFeed: jest.fn(),
  getTagFeed: jest.fn(),
  getTrending: jest.fn(),
  getRandomPoem: jest.fn(),
}));

// One stable object — a fresh useAuth() per render retriggers profile's
// effect in an infinite loop.
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

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
    __store: store,
  };
});

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    __store: store,
    default: {
      getItem: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
      setItem: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      removeItem: jest.fn((key: string) => {
        store.delete(key);
        return Promise.resolve();
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
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    initialWindowMetrics: null,
  };
});

const { router } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
};
const apiMock = api as unknown as { get: jest.Mock; post: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
});

function makeItem(id: string, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    type: 'poem',
    id,
    title: `Poem ${id}`,
    status: 'published',
    publishedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    stats: { reads: 1, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 },
    author: { id: 'a1', username: 'writer', displayName: 'Writer', profilePhotoUrl: '' },
    excerpt: 'a line about the rain and the waiting tram',
    language: 'en',
    moods: ['rain'],
    tags: ['nature'],
    anonymous: false,
    ...overrides,
  };
}

describe('Feed screen — infinite scroll with distinct states (plan 56)', () => {
  it('renders page 1, then fetches with the cursor and shows the end footer', async () => {
    (getFeed as jest.Mock)
      .mockResolvedValueOnce({ items: [makeItem('1'), makeItem('2')], nextCursor: 'c1' })
      .mockResolvedValueOnce({ items: [makeItem('3')], nextCursor: null });

    await render(<FeedScreen />);

    expect(await screen.findByTestId('feed-list')).toBeTruthy();
    expect(screen.getByText('Poem 1')).toBeTruthy();
    expect(getFeed).toHaveBeenCalledWith({ cursor: null, limit: 20 });
    // mid-scroll: cursor exists, so the end footer must NOT show yet
    expect(screen.queryByTestId('feed-end')).toBeNull();

    await act(async () => {
      fireEvent(screen.getByTestId('feed-list'), 'onEndReached');
    });

    expect(await screen.findByText('Poem 3')).toBeTruthy();
    expect(getFeed).toHaveBeenLastCalledWith({ cursor: 'c1', limit: 20 });
    expect(await screen.findByTestId('feed-end')).toBeTruthy();
  });

  it('empty feed shows "Nothing here yet", never the end footer', async () => {
    (getFeed as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

    await render(<FeedScreen />);

    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByTestId('feed-end')).toBeNull();
    expect(screen.queryByTestId('feed-list')).toBeNull();
  });

  it('load failure shows a retry view; Try again reloads page 1', async () => {
    (getFeed as jest.Mock)
      .mockRejectedValueOnce(new ApiError('boom', 500, 'INTERNAL_ERROR'))
      .mockResolvedValueOnce({ items: [makeItem('9')], nextCursor: null });

    await render(<FeedScreen />);

    expect(await screen.findByText('Could not load poems. Please try again.')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });
    expect(await screen.findByText('Poem 9')).toBeTruthy();
    expect(getFeed).toHaveBeenCalledTimes(2);
  });
});

describe('Discover screen — trending / moods / tags / random (plan 56)', () => {
  it('trending tab lists precomputed poems', async () => {
    (getTrending as jest.Mock).mockResolvedValue({
      items: [makeItem('t1'), makeItem('t2')],
      nextCursor: null,
      generatedAt: '2026-09-27T00:00:00.000Z',
    });

    await render(<DiscoverScreen />);

    expect(await screen.findByTestId('trending-list')).toBeTruthy();
    expect(screen.getByText('Poem t1')).toBeTruthy();
    expect(await screen.findByText("You've reached the end")).toBeTruthy();
  });

  it('empty trending shows its own empty state', async () => {
    (getTrending as jest.Mock).mockResolvedValue({
      items: [],
      nextCursor: null,
      generatedAt: '2026-09-27T00:00:00.000Z',
    });

    await render(<DiscoverScreen />);

    expect(await screen.findByText('Nothing trending yet')).toBeTruthy();
    expect(screen.queryByTestId('trending-end')).toBeNull();
  });

  it('moods tab: picker first, then loads poems for the chosen mood', async () => {
    (getMoodFeed as jest.Mock).mockResolvedValue({
      items: [makeItem('m1')],
      nextCursor: null,
    });

    await render(<DiscoverScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-tab-moods'));
    });

    expect(await screen.findByText('Pick a mood')).toBeTruthy();
    expect(getMoodFeed).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('mood-chip-rain'));
    });

    expect(await screen.findByText('Poem m1')).toBeTruthy();
    expect(getMoodFeed).toHaveBeenCalledWith('rain', { cursor: null, limit: 20 });
  });

  it('empty mood result shows "Nothing here yet" (not the end footer)', async () => {
    (getMoodFeed as jest.Mock).mockResolvedValue({ items: [], nextCursor: null });

    await render(<DiscoverScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-tab-moods'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('mood-chip-grief'));
    });

    expect(await screen.findByText('Nothing here yet')).toBeTruthy();
    expect(screen.queryByTestId('mood-list-end')).toBeNull();
  });

  it('tags tab derives chips from trending and loads the tag on tap', async () => {
    (getTrending as jest.Mock).mockResolvedValue({
      items: [makeItem('t1', { tags: ['nature', 'rain'] })],
      nextCursor: null,
      generatedAt: '2026-09-27T00:00:00.000Z',
    });
    (getTagFeed as jest.Mock).mockResolvedValue({
      items: [makeItem('g1')],
      nextCursor: null,
    });

    await render(<DiscoverScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-tab-tags'));
    });

    expect(await screen.findByTestId('tag-chip-nature')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('tag-chip-nature'));
    });

    expect(await screen.findByText('Poem g1')).toBeTruthy();
    expect(getTagFeed).toHaveBeenCalledWith('nature', { cursor: null, limit: 20 });
  });

  it('random: draw returns one poem and can draw again', async () => {
    (getRandomPoem as jest.Mock)
      .mockResolvedValueOnce(makeItem('r1'))
      .mockResolvedValueOnce(makeItem('r2'));

    await render(<DiscoverScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-tab-random'));
    });

    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-random'));
    });

    expect(await screen.findByTestId('random-item')).toBeTruthy();
    expect(screen.getByText('Poem r1')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-random'));
    });

    expect(await screen.findByText('Poem r2')).toBeTruthy();
    expect(getRandomPoem).toHaveBeenCalledTimes(2);
  });

  it('random on an empty corpus shows the DISCOVER_EMPTY state (and can retry)', async () => {
    (getRandomPoem as jest.Mock).mockRejectedValue(
      new ApiError('Nothing published yet', 404, 'DISCOVER_EMPTY'),
    );

    await render(<DiscoverScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-tab-random'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('discover-random'));
    });

    expect(await screen.findByText('Nothing published yet')).toBeTruthy();
    // still able to try again once the corpus has poems
    expect(screen.getByTestId('discover-random')).toBeTruthy();
  });
});

describe('Profile — Feed / Discover entry points (plan 56, profile is the hub)', () => {
  it('offers Feed and Discover and routes to both screens', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/users/me') {
        return Promise.resolve({
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
      }
      if (url === '/users/u1/stories') {
        return Promise.resolve({ data: { items: [], nextCursor: null } });
      }
      return Promise.resolve({ data: null });
    });

    await render(<ProfileScreen />);

    expect(await screen.findByTestId('open-feed')).toBeTruthy();
    expect(await screen.findByTestId('open-discover')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('open-feed'));
    });
    expect(router.push).toHaveBeenCalledWith('/feed');

    await act(async () => {
      fireEvent.press(screen.getByTestId('open-discover'));
    });
    expect(router.push).toHaveBeenCalledWith('/discover');
  });
});
