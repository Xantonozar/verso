import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { PoemEditor } from '../components/PoemEditor';
import { CommentThread } from '../components/engage/CommentThread';
import { ReactionBar } from '../components/engage/ReactionBar';
import { default as api } from '../lib/api/client';
import { listComments } from '../lib/api/engagement';

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

jest.mock('../lib/api/engagement', () => {
  const actual = jest.requireActual('../lib/api/engagement');
  return {
    __esModule: true,
    ...actual,
    listComments: jest.fn(),
  };
});

jest.mock('../context/AuthContext', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'u2', username: 'reader', displayName: 'Reader' },
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
      set: jest.fn((key: string, value: string) => {
        store.set(key, value);
        return Promise.resolve();
      }),
      remove: jest.fn((key: string) => {
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

const apiMock = api as unknown as {
  get: jest.Mock;
  post: jest.Mock;
  patch: jest.Mock;
  put: jest.Mock;
  delete: jest.Mock;
};

const emptyComments = { items: [], nextCursor: null };

const poemStats = {
  reads: 0,
  reactionCount: 1,
  commentCount: 0,
  saveCount: 0,
  shareCount: 0,
};

function renderEditor() {
  return render(<PoemEditor poem={null} onCreated={jest.fn()} onSaved={jest.fn()} />);
}

async function fillEditor() {
  await fireEvent.changeText(screen.getByTestId('poem-title'), 'Quiet');
  await fireEvent.changeText(screen.getByTestId('poem-content'), 'a whisper');
}

beforeEach(() => {
  jest.clearAllMocks();
  (listComments as jest.Mock).mockResolvedValue(emptyComments);
  apiMock.post.mockResolvedValue({
    data: {
      id: 'p1',
      title: 'Quiet',
      content: 'a whisper',
      visibility: 'private_draft',
      anonymous: false,
      isUnsentPoem: false,
      unsentRecipientLabel: '',
      status: 'draft',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  });
});

describe('PoemEditor — anonymous toggle (plan step 62)', () => {
  it('explainer appears only once the toggle is on', async () => {
    await renderEditor();
    expect(screen.queryByTestId('anonymity-explainer')).toBeNull();
    await fireEvent(screen.getByTestId('poem-anonymous'), 'valueChange', true);
    expect(screen.getByTestId('anonymity-explainer')).toBeTruthy();
    await fireEvent(screen.getByTestId('poem-anonymous'), 'valueChange', false);
    expect(screen.queryByTestId('anonymity-explainer')).toBeNull();
  });

  it('create payload carries anonymous: true when toggled', async () => {
    await renderEditor();
    await fireEvent(screen.getByTestId('poem-anonymous'), 'valueChange', true);
    await fillEditor();
    await fireEvent.press(screen.getByTestId('poem-save'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems', {
        title: 'Quiet',
        content: 'a whisper',
        anonymous: true,
      }),
    );
  });

  it('default create payload stays minimal (no anonymous/unsent keys)', async () => {
    await renderEditor();
    await fillEditor();
    await fireEvent.press(screen.getByTestId('poem-save'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems', {
        title: 'Quiet',
        content: 'a whisper',
      }),
    );
  });
});

describe('PoemEditor — Unsent Poem fields (plan step 61)', () => {
  it('toggle reveals the recipient field and sends the unsent fields', async () => {
    await renderEditor();
    expect(screen.queryByTestId('unsent-recipient-label')).toBeNull();
    await fireEvent(screen.getByTestId('poem-unsent'), 'valueChange', true);
    await screen.findByTestId('unsent-recipient-label');

    await fireEvent.changeText(screen.getByTestId('unsent-recipient-label'), 'For Ada');
    await fillEditor();
    await fireEvent.press(screen.getByTestId('poem-save'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems', {
        title: 'Quiet',
        content: 'a whisper',
        isUnsentPoem: true,
        unsentRecipientLabel: 'For Ada',
      }),
    );
  });

  it('unsent with no label still flags the poem', async () => {
    await renderEditor();
    await fireEvent(screen.getByTestId('poem-unsent'), 'valueChange', true);
    await fillEditor();
    await fireEvent.press(screen.getByTestId('poem-save'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems', {
        title: 'Quiet',
        content: 'a whisper',
        isUnsentPoem: true,
        unsentRecipientLabel: '',
      }),
    );
  });
});

describe('CommentThread — anonymous composer (plan step 62)', () => {
  it('posts with anonymous: true only after the toggle is on', async () => {
    apiMock.post.mockResolvedValue({
      data: {
        id: 'c1',
        targetType: 'poem',
        targetId: 'p1',
        parentCommentId: null,
        anonymous: true,
        content: 'gentle line',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await render(
      <CommentThread poemId="p1" interactive currentUserId="u2" commentCount={0} />,
    );
    await screen.findByTestId('comment-input');
    expect(screen.queryByTestId('anonymity-explainer')).toBeNull();

    await fireEvent(screen.getByTestId('comment-anonymous'), 'valueChange', true);
    await screen.findByTestId('anonymity-explainer');

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'gentle line');
    await fireEvent.press(screen.getByTestId('comment-submit'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/comments', {
        targetType: 'poem',
        targetId: 'p1',
        content: 'gentle line',
        anonymous: true,
      }),
    );
  });

  it('posts without the anonymous key when the toggle stays off', async () => {
    apiMock.post.mockResolvedValue({
      data: {
        id: 'c2',
        targetType: 'poem',
        targetId: 'p1',
        parentCommentId: null,
        anonymous: false,
        content: 'signed',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    });
    await render(
      <CommentThread poemId="p1" interactive currentUserId="u2" commentCount={0} />,
    );
    await screen.findByTestId('comment-input');

    await fireEvent.changeText(screen.getByTestId('comment-input'), 'signed');
    await fireEvent.press(screen.getByTestId('comment-submit'));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/comments', {
        targetType: 'poem',
        targetId: 'p1',
        content: 'signed',
      }),
    );
  });
});

describe('ReactionBar — react anonymously (plan step 62)', () => {
  it('sends anonymous: true with the reaction after the toggle is on', async () => {
    apiMock.post.mockResolvedValue({
      data: { reaction: { id: 'r1', type: 'loved' }, stats: poemStats },
    });
    await render(<ReactionBar poemId="p1" counts={{}} active={[]} interactive />);

    await fireEvent(screen.getByTestId('reaction-anonymous'), 'valueChange', true);
    await screen.findByTestId('anonymity-explainer');

    await fireEvent.press(screen.getByTestId('reaction-loved'));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems/p1/reactions', {
        type: 'loved',
        anonymous: true,
      }),
    );
  });

  it('keeps the payload minimal when the toggle stays off', async () => {
    apiMock.post.mockResolvedValue({
      data: { reaction: { id: 'r2', type: 'hurt' }, stats: poemStats },
    });
    await render(<ReactionBar poemId="p1" counts={{}} active={[]} interactive />);

    await fireEvent.press(screen.getByTestId('reaction-hurt'));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/poems/p1/reactions', { type: 'hurt' }),
    );
  });
});
