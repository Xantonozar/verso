import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import PoemReaderScreen from '../app/(app)/poem/[id]';
import { ApiError, default as api } from '../lib/api/client';
import { Poem } from '../lib/api/poems';
import { REPORT_REASON_OPTIONS } from '../lib/api/moderation';
import { toast } from '../lib/toast';
import { CONNECTIVITY_TOAST } from '../lib/validation';

/**
 * Phase 14 (plan step 90): report button + reason picker on the poem reader.
 * Report-filed UX: pick a reason, POST /reports, toast + close; failures keep
 * the sheet open. Owners never see the button (you can't report yourself).
 */

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

// The reader's comment thread must not pollute api.post call assertions here.
jest.mock('../lib/api/engagement', () => {
  const actual = jest.requireActual('../lib/api/engagement');
  return {
    __esModule: true,
    ...actual,
    listComments: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
  };
});

jest.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u1', username: 'reader', displayName: 'Reader Name' },
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
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
    initialWindowMetrics: null,
  };
});

const apiMock = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const basePoem: Poem = {
  id: 'p1',
  authorId: 'u99',
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
  stats: { reads: 0, reactionCount: 0, commentCount: 0, saveCount: 0, shareCount: 0 },
  audioUrl: '',
  videoUrl: '',
  publishedAt: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-01T10:00:00.000Z',
  author: { id: 'u99', username: 'poet', displayName: 'Poet Name' },
};

function bffFixture(poem: Poem) {
  return {
    poem,
    reactionCounts: {},
    feltGood: { average: null, count: 0 },
    viewer: null,
  };
}

const reportCalls = () =>
  apiMock.post.mock.calls.filter(([url]) => url === '/reports') as [
    string,
    Record<string, unknown>,
  ][];

beforeEach(() => {
  jest.clearAllMocks();
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
  apiMock.put.mockReset();
  apiMock.delete.mockReset();
});

describe('poem reader — report flow (Phase 14 step 90)', () => {
  it('hides the report button on your own poem', async () => {
    apiMock.get.mockResolvedValue({
      data: bffFixture({ ...basePoem, authorId: 'u1' }),
    });

    await render(<PoemReaderScreen />);
    await screen.findByText('First light');

    expect(screen.queryByTestId('report-poem')).toBeNull();
  });

  it('opens the reason picker, submits the chosen reason, and confirms with a toast', async () => {
    apiMock.get.mockResolvedValue({ data: bffFixture(basePoem) });
    apiMock.post.mockResolvedValue({
      data: {
        id: 'r1',
        targetType: 'poem',
        targetId: 'p1',
        reason: 'harassment',
        details: '',
        status: 'pending',
        createdAt: '2026-09-29T10:00:00.000Z',
      },
    });

    await render(<PoemReaderScreen />);
    await screen.findByText('First light');

    expect(screen.queryByTestId('report-submit')).toBeNull();
    await fireEvent.press(screen.getByTestId('report-poem'));

    // Every server-side reason is offered.
    for (const option of REPORT_REASON_OPTIONS) {
      expect(await screen.findByTestId(`report-reason-${option.value}`)).toBeTruthy();
    }

    // Submitting without a reason does nothing.
    await fireEvent.press(screen.getByTestId('report-submit'));
    expect(reportCalls()).toHaveLength(0);

    await fireEvent.press(screen.getByTestId('report-reason-harassment'));
    await fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() =>
      expect(reportCalls()).toEqual([
        [
          '/reports',
          { targetType: 'poem', targetId: 'p1', reason: 'harassment' },
        ],
      ]),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('Report submitted. Thanks for looking out.'),
    );
    await waitFor(() => expect(screen.queryByTestId('report-submit')).toBeNull());
  });

  it('keeps the sheet open with an error toast when the report fails', async () => {
    apiMock.get.mockResolvedValue({ data: bffFixture(basePoem) });
    apiMock.post.mockImplementation((url: string) =>
      url === '/reports'
        ? Promise.reject(new ApiError('Server error', 500, 'INTERNAL'))
        : Promise.resolve(undefined),
    );

    await render(<PoemReaderScreen />);
    await screen.findByText('First light');

    await fireEvent.press(screen.getByTestId('report-poem'));
    await fireEvent.press(screen.getByTestId('report-reason-spam'));
    await fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Couldn't submit the report. Try again."),
    );
    expect(reportCalls()).toHaveLength(1);
    expect(screen.getByTestId('report-submit')).toBeTruthy();
  });

  it('toasts the connectivity message and keeps the sheet open offline', async () => {
    apiMock.get.mockResolvedValue({ data: bffFixture(basePoem) });
    apiMock.post.mockImplementation((url: string) =>
      url === '/reports'
        ? Promise.reject(new ApiError('Network error - check your connection', 0, 'NETWORK'))
        : Promise.resolve(undefined),
    );

    await render(<PoemReaderScreen />);
    await screen.findByText('First light');

    await fireEvent.press(screen.getByTestId('report-poem'));
    await fireEvent.press(screen.getByTestId('report-reason-other'));
    await fireEvent.press(screen.getByTestId('report-submit'));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(CONNECTIVITY_TOAST));
    expect(screen.getByTestId('report-submit')).toBeTruthy();
  });

  it('cancel closes the sheet without posting', async () => {
    apiMock.get.mockResolvedValue({ data: bffFixture(basePoem) });
    apiMock.post.mockResolvedValue(undefined);

    await render(<PoemReaderScreen />);
    await screen.findByText('First light');

    await fireEvent.press(screen.getByTestId('report-poem'));
    expect(screen.getByText('Report this poem')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('report-cancel'));

    await waitFor(() => expect(screen.queryByTestId('report-submit')).toBeNull());
    expect(reportCalls()).toHaveLength(0);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('closes the sheet and toasts when this poem was already reported', async () => {
    apiMock.get.mockResolvedValue({ data: bffFixture(basePoem) });
    apiMock.post.mockImplementation((url: string) =>
      url === '/reports'
        ? Promise.reject(
            new ApiError('You already reported this poem', 409, 'DUPLICATE_REPORT'),
          )
        : Promise.resolve(undefined),
    );

    await render(<PoemReaderScreen />);
    await screen.findByText('First light');

    await fireEvent.press(screen.getByTestId('report-poem'));
    await fireEvent.press(screen.getByTestId('report-reason-spam'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('report-submit'));
    });

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('You already reported this poem.'));
    expect(screen.queryByTestId('report-submit')).toBeNull();
  });
});
