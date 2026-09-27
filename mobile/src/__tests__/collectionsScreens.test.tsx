import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CollectionsScreen from '../app/(app)/collections';
import CollectionDetailScreen from '../app/(app)/collection/[id]';
import PoemReaderScreen from '../app/(app)/poem/[id]';
import ProfileScreen from '../app/(app)/profile';
import { ApiError, default as api } from '../lib/api/client';
import {
  addPoemToCollection,
  CollectionDetail,
  CollectionSummary,
  createCollection,
  getCollection,
  listCollections,
  removePoemFromCollection,
} from '../lib/api/collections';
import { getMobilePoem, MobilePoemResponse } from '../lib/api/engagement';
import { FeedItem } from '../lib/api/discover';
import { toast } from '../lib/toast';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: () => ({ id: 'c1' }),
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

jest.mock('../lib/api/collections', () => ({
  listCollections: jest.fn(),
  getCollection: jest.fn(),
  createCollection: jest.fn(),
  addPoemToCollection: jest.fn(),
  removePoemFromCollection: jest.fn(),
}));

jest.mock('../lib/api/engagement', () => ({
  ...jest.requireActual('../lib/api/engagement'),
  getMobilePoem: jest.fn(),
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

jest.mock('@react-native-community/slider', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => ReactModule.createElement('Slider', props),
  };
});

const { router } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
};
const apiMock = api as unknown as { get: jest.Mock };

const listCollectionsMock = listCollections as jest.Mock;
const getCollectionMock = getCollection as jest.Mock;
const createCollectionMock = createCollection as jest.Mock;
const addPoemMock = addPoemToCollection as jest.Mock;
const removePoemMock = removePoemFromCollection as jest.Mock;
const getMobilePoemMock = getMobilePoem as jest.Mock;

function makeCollection(overrides: Partial<CollectionSummary> = {}): CollectionSummary {
  return {
    id: 'c1',
    ownerId: 'u1',
    title: 'Night reads',
    description: 'Insomnia shelf',
    visibility: 'public',
    poemIds: ['p1', 'p2'],
    poemCount: 2,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeFeedItem(id: string, title: string): FeedItem {
  return {
    type: 'poem',
    id,
    title,
    status: 'published',
    publishedAt: '2026-09-01T10:00:00.000Z',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    stats: { reads: 1, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 },
    author: { id: 'u1', username: 'author', displayName: 'Author Name' },
    excerpt: 'a quiet line under the lamp',
    language: 'en',
    moods: ['calm'],
    tags: ['night'],
    anonymous: false,
  };
}

function makeDetail(): CollectionDetail {
  return {
    ...makeCollection(),
    poems: [makeFeedItem('p1', 'Lamplight'), makeFeedItem('p2', 'Tram stop')],
  };
}

function makeMobilePoem(): MobilePoemResponse {
  return {
    poem: {
      id: 'p1',
      authorId: 'u1',
      title: 'First light',
      content: 'Dawn spills over the hill.',
      authorNote: '',
      language: 'en',
      moods: [],
      tags: [],
      visibility: 'public',
      anonymous: false,
      status: 'published',
      currentVersionId: 'v1',
      draftSavedAt: null,
      stats: { reads: 1, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 },
      audioUrl: '',
      videoUrl: '',
      publishedAt: '2026-09-01T10:00:00.000Z',
      createdAt: '2026-09-01T10:00:00.000Z',
      updatedAt: '2026-09-01T10:00:00.000Z',
      author: { id: 'u1', username: 'author', displayName: 'Author Name' },
    },
    reactionCounts: {},
    feltGood: { average: null, count: 0 },
    viewer: { reactions: [], saved: false, feltGood: null },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  [listCollectionsMock, getCollectionMock, createCollectionMock, addPoemMock, removePoemMock].forEach(
    (mock) => mock.mockReset(),
  );
  getMobilePoemMock.mockReset();
  getMobilePoemMock.mockResolvedValue(makeMobilePoem());
});

describe('Collections hub — list + create flow (plan 58)', () => {
  it('lists my collections and routes to the detail on tap', async () => {
    listCollectionsMock.mockResolvedValue({
      items: [makeCollection(), makeCollection({ id: 'c2', title: 'Winter lines', poemIds: [], poemCount: 0 })],
      nextCursor: null,
    });

    await render(<CollectionsScreen />);

    expect(await screen.findByTestId('collections-list')).toBeTruthy();
    expect(screen.getByText('Night reads · 2 poems')).toBeTruthy();
    expect(screen.getByText('Winter lines · 0 poems')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('collection-item-c1'));
    });
    expect(router.push).toHaveBeenCalledWith('/collection/c1');
  });

  it('empty state → create form validates title, then adds the new collection', async () => {
    listCollectionsMock.mockResolvedValue({ items: [], nextCursor: null });
    createCollectionMock.mockResolvedValue(
      makeCollection({ id: 'c3', title: 'Night reads', poemIds: [], poemCount: 0 }),
    );

    await render(<CollectionsScreen />);

    expect(await screen.findByTestId('collections-empty')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('collections-new'));
    });
    // submit with an empty title → client-side error, no API call
    await act(async () => {
      fireEvent.press(screen.getByTestId('collections-create'));
    });
    expect(await screen.findByText('is required')).toBeTruthy();
    expect(createCollectionMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.changeText(screen.getByTestId('collections-title'), 'Night reads');
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('collections-visibility-private'));
    });
    await act(async () => {
      fireEvent.press(screen.getByTestId('collections-create'));
    });

    expect(createCollectionMock).toHaveBeenCalledWith({
      title: 'Night reads',
      visibility: 'private',
      description: undefined,
    });
    expect(await screen.findByTestId('collection-item-c3')).toBeTruthy();
    expect(screen.queryByTestId('collections-empty')).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Collection created');
  });

  it('load failure shows retry; Try again reloads', async () => {
    listCollectionsMock
      .mockRejectedValueOnce(new ApiError('boom', 500, 'INTERNAL_ERROR'))
      .mockResolvedValueOnce({ items: [makeCollection()], nextCursor: null });

    await render(<CollectionsScreen />);

    expect(await screen.findByText("Couldn't load your collections.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
    });

    expect(await screen.findByText('Night reads · 2 poems')).toBeTruthy();
    expect(listCollectionsMock).toHaveBeenCalledTimes(2);
  });
});

describe('Collection detail — remove with optimistic update (plan 58)', () => {
  it('renders poems in order and drops one immediately before the server answers', async () => {
    getCollectionMock.mockResolvedValue(makeDetail());
    let resolveRemove!: (value: unknown) => void;
    removePoemMock.mockReturnValue(
      new Promise((resolve) => {
        resolveRemove = resolve;
      }),
    );

    await render(<CollectionDetailScreen />);

    expect(await screen.findByTestId('collection-poems')).toBeTruthy();
    expect(screen.getByText('Lamplight')).toBeTruthy();
    expect(screen.getByText('Tram stop')).toBeTruthy();
    const rows = screen.getAllByTestId(/^collection-poem-/);
    expect(rows.map((row) => row.props.testID)).toEqual([
      'collection-poem-p1',
      'collection-poem-p2',
    ]);
    expect(screen.getByText('Public · 2 poems')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('remove-p1'));
    });

    // optimistic: gone before the DELETE settles
    expect(screen.queryByTestId('collection-poem-p1')).toBeNull();
    expect(screen.getByText('Public · 1 poem')).toBeTruthy();
    expect(removePoemMock).toHaveBeenCalledWith('c1', 'p1');

    await act(async () => {
      resolveRemove(undefined);
    });
    expect(toast.success).toHaveBeenCalledWith('Removed from collection');
    expect(screen.queryByTestId('collection-poem-p1')).toBeNull();
  });

  it('rolls back to the snapshot when the remove fails', async () => {
    getCollectionMock.mockResolvedValue(makeDetail());
    removePoemMock.mockRejectedValue(new Error('nope'));

    await render(<CollectionDetailScreen />);
    expect(await screen.findByTestId('collection-poems')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('remove-p2'));
    });

    expect(await screen.findByTestId('collection-poem-p2')).toBeTruthy();
    expect(screen.getByText('Public · 2 poems')).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith("Couldn't remove the poem. Try again.");
  });
});

describe('Reader — Add to collection picker with optimistic membership (plan 59)', () => {
  it('opens the picker showing in/out membership per collection', async () => {
    listCollectionsMock.mockResolvedValue({
      items: [
        makeCollection({ poemIds: ['p1'], poemCount: 1 }),
        makeCollection({ id: 'c2', title: 'Winter lines', poemIds: [], poemCount: 0 }),
      ],
      nextCursor: null,
    });

    await render(<PoemReaderScreen />);
    expect(await screen.findByTestId('add-to-collection')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('add-to-collection'));
    });

    expect(await screen.findByTestId('pick-c1')).toBeTruthy();
    expect(screen.getByText('✓ Night reads')).toBeTruthy();
    expect(screen.getByText('Winter lines')).toBeTruthy();
  });

  it('adds the poem to a collection optimistically, then keeps it after confirm', async () => {
    listCollectionsMock.mockResolvedValue({
      items: [
        makeCollection({ poemIds: ['p1'], poemCount: 1 }),
        makeCollection({ id: 'c2', title: 'Winter lines', poemIds: [], poemCount: 0 }),
      ],
      nextCursor: null,
    });
    addPoemMock.mockResolvedValue(makeCollection({ id: 'c2', poemIds: ['p1'], poemCount: 1 }));

    await render(<PoemReaderScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('add-to-collection'));
    });
    expect(await screen.findByTestId('pick-c2')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-c2'));
    });

    // optimistic flip is visible immediately
    expect(screen.getByText('✓ Winter lines')).toBeTruthy();
    expect(addPoemMock).toHaveBeenCalledWith('c2', 'p1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(toast.success).toHaveBeenCalledWith('Added to collection');
  });

  it('removes membership when tapping a collection the poem is already in', async () => {
    listCollectionsMock.mockResolvedValue({
      items: [makeCollection({ poemIds: ['p1'], poemCount: 1 })],
      nextCursor: null,
    });
    removePoemMock.mockResolvedValue(undefined);

    await render(<PoemReaderScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('add-to-collection'));
    });
    expect(await screen.findByText('✓ Night reads')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-c1'));
    });

    expect(screen.getByText('Night reads')).toBeTruthy();
    expect(removePoemMock).toHaveBeenCalledWith('c1', 'p1');
    await act(async () => {
      await Promise.resolve();
    });
    expect(toast.success).toHaveBeenCalledWith('Removed from collection');
  });

  it('rolls the membership back when the add fails', async () => {
    listCollectionsMock.mockResolvedValue({
      items: [makeCollection({ id: 'c2', title: 'Winter lines', poemIds: [], poemCount: 0 })],
      nextCursor: null,
    });
    addPoemMock.mockRejectedValue(new Error('boom'));

    await render(<PoemReaderScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('add-to-collection'));
    });
    expect(await screen.findByText('Winter lines')).toBeTruthy();

    await act(async () => {
      fireEvent.press(screen.getByTestId('pick-c2'));
    });

    expect(await screen.findByText('Winter lines')).toBeTruthy();
    expect(screen.queryByText('✓ Winter lines')).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("Couldn't update the collection. Try again.");
  });
});

describe('Profile — Collections entry point (plan 59)', () => {
  it('offers Collections next to Feed / Discover and routes there', async () => {
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

    expect(await screen.findByTestId('open-collections')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByTestId('open-collections'));
    });
    expect(router.push).toHaveBeenCalledWith('/collections');
  });
});
