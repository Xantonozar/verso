import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import DuelScreen from '../app/(app)/duel';
import PromptScreen from '../app/(app)/prompt';
import RemixScreen from '../app/(app)/remix/[id]';
import ProfileScreen from '../app/(app)/profile';
import { ApiError, default as api } from '../lib/api/client';
import { DuelDetail, getDuel, listDuels, voteDuel } from '../lib/api/duels';
import {
  FeedPoemItem,
  getCurrentPrompt,
  listMyPoems,
  listPromptSubmissions,
  Prompt,
  PromptSubmission,
  submitToPrompt,
} from '../lib/api/prompts';
import { createRemix } from '../lib/api/remixes';
import { getPoem, Poem } from '../lib/api/poems';
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

jest.mock('../lib/api/duels', () => ({
  listDuels: jest.fn(),
  getDuel: jest.fn(),
  voteDuel: jest.fn(),
}));

jest.mock('../lib/api/prompts', () => ({
  getCurrentPrompt: jest.fn(),
  listPromptSubmissions: jest.fn(),
  submitToPrompt: jest.fn(),
  listMyPoems: jest.fn(),
}));

jest.mock('../lib/api/remixes', () => ({
  createRemix: jest.fn(),
}));

jest.mock('../lib/api/poems', () => ({
  ...jest.requireActual('../lib/api/poems'),
  getPoem: jest.fn(),
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

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
}));

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

const { router } = jest.requireMock('expo-router') as {
  router: { replace: jest.Mock; push: jest.Mock; back: jest.Mock };
};
const apiMock = api as unknown as { get: jest.Mock };

const listDuelsMock = listDuels as jest.Mock;
const getDuelMock = getDuel as jest.Mock;
const voteDuelMock = voteDuel as jest.Mock;
const getCurrentPromptMock = getCurrentPrompt as jest.Mock;
const listSubmissionsMock = listPromptSubmissions as jest.Mock;
const submitToPromptMock = submitToPrompt as jest.Mock;
const listMyPoemsMock = listMyPoems as jest.Mock;
const createRemixMock = createRemix as jest.Mock;
const getPoemMock = getPoem as jest.Mock;

function makePoem(overrides: Partial<Poem> = {}): Poem {
  return {
    id: 'pa',
    authorId: 'u2',
    title: 'Aurora',
    content: 'first light over the ridge',
    visibility: 'public',
    anonymous: false,
    status: 'published',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    author: { id: 'u2', username: 'bob', displayName: 'Bob', profilePhotoUrl: '' },
    ...overrides,
  };
}

function makeDuelDetail(overrides: Partial<DuelDetail> = {}): DuelDetail {
  return {
    id: 'd1',
    theme: 'Dusk',
    poetAId: 'u2',
    poetBId: 'u3',
    poemAId: 'pa',
    poemBId: 'pb',
    submissionDeadline: '2026-09-27T18:00:00.000Z',
    votingDeadline: '2026-09-27T20:00:00.000Z',
    votes: { poemA: 0, poemB: 0 },
    status: 'voting',
    createdAt: '2026-09-27T10:00:00.000Z',
    updatedAt: '2026-09-27T10:00:00.000Z',
    poemA: makePoem(),
    poemB: makePoem({ id: 'pb', title: 'Moonfall', content: 'night tide pulls the shore' }),
    myVote: null,
    ...overrides,
  };
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: 'pr1',
    text: 'Write about rain',
    weekOf: '2026-09-21T00:00:00.000Z',
    featuredPoemIds: [],
    createdAt: '2026-09-21T00:00:00.000Z',
    mySubmission: null,
    ...overrides,
  };
}

function makeFeedPoem(overrides: Partial<FeedPoemItem> = {}): FeedPoemItem {
  return {
    type: 'poem',
    id: 'm1',
    title: 'Mine',
    status: 'published',
    excerpt: 'seed words here',
    anonymous: false,
    publishedAt: '2026-09-21T10:00:00.000Z',
    author: { id: 'u1', username: 'author', displayName: 'Author Name', profilePhotoUrl: '' },
    ...overrides,
  };
}

function makeSubmission(overrides: Partial<PromptSubmission> = {}): PromptSubmission {
  return {
    id: 's1',
    promptId: 'pr1',
    poemId: 'm1',
    createdAt: '2026-09-22T10:00:00.000Z',
    poem: makeFeedPoem(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
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
    return Promise.resolve({ data: null });
  });
  [
    listDuelsMock,
    getDuelMock,
    voteDuelMock,
    getCurrentPromptMock,
    listSubmissionsMock,
    submitToPromptMock,
    listMyPoemsMock,
    createRemixMock,
    getPoemMock,
  ].forEach((mock) => mock.mockReset());

  listDuelsMock.mockResolvedValue({ items: [{ id: 'd1' }], nextCursor: null });
  getDuelMock.mockResolvedValue(makeDuelDetail());
  getCurrentPromptMock.mockResolvedValue(makePrompt());
  listSubmissionsMock.mockResolvedValue({ items: [], nextCursor: null });
});

describe('Duel screen (plan step 71: side-by-side + optimistic vote)', () => {
  it('renders both poems side by side with the tally', async () => {
    await render(<DuelScreen />);
    expect(await screen.findByTestId('duel-theme')).toHaveTextContent('Dusk');
    expect(screen.getByTestId('duel-status')).toHaveTextContent('Voting is open');
    expect(screen.getByTestId('duel-a-title')).toHaveTextContent('Aurora');
    expect(screen.getByTestId('duel-b-title')).toHaveTextContent('Moonfall');
    expect(screen.getByTestId('duel-a-body')).toHaveTextContent('first light over the ridge', {
      exact: false,
    });
    expect(screen.getByTestId('duel-votes')).toHaveTextContent('A 0 · B 0');
    expect(listDuelsMock).toHaveBeenCalledWith(1);
    expect(getDuelMock).toHaveBeenCalledWith('d1');
  });

  it('settles a cast vote with the server tally and locks the side', async () => {
    voteDuelMock.mockResolvedValue(
      makeDuelDetail({ votes: { poemA: 1, poemB: 0 }, myVote: 'A' }),
    );

    await render(<DuelScreen />);
    await screen.findByTestId('duel-a-vote');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('duel-a-vote'));
    });
    expect(voteDuelMock).toHaveBeenCalledWith('d1', 'A');
    expect(toast.success).toHaveBeenCalledWith('Vote counted');
    expect(screen.getByTestId('duel-votes')).toHaveTextContent('A 1 · B 0', { exact: false });
    expect(screen.getByTestId('duel-a-votes')).toHaveTextContent('1 vote');
    expect(screen.getByText('Your vote')).toBeTruthy();
  });

  it('rolls the optimistic vote back and toasts when the server refuses', async () => {
    voteDuelMock.mockRejectedValue(new ApiError('Already voted', 409, 'DUPLICATE_VOTE'));

    await render(<DuelScreen />);
    await screen.findByTestId('duel-a-vote');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('duel-a-vote'));
    });
    expect(toast.error).toHaveBeenCalledWith("Your vote didn't go through");
    expect(screen.getByTestId('duel-a-votes')).toHaveTextContent('0 votes');
    expect(screen.getByTestId('duel-votes')).toHaveTextContent('A 0 · B 0');
    // rollback re-enables the control
    expect(screen.getByText('Vote for Poem A')).toBeTruthy();
  });

  it('shows the empty state when no duels exist', async () => {
    listDuelsMock.mockResolvedValue({ items: [], nextCursor: null });
    await render(<DuelScreen />);
    expect(await screen.findByTestId('duel-empty')).toBeTruthy();
    expect(getDuelMock).not.toHaveBeenCalled();
  });

  it('hides the vote controls once voting has closed', async () => {
    getDuelMock.mockResolvedValue(
      makeDuelDetail({ status: 'closed', myVote: null, votes: { poemA: 3, poemB: 1 } }),
    );
    await render(<DuelScreen />);
    await screen.findByTestId('duel-a-vote');
    expect(screen.getByTestId('duel-status')).toHaveTextContent('Voting has closed');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('duel-a-vote'));
    });
    expect(voteDuelMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('duel-a-votes')).toHaveTextContent('3 votes');
  });
});

describe('Weekly prompt screen (plan step 71)', () => {
  it('renders the prompt and its entries', async () => {
    listSubmissionsMock.mockResolvedValue({
      items: [makeSubmission()],
      nextCursor: null,
    });
    await render(<PromptScreen />);
    expect(await screen.findByTestId('prompt-text')).toHaveTextContent('Write about rain');
    expect(screen.getByTestId('prompt-submissions')).toBeTruthy();
    expect(screen.getByText('Mine')).toBeTruthy();
    expect(screen.getByText('@author')).toBeTruthy();
    expect(screen.getByTestId('prompt-submit-open')).toBeTruthy();
  });

  it('submits a picked published poem and shows the submitted state', async () => {
    listMyPoemsMock.mockResolvedValue({ items: [makeFeedPoem()], nextCursor: null });
    submitToPromptMock.mockResolvedValue({
      id: 's9',
      promptId: 'pr1',
      poemId: 'm1',
      createdAt: '2026-09-27T12:00:00.000Z',
    });

    await render(<PromptScreen />);
    await screen.findByTestId('prompt-submit-open');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('prompt-submit-open'));
    });
    expect(await screen.findByTestId('prompt-pick-m1')).toBeTruthy();
    expect(listMyPoemsMock).toHaveBeenCalledWith({ status: 'published', limit: 20 });

    await act(async () => {
      await fireEvent.press(screen.getByTestId('prompt-pick-m1'));
    });
    expect(submitToPromptMock).toHaveBeenCalledWith('pr1', 'm1');
    expect(toast.success).toHaveBeenCalledWith('Submitted to this week\u2019s prompt');
    expect(await screen.findByTestId('prompt-submitted')).toBeTruthy();
    expect(screen.queryByTestId('prompt-submit-open')).toBeNull();
    // the new entry is prepended locally
    expect(await screen.findByTestId('prompt-sub-s9')).toBeTruthy();
  });

  it('surfaces ALREADY_SUBMITTED as a toast and keeps the form open', async () => {
    listMyPoemsMock.mockResolvedValue({ items: [makeFeedPoem()], nextCursor: null });
    submitToPromptMock.mockRejectedValue(
      new ApiError('Already submitted', 409, 'ALREADY_SUBMITTED'),
    );

    await render(<PromptScreen />);
    await screen.findByTestId('prompt-submit-open');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('prompt-submit-open'));
    });
    await act(async () => {
      await fireEvent.press(await screen.findByTestId('prompt-pick-m1'));
    });
    expect(toast.error).toHaveBeenCalledWith('You already submitted a poem');
    expect(screen.getByTestId('prompt-submit-open')).toBeTruthy();
  });

  it('shows the submitted state up front when mySubmission exists', async () => {
    getCurrentPromptMock.mockResolvedValue(
      makePrompt({
        mySubmission: {
          id: 's1',
          promptId: 'pr1',
          poemId: 'm1',
          createdAt: '2026-09-22T10:00:00.000Z',
        },
      }),
    );
    await render(<PromptScreen />);
    expect(await screen.findByTestId('prompt-submitted')).toBeTruthy();
    expect(screen.queryByTestId('prompt-submit-open')).toBeNull();
  });

  it('shows the empty state when no prompt covers this week', async () => {
    getCurrentPromptMock.mockRejectedValue(new ApiError('No prompt', 404, 'NO_PROMPT'));
    await render(<PromptScreen />);
    expect(await screen.findByTestId('prompt-empty')).toBeTruthy();
    expect(listSubmissionsMock).not.toHaveBeenCalled();
  });

  it('hints when the picker has no published poems to submit', async () => {
    listMyPoemsMock.mockResolvedValue({ items: [], nextCursor: null });
    await render(<PromptScreen />);
    await screen.findByTestId('prompt-submit-open');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('prompt-submit-open'));
    });
    expect(await screen.findByTestId('prompt-picker-empty')).toBeTruthy();
  });
});

describe('Remix screen (plan step 71: attribution before submit)', () => {
  const original = makePoem({ id: 'p1', title: 'First draft', content: 'original words' });

  it('shows attribution, prefills the title, and publishes the remix', async () => {
    getPoemMock.mockResolvedValue(original);
    createRemixMock.mockResolvedValue({
      remix: { id: 'rx1', originalPoemId: 'p1', remixPoemId: 'n1' },
      poem: makePoem({ id: 'n1', title: 'First draft (remix)' }),
    });

    await render(<RemixScreen />);
    expect(await screen.findByTestId('remix-attribution')).toBeTruthy();
    expect(screen.getByTestId('remix-original-title')).toHaveTextContent('First draft');
    expect(screen.getByTestId('remix-original-byline')).toHaveTextContent('@bob', {
      exact: false,
    });
    expect(screen.getByTestId('remix-submit')).toBeTruthy();

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('remix-content'), 'my second telling');
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('remix-submit'));
    });
    expect(createRemixMock).toHaveBeenCalledWith({
      originalPoemId: 'p1',
      title: 'First draft (remix)',
      content: 'my second telling',
    });
    expect(toast.success).toHaveBeenCalledWith('Remix published');
    expect(router.replace).toHaveBeenCalledWith('/poem/n1');
  });

  it('blocks an empty version before any request', async () => {
    getPoemMock.mockResolvedValue(original);
    await render(<RemixScreen />);
    await screen.findByTestId('remix-submit');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('remix-submit'));
    });
    expect(createRemixMock).not.toHaveBeenCalled();
    expect(screen.getByText('is required')).toBeTruthy();
  });

  it('shows the error state when the original cannot be read', async () => {
    getPoemMock.mockRejectedValue(new ApiError('Not found', 404, 'POEM_NOT_FOUND'));
    await render(<RemixScreen />);
    expect(await screen.findByText("Couldn't load the poem to remix.")).toBeTruthy();
  });
});

describe('Profile entries (plan step 71)', () => {
  it('routes Duels and Weekly prompt from the profile', async () => {
    await render(<ProfileScreen />);
    const duels = await screen.findByTestId('open-duels');
    await act(async () => {
      await fireEvent.press(duels);
    });
    expect(router.push).toHaveBeenCalledWith('/duel');

    const prompt = await screen.findByTestId('open-prompt');
    await act(async () => {
      await fireEvent.press(prompt);
    });
    expect(router.push).toHaveBeenCalledWith('/prompt');
  });
});
