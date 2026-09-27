import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PoemReaderScreen from '../app/(app)/poem/[id]';
import EditPoemScreen from '../app/(app)/poem/[id]/edit';
import { FeltGoodCard } from '../components/engage/FeltGoodCard';
import { ApiError, default as api } from '../lib/api/client';
import { Poem } from '../lib/api/poems';
import { toast } from '../lib/toast';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: () => ({ id: 'p1' }),
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

// The reader fires a best-effort read ping on mount (Phase 12, plan step 82);
// mock it here so it never pollutes api.post call assertions below.
jest.mock('../lib/api/analytics', () => ({
  recordPoemRead: jest.fn().mockResolvedValue(undefined),
  getWriterAnalytics: jest.fn(),
}));

jest.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', username: 'author', displayName: 'Author Name' },
    signIn: jest.fn(),
    register: jest.fn(),
    signOut: jest.fn(),
    updateUser: jest.fn(),
  }),
}));

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

const apiMock = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const poemFixture: Poem = {
  id: 'p1',
  authorId: 'u2',
  title: 'First light',
  content: 'Dawn spills\nover the hill.',
  authorNote: '',
  language: 'en',
  moods: [],
  tags: [],
  visibility: 'public',
  anonymous: false,
  status: 'published',
  currentVersionId: 'v1',
  draftSavedAt: null,
  stats: { reads: 4, reactionCount: 5, commentCount: 2, saveCount: 5, shareCount: 0 },
  audioUrl: '',
  videoUrl: '',
  publishedAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  author: { id: 'u2', username: 'other', displayName: 'Other Poet' },
};

function commentFixture(over: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    targetType: 'poem',
    targetId: 'p1',
    parentCommentId: null,
    anonymous: false,
    content: 'This stayed with me',
    createdAt: '2026-09-02T10:00:00.000Z',
    authorId: 'u9',
    author: { id: 'u9', username: 'reader', displayName: 'Reader One' },
    replyCount: 0,
    replies: [],
    ...over,
  };
}

interface ApiState {
  bff: Record<string, unknown>;
  poem: Poem;
  commentPages: { items: unknown[]; nextCursor: string | null }[];
  addReaction: unknown;
  removeReaction: unknown;
  feltPost: unknown;
  feltPatch: unknown;
  save: unknown;
  unsave: unknown;
  createdComment: unknown;
  deleted: unknown;
  publish: unknown;
  unpublish: unknown;
  postError: ApiError | null;
  deleteError: ApiError | null;
}

const state: ApiState = {
  bff: {},
  poem: poemFixture,
  commentPages: [{ items: [], nextCursor: null }],
  addReaction: { reaction: { id: 'r1', type: 'loved' }, stats: poemFixture.stats },
  removeReaction: { removed: true, type: 'loved', stats: poemFixture.stats },
  feltPost: { id: 'fg1', poemId: 'p1', score: 50, comment: '', createdAt: '', updatedAt: '' },
  feltPatch: { id: 'fg1', poemId: 'p1', score: 80, comment: '', createdAt: '', updatedAt: '' },
  save: { saved: true, stats: { ...poemFixture.stats!, saveCount: 6 } },
  unsave: { saved: false, stats: { ...poemFixture.stats!, saveCount: 4 } },
  createdComment: commentFixture(),
  deleted: { id: 'c1', deleted: true, status: 'removed' },
  publish: { ...poemFixture, status: 'published' },
  unpublish: { ...poemFixture, status: 'draft' },
  postError: null,
  deleteError: null,
};

function bff(over: Partial<Record<string, unknown>> = {}) {
  return {
    poem: poemFixture,
    reactionCounts: { loved: 3, beautiful: 2 },
    feltGood: { average: 72, count: 4 },
    viewer: {
      reactions: ['loved'] as string[],
      saved: true,
      feltGood: { score: 65, comment: '' },
    },
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();

  state.bff = bff();
  state.poem = poemFixture;
  state.commentPages = [{ items: [], nextCursor: null }];
  state.addReaction = { reaction: { id: 'r1', type: 'loved' }, stats: poemFixture.stats };
  state.removeReaction = { removed: true, type: 'loved', stats: poemFixture.stats };
  state.save = { saved: true, stats: { ...poemFixture.stats!, saveCount: 6 } };
  state.unsave = { saved: false, stats: { ...poemFixture.stats!, saveCount: 4 } };
  state.createdComment = commentFixture();
  state.publish = { ...poemFixture, status: 'published' };
  state.unpublish = { ...poemFixture, status: 'draft' };
  state.postError = null;
  state.deleteError = null;

  apiMock.get.mockImplementation((url: string) => {
    if (url.startsWith('/mobile/poems/')) return Promise.resolve({ data: state.bff });
    if (url === '/poems/p1') return Promise.resolve({ data: state.poem });
    if (url === '/comments') {
      const page =
        state.commentPages.length > 1 ? state.commentPages.shift()! : state.commentPages[0];
      return Promise.resolve({ data: page });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  apiMock.post.mockImplementation((url: string, body?: unknown) => {
    if (state.postError) return Promise.reject(state.postError);
    if (url.endsWith('/reactions')) return Promise.resolve({ data: state.addReaction });
    if (url.endsWith('/felt-good')) return Promise.resolve({ data: state.feltPost });
    if (url.endsWith('/save')) return Promise.resolve({ data: state.save });
    if (url === '/comments') {
      const input = body as { content: string; parentCommentId?: string };
      return Promise.resolve({
        data: {
          ...(state.createdComment as Record<string, unknown>),
          id: 'cnew',
          content: input.content,
          parentCommentId: input.parentCommentId ?? null,
        },
      });
    }
    if (url.endsWith('/publish')) return Promise.resolve({ data: state.publish });
    return Promise.reject(new Error(`unexpected POST ${url}`));
  });
  apiMock.patch.mockImplementation((url: string) => {
    if (url.endsWith('/felt-good')) return Promise.resolve({ data: state.feltPatch });
    return Promise.reject(new Error(`unexpected PATCH ${url}`));
  });
  apiMock.delete.mockImplementation((url: string) => {
    if (state.deleteError) return Promise.reject(state.deleteError);
    if (url.includes('/reactions/')) return Promise.resolve({ data: state.removeReaction });
    if (url.endsWith('/save')) return Promise.resolve({ data: state.unsave });
    if (url.endsWith('/publish')) return Promise.resolve({ data: state.unpublish });
    if (url.startsWith('/comments/')) return Promise.resolve({ data: state.deleted });
    return Promise.reject(new Error(`unexpected DELETE ${url}`));
  });
});

describe('reader — engagement state from the BFF', () => {
  it('renders counts, felt-good summary, viewer reactions and save state', async () => {
    await render(<PoemReaderScreen />);

    expect(await screen.findByText('Loved 3')).toBeTruthy();
    expect(screen.getByText('Beautiful 2')).toBeTruthy();
    expect(screen.getByLabelText('Loved, selected')).toBeTruthy();
    expect(screen.getByText('Average 72 / 100 · 4 ratings')).toBeTruthy();
    expect(screen.getByText('Saved 5')).toBeTruthy();
  });

  it('hides the composer and disables chips for unauthenticated viewers', async () => {
    state.bff = bff({ viewer: null });
    await render(<PoemReaderScreen />);

    await screen.findByText('Loved 3');
    expect(screen.getByLabelText('Loved')).toBeTruthy();
    expect(screen.queryByTestId('comment-input')).toBeNull();
    expect(screen.queryByTestId('save-toggle')).toBeNull();
    expect(screen.queryByTestId('felt-good-slider')).toBeNull();
  });
});

describe('reaction picker — optimistic toggle with rollback', () => {
  it('flips the chip and count immediately, then keeps them after the server confirms', async () => {
    let resolvePost!: (value: unknown) => void;
    apiMock.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );

    await render(<PoemReaderScreen />);
    await screen.findByText('Loved 3');

    await fireEvent.press(screen.getByTestId('reaction-hurt'));

    // Optimistic: visible before the request settles.
    expect(screen.getByText('Hurt 1')).toBeTruthy();
    expect(apiMock.post).toHaveBeenCalledWith('/poems/p1/reactions', { type: 'hurt' });

    await act(async () => {
      resolvePost({ data: { reaction: { id: 'r2', type: 'hurt' }, stats: poemFixture.stats } });
    });
    expect(screen.getByText('Hurt 1')).toBeTruthy();
  });

  it('rolls back the optimistic flip and toasts when the server rejects', async () => {
    let rejectPost!: (err: unknown) => void;
    apiMock.post.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectPost = reject;
        }),
    );

    await render(<PoemReaderScreen />);
    await screen.findByText('Loved 3');

    await fireEvent.press(screen.getByTestId('reaction-hurt'));
    expect(screen.getByText('Hurt 1')).toBeTruthy();

    await act(async () => {
      rejectPost(new ApiError('You already reacted with this type', 409, 'ALREADY_REACTED'));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You already reacted with this type'));
    expect(screen.queryByText('Hurt 1')).toBeNull();
    expect(screen.getByText('Hurt')).toBeTruthy();
  });
});

describe('save toggle — optimistic with rollback', () => {
  it('shows the unsave optimistically, then rolls back when the request fails', async () => {
    await render(<PoemReaderScreen />);
    await screen.findByText('Saved 5');

    let rejectDelete!: (err: unknown) => void;
    apiMock.delete.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectDelete = reject;
        }),
    );

    await fireEvent.press(screen.getByTestId('save-toggle'));
    expect(apiMock.delete).toHaveBeenCalledWith('/poems/p1/save');
    expect(screen.getByText('Save 4')).toBeTruthy();

    await act(async () => {
      rejectDelete(new ApiError('Network error - check your connection', 0, 'NETWORK'));
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByText('Saved 5')).toBeTruthy();
  });
});

describe('Felt Good slider — first POST and debounced PATCH', () => {
  it('POSTs a first rating when the viewer has none yet', async () => {
    state.bff = bff({ viewer: { reactions: [], saved: false, feltGood: null } });

    await render(<PoemReaderScreen />);
    await screen.findByText('Average 72 / 100 · 4 ratings');

    await fireEvent.press(screen.getByTestId('felt-good-submit'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems/p1/felt-good', { score: 50 }),
    );
    expect(toast.success).toHaveBeenCalledWith('Rating saved');
    await waitFor(() => expect(screen.queryByTestId('felt-good-submit')).toBeNull());
  });

  it('coalesces rapid slider moves into one debounced PATCH', async () => {
    await render(
      <FeltGoodCard
        poemId="p1"
        summary={{ average: 72, count: 4 }}
        initialScore={65}
        interactive
        debounceMs={50}
      />,
    );

    // Keep the debounce timer and its flush inside a single act() so the
    // async setState settles before the test ends (avoids overlapping act scopes).
    await act(async () => {
      fireEvent(screen.getByTestId('felt-good-slider'), 'slidingComplete', 70);
      fireEvent(screen.getByTestId('felt-good-slider'), 'slidingComplete', 80);
      await new Promise((resolve) => setTimeout(resolve, 80));
    });

    expect(apiMock.patch).toHaveBeenCalledTimes(1);
    expect(apiMock.patch).toHaveBeenCalledWith('/poems/p1/felt-good', { score: 80 });
    expect(apiMock.post).not.toHaveBeenCalled();
  });
});

describe('comment thread — pagination, replies, delete', () => {
  it('renders embedded replies and appends the next page from the cursor', async () => {
    state.commentPages = [
      {
        items: [commentFixture({ replies: [commentFixture({ id: 'c2', content: 'same here' })], replyCount: 1 })],
        nextCursor: '2026-09-02T10:00:00.000Z',
      },
      { items: [commentFixture({ id: 'c3', content: 'page two' })], nextCursor: null },
    ];

    await render(<PoemReaderScreen />);
    expect(await screen.findByText('This stayed with me')).toBeTruthy();
    expect(screen.getByText('same here')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('comments-load-more'));
    expect(await screen.findByText('page two')).toBeTruthy();
    expect(screen.queryByTestId('comments-load-more')).toBeNull();
  });

  it('posts a top-level comment with trimmed content and prepends it', async () => {
    await render(<PoemReaderScreen />);
    await screen.findByText('Comments (2)');

    await fireEvent.changeText(screen.getByTestId('comment-input'), '  A quiet thank you  ');
    await fireEvent.press(screen.getByTestId('comment-submit'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/comments', {
        targetType: 'poem',
        targetId: 'p1',
        content: 'A quiet thank you',
      }),
    );
    expect(await screen.findByText('A quiet thank you')).toBeTruthy();
    expect((screen.getByTestId('comment-input').props as { value: string }).value).toBe('');
  });

  it('threads a reply under its parent with parentCommentId', async () => {
    state.commentPages = [{ items: [commentFixture()], nextCursor: null }];

    await render(<PoemReaderScreen />);
    await screen.findByText('This stayed with me');

    await fireEvent.press(screen.getByTestId('reply-c1'));
    expect(screen.getByText('Replying to Reader One')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'echoing');
    await fireEvent.press(screen.getByTestId('comment-submit'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/comments', {
        targetType: 'poem',
        targetId: 'p1',
        content: 'echoing',
        parentCommentId: 'c1',
      }),
    );
    expect(await screen.findByText('echoing')).toBeTruthy();
    // Posting the reply clears the reply banner (no Cancel needed afterwards).
    expect(screen.queryByText('Replying to Reader One')).toBeNull();
  });

  it('rejects an empty comment locally without calling the API', async () => {
    await render(<PoemReaderScreen />);
    await screen.findByText('Comments (2)');

    await fireEvent.press(screen.getByTestId('comment-submit'));

    expect(await screen.findByText('cannot be empty')).toBeTruthy();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('surfaces a server-side content error under the composer', async () => {
    state.postError = new ApiError('Validation failed', 400, 'VALIDATION_ERROR', [
      { field: 'content', message: 'must be at most 500 characters', code: 'too_big' },
    ]);

    await render(<PoemReaderScreen />);
    await screen.findByText('Comments (2)');

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'long thought');
    await fireEvent.press(screen.getByTestId('comment-submit'));

    expect(await screen.findByText('must be at most 500 characters')).toBeTruthy();
  });

  it('lets the author delete their own comment', async () => {
    state.commentPages = [
      { items: [commentFixture({ authorId: 'u1' })], nextCursor: null },
    ];

    await render(<PoemReaderScreen />);
    await screen.findByText('This stayed with me');

    await fireEvent.press(screen.getByTestId('delete-comment-c1'));

    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith('/comments/c1'));
    await waitFor(() => expect(screen.queryByText('This stayed with me')).toBeNull());
  });
});

describe('poem publish lifecycle (deferred from Phase 2)', () => {
  it('publishes a draft, flips the badge, and offers unpublish', async () => {
    state.poem = { ...poemFixture, status: 'draft', visibility: 'private_draft', authorId: 'u1' };

    await render(<EditPoemScreen />);
    expect(await screen.findByTestId('draft-badge')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poem-publish'));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/poems/p1/publish'));
    expect(toast.success).toHaveBeenCalledWith('Poem published');
    expect(await screen.findByTestId('published-badge')).toBeTruthy();
    expect(screen.getByTestId('poem-unpublish')).toBeTruthy();
  });

  it('moves a published poem back to draft', async () => {
    state.poem = { ...poemFixture, status: 'published', authorId: 'u1' };

    await render(<EditPoemScreen />);
    expect(await screen.findByTestId('published-badge')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('poem-unpublish'));

    await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith('/poems/p1/publish'));
    expect(toast.success).toHaveBeenCalledWith('Poem moved back to draft');
    expect(await screen.findByTestId('draft-badge')).toBeTruthy();
  });

  it('toasts the validation detail when the server refuses to publish', async () => {
    state.poem = { ...poemFixture, status: 'draft', authorId: 'u1' };
    state.postError = new ApiError('Poem cannot be published', 400, 'VALIDATION_ERROR', [
      { field: 'content', message: 'content cannot be empty', code: 'custom' },
    ]);

    await render(<EditPoemScreen />);
    await fireEvent.press(await screen.findByTestId('poem-publish'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('content cannot be empty'));
    expect(screen.getByTestId('draft-badge')).toBeTruthy();
  });
});
