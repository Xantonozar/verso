import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import NewDiaryScreen from '../app/(app)/diary/new';
import ProfileScreen from '../app/(app)/profile';
import { ApiError, default as api } from '../lib/api/client';
import { createDiary } from '../lib/api/diary';
import { toast } from '../lib/toast';
import { CONNECTIVITY_TOAST } from '../lib/validation';

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

jest.mock('../lib/api/diary', () => ({
  createDiary: jest.fn(),
  getDiary: jest.fn(),
}));

// One stable object — a fresh useAuth() result per render would retrigger
// profile's [updateUser]-depended effect in an infinite loop.
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
const apiMock = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};
const createDiaryMock = createDiary as unknown as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
});

async function renderComposer() {
  await render(<NewDiaryScreen />);
}

async function submitLine(text: string) {
  await renderComposer();
  // flush the controlled-input state update before the submit press — otherwise
  // post() runs against the pre-typing closure (empty content)
  await act(async () => {
    fireEvent.changeText(screen.getByTestId('diary-content'), text);
  });
  await act(async () => {
    await fireEvent.press(screen.getByTestId('diary-post'));
  });
}

describe('diary composer — distinct one-liner framing (plan step 52)', () => {
  it('shows the heading, one-line framing and a 0/280 counter (not the poem editor)', async () => {
    await renderComposer();

    expect(screen.getByText('New diary')).toBeTruthy();
    expect(screen.getByTestId('diary-subtitle')).toHaveTextContent('One line for today.');
    expect(screen.getByTestId('diary-counter')).toHaveTextContent('0/280');
    expect(screen.getByTestId('diary-visibility-public')).toBeTruthy();
    expect(screen.getByTestId('diary-visibility-followers')).toBeTruthy();
    // no poem-only affordances: title field and moods/tags never render
    expect(screen.queryByTestId('poem-title')).toBeNull();
  });

  it('empty submit → field error, createDiary never called', async () => {
    await renderComposer();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('diary-post'));
    });

    expect(screen.getByTestId('diary-content-error')).toHaveTextContent('is required');
    expect(createDiaryMock).not.toHaveBeenCalled();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('posts the trimmed line with the public default → toast + navigate back', async () => {
    createDiaryMock.mockResolvedValue({ id: 'd1' });
    await submitLine('   a quiet win today   ');

    expect(createDiaryMock).toHaveBeenCalledWith({
      content: 'a quiet win today',
      visibility: 'public',
    });
    expect(toast.success).toHaveBeenCalledWith('Posted to your diary');
    expect(router.back).toHaveBeenCalled();
  });

  it('followers selection lands in the payload', async () => {
    createDiaryMock.mockResolvedValue({ id: 'd2' });
    await renderComposer();
    await act(async () => {
      fireEvent.press(screen.getByTestId('diary-visibility-followers'));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByTestId('diary-content'), 'circle line');
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('diary-post'));
    });

    expect(createDiaryMock).toHaveBeenCalledWith({
      content: 'circle line',
      visibility: 'followers',
    });
  });

  it('content over 280 chars → field error, no API call', async () => {
    await submitLine('a'.repeat(281));

    expect(screen.getByTestId('diary-content-error')).toHaveTextContent(
      'must be at most 280 characters',
    );
    expect(createDiaryMock).not.toHaveBeenCalled();
  });

  it('server validation error renders as the field message', async () => {
    createDiaryMock.mockRejectedValue(
      new ApiError('must be at most 280 characters', 400, 'VALIDATION_ERROR', [
        { field: 'content', message: 'must be at most 280 characters' },
      ]),
    );
    await submitLine('x');

    expect(await screen.findByTestId('diary-content-error')).toHaveTextContent(
      'must be at most 280 characters',
    );
    expect(router.back).not.toHaveBeenCalled();
  });

  it('connectivity failure → toast, stays on the screen', async () => {
    createDiaryMock.mockRejectedValue(new ApiError('Network Error', 0, 'NETWORK'));
    await submitLine('line worth keeping');

    expect(toast.error).toHaveBeenCalledWith(CONNECTIVITY_TOAST);
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('profile — + New diary entry point', () => {
  it('offers + New diary and routes to the composer', async () => {
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

    expect(await screen.findByTestId('new-diary')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('new-diary'));
    expect(router.push).toHaveBeenCalledWith('/diary/new');
  });
});
