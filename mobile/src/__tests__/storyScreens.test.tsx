import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ChapterEditor } from '../components/ChapterEditor';
import { StoryEditor } from '../components/StoryEditor';
import NewStoryScreen from '../app/(app)/story/new';
import EditStoryScreen from '../app/(app)/story/[id]/edit';
import StoryChapterReaderScreen from '../app/(app)/story/[id]/chapter/[chapterId]';
import EditChapterScreen from '../app/(app)/story/[id]/chapter/[chapterId]/edit';
import ProfileScreen from '../app/(app)/profile';
import { ApiError, default as api } from '../lib/api/client';
import { Story, StoryChapter } from '../lib/api/stories';
import { toast } from '../lib/toast';

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: () => ({ id: 's1', chapterId: 'c1' }),
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

jest.mock('../context/AuthContext', () => {
  // One stable object — a fresh useAuth() result per render would retrigger
  // profile's [updateUser]-depended effect in an infinite loop.
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

const storyFixture: Story = {
  id: 's1',
  authorId: 'u1',
  title: 'The Lighthouse',
  coverUrl: '',
  synopsis: 'A keeper, a storm, and a light that must not fail.',
  language: 'en',
  tags: ['sea'],
  status: 'draft',
  chapterCount: 2,
  currentVersionId: 'v1',
  draftSavedAt: null,
  stats: { reads: 0 },
  publishedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  author: { id: 'u1', username: 'author', displayName: 'Author Name' },
};

const chapterFixture: StoryChapter = {
  id: 'c1',
  storyId: 's1',
  chapterNumber: 1,
  title: 'The Storm',
  content: 'Rain against the glass',
  wordCount: 4,
  currentVersionId: 'cv1',
  draftSavedAt: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const chapterSummaries = {
  items: [
    { id: 'c1', chapterNumber: 1, title: 'The Storm', wordCount: 4, updatedAt: '2026-09-01T10:00:00.000Z' },
    { id: 'c2', chapterNumber: 2, title: 'The Light', wordCount: 3, updatedAt: '2026-09-01T10:00:00.000Z' },
  ],
  nextCursor: null,
};

function mockStoryReads(overrides: Partial<Record<string, unknown>> = {}) {
  apiMock.get.mockImplementation((url: string) => {
    if (url === '/stories/s1') {
      return Promise.resolve({ data: (overrides.story as Story) ?? storyFixture });
    }
    if (url === '/stories/s1/chapters/c1') {
      return Promise.resolve({ data: chapterFixture });
    }
    if (url === '/stories/s1/chapters') {
      return Promise.resolve({ data: chapterSummaries });
    }
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
      return Promise.resolve({
        data: {
          items: [
            {
              id: 's1',
              title: 'The Lighthouse',
              coverUrl: '',
              synopsis: '',
              tags: [],
              status: 'draft',
              chapterCount: 2,
              publishedAt: null,
              createdAt: '2026-09-01T10:00:00.000Z',
              updatedAt: '2026-09-01T10:00:00.000Z',
            },
          ],
          nextCursor: null,
        },
      });
    }
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
  storageMock.__store.clear();
  mockStoryReads();
});

describe('new story screen — create flow', () => {
  it('shows a field error for an empty submission without calling the API', async () => {
    await render(<NewStoryScreen />);
    await fireEvent.press(screen.getByTestId('story-save'));

    expect(await screen.findByText('is required')).toBeTruthy();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('creates the draft and hands off to the edit screen', async () => {
    apiMock.post.mockResolvedValue({ data: storyFixture });
    await render(<NewStoryScreen />);
    await fireEvent.changeText(screen.getByTestId('story-title'), 'The Lighthouse');
    await fireEvent.changeText(screen.getByTestId('story-synopsis'), 'A keeper and a storm.');
    await fireEvent.press(screen.getByTestId('story-save'));

    expect(apiMock.post).toHaveBeenCalledWith('/stories', {
      title: 'The Lighthouse',
      synopsis: 'A keeper and a storm.',
      coverUrl: '',
      tags: [],
    });
    expect(toast.success).toHaveBeenCalledWith('Draft saved');
    expect(router.replace).toHaveBeenCalledWith('/story/s1/edit');
  });

  it('rejects too many tags before touching the API', async () => {
    await render(<NewStoryScreen />);
    await fireEvent.changeText(screen.getByTestId('story-title'), 'Tagged');
    await fireEvent.changeText(
      screen.getByTestId('story-tags'),
      'a, b, c, d, e, f, g, h, i, j, k',
    );
    await fireEvent.press(screen.getByTestId('story-save'));

    expect(await screen.findByText('at most 10 tags')).toBeTruthy();
    expect(apiMock.post).not.toHaveBeenCalled();
  });

  it('offers recovery when the device holds an unsaved story draft', async () => {
    storageMock.__store.set(
      'verso.draft.story.new',
      JSON.stringify({ title: 'Recovered title', synopsis: 'Recovered synopsis', savedAt: 123 }),
    );

    await render(<NewStoryScreen />);
    expect(await screen.findByTestId('draft-recovery')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('recover-draft'));
    expect(screen.getByDisplayValue('Recovered title')).toBeTruthy();
    expect(screen.getByDisplayValue('Recovered synopsis')).toBeTruthy();
    expect(screen.queryByTestId('draft-recovery')).toBeNull();
  });
});

describe('story editor — autosave and explicit save', () => {
  async function renderEditor() {
    const onSaved = jest.fn();
    await render(
      <StoryEditor story={storyFixture} onCreated={jest.fn()} onSaved={onSaved} autosaveDebounceMs={50} />,
    );
    return { onSaved };
  }

  it('autosaves metadata after the debounce and shows Saved', async () => {
    apiMock.put.mockResolvedValue({
      data: {
        id: 's1',
        changed: true,
        title: 'The Lighthouse',
        coverUrl: '',
        synopsis: 'Edited synopsis',
        savedAt: '2026-09-02T10:00:00.000Z',
      },
    });
    await renderEditor();

    await fireEvent.changeText(screen.getByTestId('story-synopsis'), 'Edited synopsis');

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(apiMock.put).toHaveBeenCalledWith('/stories/s1/draft', {
      synopsis: 'Edited synopsis',
      title: 'The Lighthouse',
    });
  });

  it('flags failure when autosave is rejected as NOT_A_DRAFT', async () => {
    apiMock.put.mockRejectedValue(new ApiError('Autosave is only available for unpublished stories', 409, 'NOT_A_DRAFT'));
    await renderEditor();

    await fireEvent.changeText(screen.getByTestId('story-synopsis'), 'Edited synopsis');

    expect(await screen.findByText('Autosave failed')).toBeTruthy();
    expect(toast.error).toHaveBeenCalledWith('Autosave only works on unpublished stories.');
  });

  it('explicit save PATCHes, clears the local draft, and toasts', async () => {
    apiMock.patch.mockResolvedValue({ data: { ...storyFixture, title: 'Renamed' } });
    const { onSaved } = await renderEditor();

    await fireEvent.changeText(screen.getByTestId('story-title'), 'Renamed');
    await fireEvent.press(screen.getByTestId('story-save'));

    expect(apiMock.patch).toHaveBeenCalledWith('/stories/s1', {
      title: 'Renamed',
      synopsis: storyFixture.synopsis,
      coverUrl: '',
      tags: ['sea'],
    });
    expect(toast.success).toHaveBeenCalledWith('Saved');
    expect(onSaved).toHaveBeenCalled();
    expect(storageMock.default.removeItem).toHaveBeenCalledWith('verso.draft.story.s1');
  });
});

describe('edit story screen — load, chapters, reorder, publish', () => {
  it('shows a loading state, then the story with its chapters and Draft badge', async () => {
    const resolvers: Record<string, (value: { data: unknown }) => void> = {};
    apiMock.get.mockImplementation(
      (url: string) =>
        new Promise((resolve) => {
          resolvers[url] = resolve as (value: { data: unknown }) => void;
        }),
    );

    await render(<EditStoryScreen />);
    expect(screen.getByLabelText('Loading story...')).toBeTruthy();

    await act(async () => {
      resolvers['/stories/s1']?.({ data: storyFixture });
      resolvers['/stories/s1/chapters']?.({ data: chapterSummaries });
    });

    expect(await screen.findByTestId('status-badge')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByTestId('chapter-row-0')).toBeTruthy();
    expect(screen.getByTestId('chapter-row-1')).toBeTruthy();
    expect(screen.getByText('2 total')).toBeTruthy();
  });

  it('reorders optimistically via the reorder endpoint', async () => {
    await render(<EditStoryScreen />);
    expect(await screen.findByTestId('chapter-row-1')).toBeTruthy();

    apiMock.post.mockResolvedValue({
      data: {
        items: [chapterSummaries.items[1], chapterSummaries.items[0]],
        nextCursor: null,
      },
    });

    await fireEvent.press(screen.getByTestId('chapter-down-0'));

    expect(apiMock.post).toHaveBeenCalledWith('/stories/s1/chapters/reorder', {
      chapterIds: ['c2', 'c1'],
    });
  });

  it('publishes a story and flips the badge to Published', async () => {
    apiMock.post.mockResolvedValue({ data: { ...storyFixture, status: 'published' } });
    await render(<EditStoryScreen />);
    expect(await screen.findByTestId('publish-story')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('publish-story'));

    expect(apiMock.post).toHaveBeenCalledWith('/stories/s1/publish', {});
    expect(await screen.findByText('Published')).toBeTruthy();
    expect(await screen.findByTestId('unpublish-story')).toBeTruthy();
  });

  it('surfaces server publish validation as a toast', async () => {
    apiMock.post.mockRejectedValue(
      new ApiError('Story cannot be published', 400, 'VALIDATION_ERROR', [
        { field: 'chapters', message: 'must have at least one chapter', code: 'custom' },
      ]),
    );
    await render(<EditStoryScreen />);
    expect(await screen.findByTestId('publish-story')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('publish-story'));
    await act(async () => undefined);

    expect(toast.error).toHaveBeenCalledWith("Can't publish: must have at least one chapter");
    expect(screen.queryByTestId('status-badge')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
  });

  it('creates a chapter and routes to its editor', async () => {
    apiMock.post.mockResolvedValue({
      data: { ...chapterFixture, id: 'c3', chapterNumber: 3, title: '' },
    });
    await render(<EditStoryScreen />);
    expect(await screen.findByTestId('new-chapter')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('new-chapter'));

    expect(apiMock.post).toHaveBeenCalledWith('/stories/s1/chapters', { title: '' });
    expect(router.push).toHaveBeenCalledWith('/story/s1/chapter/c3/edit');
  });

  it('renders an empty state when the story has no chapters', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/stories/s1/chapters') return Promise.resolve({ data: { items: [], nextCursor: null } });
      return Promise.resolve({ data: storyFixture });
    });

    await render(<EditStoryScreen />);
    expect(await screen.findByTestId('empty-chapters')).toBeTruthy();
    expect(screen.queryByTestId('chapter-row-0')).toBeNull();
  });
});

describe('story reader — navigation and unavailable state', () => {
  it('renders progress, content, and next navigation', async () => {
    await render(<StoryChapterReaderScreen />);

    expect(await screen.findByTestId('reader-progress')).toBeTruthy();
    expect(screen.getByText('Chapter 1 of 2')).toBeTruthy();
    expect(screen.getByTestId('chapter-content')).toBeTruthy();
    expect(screen.getByText('Rain against the glass')).toBeTruthy();
    expect(screen.getByTestId('nav-prev')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('nav-next'));
    expect(router.replace).toHaveBeenCalledWith('/story/s1/chapter/c2');
  });

  it('persists the reading position for resume', async () => {
    await render(<StoryChapterReaderScreen />);
    expect(await screen.findByTestId('reader-progress')).toBeTruthy();

    expect(storageMock.default.setItem).toHaveBeenCalledWith('verso.story.progress.s1', 'c1');
  });

  it('shows the unavailable state when the chapter cannot be fetched', async () => {
    apiMock.get.mockImplementation((url: string) => {
      if (url === '/stories/s1/chapters/c1') {
        return Promise.reject(new ApiError('Chapter not found', 404, 'STORY_CHAPTER_NOT_FOUND'));
      }
      if (url === '/stories/s1') return Promise.resolve({ data: storyFixture });
      return Promise.resolve({ data: chapterSummaries });
    });

    await render(<StoryChapterReaderScreen />);
    expect(await screen.findByText("This chapter isn't available right now.")).toBeTruthy();
  });
});

describe('chapter editor — autosave, preview, leave guard', () => {
  async function renderChapterEditor() {
    const onSaved = jest.fn();
    await render(
      <ChapterEditor
        storyId="s1"
        chapter={chapterFixture}
        onSaved={onSaved}
        autosaveDebounceMs={50}
      />,
    );
    return { onSaved };
  }

  it('autosaves chapter text after the debounce', async () => {
    apiMock.put.mockResolvedValue({
      data: {
        id: 'c1',
        changed: true,
        title: 'The Storm',
        content: 'Rain against the glass, harder now',
        savedAt: '2026-09-02T10:00:00.000Z',
      },
    });
    await renderChapterEditor();

    await fireEvent.changeText(
      screen.getByTestId('chapter-content-input'),
      'Rain against the glass, harder now',
    );

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(apiMock.put).toHaveBeenCalledWith('/stories/s1/chapters/c1/draft', {
      title: 'The Storm',
      content: 'Rain against the glass, harder now',
    });
  });

  it('never calls autosave when nothing changed', async () => {
    await renderChapterEditor();

    await fireEvent.changeText(screen.getByTestId('chapter-title-input'), 'The Storm');

    expect(await screen.findByText('Saved')).toBeTruthy();
    expect(apiMock.put).not.toHaveBeenCalled();
  });

  it('explicit save PATCHes the chapter and clears the local draft', async () => {
    apiMock.patch.mockResolvedValue({ data: { ...chapterFixture, title: 'Renamed' } });
    const { onSaved } = await renderChapterEditor();

    await fireEvent.changeText(screen.getByTestId('chapter-title-input'), 'Renamed');
    await fireEvent.press(screen.getByTestId('chapter-save'));

    expect(apiMock.patch).toHaveBeenCalledWith('/stories/s1/chapters/c1', {
      title: 'Renamed',
      content: 'Rain against the glass',
    });
    expect(toast.success).toHaveBeenCalledWith('Chapter saved');
    expect(onSaved).toHaveBeenCalled();
    expect(storageMock.default.removeItem).toHaveBeenCalledWith('verso.draft.storyChapter.s1.c1');
  });

  it('toggles into preview and back', async () => {
    await renderChapterEditor();

    await fireEvent.press(screen.getByTestId('preview-on'));
    expect(screen.getByTestId('preview-banner')).toBeTruthy();
    expect(screen.getByTestId('preview-body')).toBeTruthy();
    expect(screen.queryByTestId('chapter-content-input')).toBeNull();

    await fireEvent.press(screen.getByTestId('preview-off'));
    expect(screen.getByTestId('chapter-content-input')).toBeTruthy();
  });

  it('offers recovery when the device holds an unsaved chapter draft', async () => {
    storageMock.__store.set(
      'verso.draft.storyChapter.s1.c1',
      JSON.stringify({ title: 'Recovered chapter', content: 'Recovered words', savedAt: 123 }),
    );
    await renderChapterEditor();

    expect(await screen.findByTestId('draft-recovery')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('recover-draft'));
    expect(screen.getByDisplayValue('Recovered chapter')).toBeTruthy();
    expect(screen.getByDisplayValue('Recovered words')).toBeTruthy();
  });

  it('guards against leaving with unsaved changes', async () => {
    await render(<EditChapterScreen />);
    expect(await screen.findByTestId('chapter-content-input')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('chapter-content-input'), 'A new sentence');
    await fireEvent.press(screen.getByTestId('editor-back'));

    expect(await screen.findByTestId('leave-confirm')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('keep-editing'));
    expect(screen.getByTestId('chapter-content-input')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('editor-back'));
    expect(await screen.findByTestId('leave-confirm')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('leave-editor'));
    expect(router.back).toHaveBeenCalled();
  });
});

describe('profile — stories section', () => {
  it('lists the signed-in author stories and offers + New story', async () => {
    await render(<ProfileScreen />);

    expect(await screen.findByTestId('new-story')).toBeTruthy();
    const row = await screen.findByText('The Lighthouse · 2 ch · Draft');
    expect(row).toBeTruthy();

    await fireEvent.press(row);
    expect(router.push).toHaveBeenCalledWith('/story/s1/edit');
  });

  it('routes + New story to the new-story screen', async () => {
    await render(<ProfileScreen />);
    expect(await screen.findByTestId('new-story')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('new-story'));
    expect(router.push).toHaveBeenCalledWith('/story/new');
  });
});
