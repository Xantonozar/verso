import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { PoemEditor } from '../components/PoemEditor';
import NewPoemScreen from '../app/(app)/poem/new';
import EditPoemScreen from '../app/(app)/poem/[id]/edit';
import PoemReaderScreen from '../app/(app)/poem/[id]';
import { ApiError, default as api } from '../lib/api/client';
import { Poem } from '../lib/api/poems';
import { toast } from '../lib/toast';
import { CONNECTIVITY_TOAST } from '../lib/validation';

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

const { router } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
};
const apiMock = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const storageMock = jest.requireMock('@react-native-async-storage/async-storage') as {
  __store: Map<string, string>;
  default: { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock };
};

const poemFixture: Poem = {
  id: 'p1',
  authorId: 'u1',
  title: 'First light',
  content: 'Dawn spills\nover the hill.',
  authorNote: '',
  language: 'en',
  moods: [],
  tags: [],
  visibility: 'private_draft',
  anonymous: false,
  status: 'draft',
  currentVersionId: 'v1',
  draftSavedAt: null,
  stats: { reads: 0, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 },
  audioUrl: '',
  videoUrl: '',
  publishedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  author: { id: 'u1', username: 'author', displayName: 'Author Name' },
};

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
  storageMock.__store.clear();
});

describe('new poem screen — create flow', () => {
  it('shows field errors for an empty submission without calling the API', async () => {
    await render(<NewPoemScreen />);
    await fireEvent.press(screen.getByTestId('poem-save'));

    const requiredMessages = await screen.findAllByText('is required');
    expect(requiredMessages).toHaveLength(2);
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('counts words and lines as the draft is typed', async () => {
    await render(<NewPoemScreen />);
    await fireEvent.changeText(screen.getByTestId('poem-content'), 'Dawn spills\nover the hill.');

    expect(screen.getByText('5 words · 2 lines')).toBeTruthy();
    expect(apiMock.put).not.toHaveBeenCalled();
  });

  it('creates the draft and hands off to the edit screen', async () => {
    apiMock.post.mockResolvedValue({ data: poemFixture });
    await render(<NewPoemScreen />);
    await fireEvent.changeText(screen.getByTestId('poem-title'), 'First light');
    await fireEvent.changeText(screen.getByTestId('poem-content'), 'Dawn spills\nover the hill.');
    await fireEvent.press(screen.getByTestId('poem-save'));

    expect(apiMock.post).toHaveBeenCalledWith('/poems', {
      title: 'First light',
      content: 'Dawn spills\nover the hill.',
    });
    expect(toast.success).toHaveBeenCalledWith('Draft saved');
    expect(router.replace).toHaveBeenCalledWith('/poem/p1/edit');
  });

  it('toasts on network failure and stays on the screen', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError('Network error - check your connection', 0, 'NETWORK'),
    );
    await render(<NewPoemScreen />);
    await fireEvent.changeText(screen.getByTestId('poem-title'), 'First light');
    await fireEvent.changeText(screen.getByTestId('poem-content'), 'A line');
    await fireEvent.press(screen.getByTestId('poem-save'));

    await act(async () => undefined);
    expect(toast.error).toHaveBeenCalledWith(CONNECTIVITY_TOAST);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('edit poem screen — load, recovery, save', () => {
  it('shows a loading state, then the fetched poem with a draft badge', async () => {
    let resolveGet!: (value: unknown) => void;
    apiMock.get.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    await render(<EditPoemScreen />);
    expect(screen.getByLabelText('Loading poem...')).toBeTruthy();

    await act(async () => {
      resolveGet({ data: poemFixture });
    });

    expect(await screen.findByDisplayValue('First light')).toBeTruthy();
    expect(screen.getByTestId('draft-badge')).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledWith('/poems/p1');
  });

  it('offers recovery when the device holds a newer draft, and applies it', async () => {
    apiMock.get.mockResolvedValue({ data: poemFixture });
    storageMock.__store.set(
      'verso.draft.poem.p1',
      JSON.stringify({ title: 'Recovered title', content: 'Recovered lines', savedAt: 123 }),
    );

    await render(<EditPoemScreen />);
    expect(await screen.findByTestId('draft-recovery')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('recover-draft'));
    expect(screen.getByDisplayValue('Recovered title')).toBeTruthy();
    expect(screen.getByDisplayValue('Recovered lines')).toBeTruthy();
    expect(screen.queryByTestId('draft-recovery')).toBeNull();
  });

  it('discards the local draft without touching the fields', async () => {
    apiMock.get.mockResolvedValue({ data: poemFixture });
    storageMock.__store.set(
      'verso.draft.poem.p1',
      JSON.stringify({ title: 'Recovered title', content: 'Recovered lines', savedAt: 123 }),
    );

    await render(<EditPoemScreen />);
    expect(await screen.findByTestId('draft-recovery')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('discard-draft'));
    expect(screen.queryByTestId('draft-recovery')).toBeNull();
    expect(screen.getByDisplayValue('First light')).toBeTruthy();
    expect(storageMock.default.removeItem).toHaveBeenCalledWith('verso.draft.poem.p1');
  });

  it('retries after a failed load', async () => {
    apiMock.get
      .mockRejectedValueOnce(new ApiError('Network error - check your connection', 0, 'NETWORK'))
      .mockResolvedValueOnce({ data: poemFixture });

    await render(<EditPoemScreen />);
    expect(await screen.findByText("Couldn't load this poem.")).toBeTruthy();

    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByDisplayValue('First light')).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });
});

describe('poem editor — autosave and explicit save', () => {
  async function renderEditor() {
    const onCreated = jest.fn();
    const onSaved = jest.fn();
    await render(
      <PoemEditor
        poem={poemFixture}
        onCreated={onCreated}
        onSaved={onSaved}
        autosaveDebounceMs={50}
      />,
    );
    return { onCreated, onSaved };
  }

  it('autosaves after the debounce and shows Saved', async () => {
    apiMock.put.mockResolvedValue({
      data: {
        id: 'p1',
        changed: true,
        title: 'New title',
        content: poemFixture.content,
        savedAt: '2026-09-02T10:00:00.000Z',
      },
    });
    await renderEditor();

    await fireEvent.changeText(screen.getByTestId('poem-title'), 'New title');

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(apiMock.put).toHaveBeenCalledWith('/poems/p1/draft', {
      title: 'New title',
      content: poemFixture.content,
    });
  });

  it('never calls autosave when nothing changed', async () => {
    await renderEditor();

    await fireEvent.changeText(screen.getByTestId('poem-title'), 'First light');

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(apiMock.put).not.toHaveBeenCalled();
  });

  it('flags failure and toasts when autosave is rejected', async () => {
    apiMock.put.mockRejectedValue(new ApiError('Network error - check your connection', 0, 'NETWORK'));
    await renderEditor();

    await fireEvent.changeText(screen.getByTestId('poem-content'), 'A new line');

    expect(await screen.findByText('Autosave failed')).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith(CONNECTIVITY_TOAST);
  });

  it('explicit save PATCHes, clears the local draft, and toasts', async () => {
    apiMock.patch.mockResolvedValue({ data: { ...poemFixture, title: 'New title' } });
    const { onSaved } = await renderEditor();

    await fireEvent.changeText(screen.getByTestId('poem-title'), 'New title');
    await fireEvent.press(screen.getByTestId('poem-save'));

    expect(apiMock.patch).toHaveBeenCalledWith('/poems/p1', {
      title: 'New title',
      content: poemFixture.content,
    });
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(onSaved).toHaveBeenCalled();
    expect(storageMock.default.removeItem).toHaveBeenCalledWith('verso.draft.poem.p1');
    expect(apiMock.put).not.toHaveBeenCalled();
  });

  it('maps a server-side validation error onto the fields', async () => {
    apiMock.patch.mockRejectedValue(
      new ApiError('Request validation failed', 400, 'VALIDATION_ERROR', [
        { field: 'content', message: 'must be at most 100000 characters', code: 'too_big' },
      ]),
    );
    await renderEditor();

    await fireEvent.changeText(screen.getByTestId('poem-content'), 'overflow');
    await fireEvent.press(screen.getByTestId('poem-save'));

    expect(await screen.findByText('must be at most 100000 characters')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('poem reader — states', () => {
  it('shows a skeleton while loading, then the poem', async () => {
    let resolveGet!: (value: unknown) => void;
    apiMock.get.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }),
    );

    await render(<PoemReaderScreen />);
    expect(screen.getByTestId('poem-skeleton')).toBeTruthy();

    await act(async () => {
      resolveGet({ data: poemFixture });
    });

    expect(await screen.findByText('First light')).toBeTruthy();
    expect(screen.getByText('Dawn spills\nover the hill.')).toBeTruthy();
    expect(screen.getByText('Author Name · @author')).toBeTruthy();
    expect(screen.queryByTestId('poem-skeleton')).toBeNull();
  });

  it('renders a clear empty state for a poem that no longer exists', async () => {
    apiMock.get.mockRejectedValue(new ApiError('Poem not found', 404, 'POEM_NOT_FOUND'));

    await render(<PoemReaderScreen />);
    expect(await screen.findByText('This poem is no longer available.')).toBeTruthy();
    expect(screen.queryByText('Try again')).toBeNull();
  });

  it('offers retry on network failure and recovers', async () => {
    apiMock.get
      .mockRejectedValueOnce(new ApiError('Network error - check your connection', 0, 'NETWORK'))
      .mockResolvedValueOnce({ data: poemFixture });

    await render(<PoemReaderScreen />);
    expect(await screen.findByText("Couldn't load this poem.")).toBeTruthy();

    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('First light')).toBeTruthy();
    expect(apiMock.get).toHaveBeenCalledTimes(2);
  });

  it('shows the edit button for the owner of a draft', async () => {
    apiMock.get.mockResolvedValue({ data: poemFixture });

    await render(<PoemReaderScreen />);
    expect(await screen.findByTestId('edit-poem')).toBeTruthy();
    expect(screen.getByTestId('draft-badge')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('edit-poem'));
    expect(router.push).toHaveBeenCalledWith('/poem/p1/edit');
  });

  it('hides author identity for anonymous poems', async () => {
    apiMock.get.mockResolvedValue({
      data: { ...poemFixture, anonymous: true, author: null, authorId: undefined },
    });

    await render(<PoemReaderScreen />);
    expect(await screen.findByText('Anonymous')).toBeTruthy();
    expect(screen.queryByTestId('edit-poem')).toBeNull();
  });
});
