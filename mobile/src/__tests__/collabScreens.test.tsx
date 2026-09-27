import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CollabsScreen from '../app/(app)/collabs';
import CollabPoemScreen from '../app/(app)/collab-poem/[id]';
import PieceReaderScreen from '../app/(app)/piece/[id]';
import ProfileScreen from '../app/(app)/profile';
import { ApiError, default as api } from '../lib/api/client';
import {
  addCollabTurn,
  addSegment,
  CollabPoem,
  createCollabPoem,
  createPiece,
  finishCollabPoem,
  getCollabPoem,
  getPiece,
  getReadingPath,
  getSegment,
  listCollabPoems,
  listPieces,
  listSegmentChildren,
  PieceSummary,
  recordReadingPath,
  Segment,
} from '../lib/api/collab';
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

jest.mock('../lib/api/collab', () => ({
  listCollabPoems: jest.fn(),
  getCollabPoem: jest.fn(),
  createCollabPoem: jest.fn(),
  addCollabTurn: jest.fn(),
  finishCollabPoem: jest.fn(),
  listPieces: jest.fn(),
  getPiece: jest.fn(),
  createPiece: jest.fn(),
  getSegment: jest.fn(),
  listSegmentChildren: jest.fn(),
  addSegment: jest.fn(),
  getReadingPath: jest.fn(),
  recordReadingPath: jest.fn(),
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

const listCollabPoemsMock = listCollabPoems as jest.Mock;
const getCollabPoemMock = getCollabPoem as jest.Mock;
const createCollabPoemMock = createCollabPoem as jest.Mock;
const addCollabTurnMock = addCollabTurn as jest.Mock;
const finishCollabPoemMock = finishCollabPoem as jest.Mock;
const listPiecesMock = listPieces as jest.Mock;
const getPieceMock = getPiece as jest.Mock;
const createPieceMock = createPiece as jest.Mock;
const getSegmentMock = getSegment as jest.Mock;
const listChildrenMock = listSegmentChildren as jest.Mock;
const addSegmentMock = addSegment as jest.Mock;
const getReadingPathMock = getReadingPath as jest.Mock;
const recordPathMock = recordReadingPath as jest.Mock;

function makePoem(overrides: Partial<CollabPoem> = {}): CollabPoem {
  return {
    id: 'p1',
    creatorId: 'u1',
    title: 'Two voices',
    linesPerTurn: 4,
    status: 'open',
    turnCount: 1,
    turns: [
      {
        order: 0,
        lines: 'first voice opens\nwith a quiet line\nunder lamplight\nand waits',
        author: { id: 'u9', username: 'bob', displayName: 'Bob', profilePhotoUrl: '' },
        createdAt: '2026-09-01T10:00:00.000Z',
      },
    ],
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function makePiece(overrides: Partial<PieceSummary> = {}): PieceSummary {
  return {
    id: 'p1',
    creatorId: 'u1',
    title: 'The fork',
    mode: 'single_ending',
    maxBranches: 5,
    status: 'open',
    rootSegmentId: 'r1',
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function makeSegment(
  id: string,
  parentId: string | null,
  content: string,
  depth: number,
): Segment {
  return {
    id,
    pieceId: 'p1',
    parentId,
    ancestorPath: [],
    author: { id: 'u1', username: 'author', displayName: 'Author Name', profilePhotoUrl: '' },
    content,
    childCount: 0,
    depth,
    createdAt: '2026-09-01T10:00:00.000Z',
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
    listCollabPoemsMock,
    getCollabPoemMock,
    createCollabPoemMock,
    addCollabTurnMock,
    finishCollabPoemMock,
    listPiecesMock,
    getPieceMock,
    createPieceMock,
    getSegmentMock,
    listChildrenMock,
    addSegmentMock,
    getReadingPathMock,
    recordPathMock,
  ].forEach((mock) => mock.mockReset());

  listCollabPoemsMock.mockResolvedValue({ items: [makePoem()], nextCursor: null });
  listPiecesMock.mockResolvedValue({ items: [makePiece()], nextCursor: null });
  getCollabPoemMock.mockResolvedValue(makePoem());
});

describe('Collaboration hub (plan step 66)', () => {
  it('lists relay poems + pieces and routes to each detail', async () => {
    await render(<CollabsScreen />);
    expect(await screen.findByTestId('collab-item-p1')).toBeTruthy();
    expect(screen.getByTestId('piece-item-p1')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('collab-item-p1'));
    });
    expect(router.push).toHaveBeenCalledWith('/collab-poem/p1');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-item-p1'));
    });
    expect(router.push).toHaveBeenCalledWith('/piece/p1');
  });

  it('creates a relay poem with the entered title + line count', async () => {
    const created = makePoem({ id: 'new1', title: 'Duet', turnCount: 0, turns: [] });
    createCollabPoemMock.mockResolvedValue(created);

    await render(<CollabsScreen />);
    await screen.findByTestId('collab-item-p1');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('collabs-new-collab'));
    });
    // empty title → field error, no request
    await act(async () => {
      await fireEvent.press(screen.getByTestId('collab-create'));
    });
    expect(createCollabPoemMock).not.toHaveBeenCalled();
    expect(screen.getByText('is required')).toBeTruthy();

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('collab-title'), 'Duet');
      await fireEvent.changeText(screen.getByTestId('collab-lines'), '6');
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('collab-create'));
    });
    expect(createCollabPoemMock).toHaveBeenCalledWith({ title: 'Duet', linesPerTurn: 6 });
    expect(await screen.findByTestId('collab-item-new1')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Relay poem started');
  });

  it('creates a branching piece with the chosen mode', async () => {
    const created = makePiece({ id: 'new2', title: 'Maze', mode: 'multi_ending' });
    createPieceMock.mockResolvedValue(created);

    await render(<CollabsScreen />);
    await screen.findByTestId('collab-item-p1');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('collabs-new-piece'));
    });
    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('piece-title'), 'Maze');
      await fireEvent.changeText(screen.getByTestId('piece-content'), 'A door stands open.');
      await fireEvent.press(screen.getByTestId('piece-mode-multi'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-create'));
    });
    expect(createPieceMock).toHaveBeenCalledWith({
      title: 'Maze',
      mode: 'multi_ending',
      content: 'A door stands open.',
    });
    expect(await screen.findByTestId('piece-item-new2')).toBeTruthy();
  });
});

describe('Relay collab poem (plan step 66: whose-turn indicator)', () => {
  it('shows the open indicator, line allowance, and the turn list', async () => {
    getCollabPoemMock.mockResolvedValue(makePoem());
    await render(<CollabPoemScreen />);

    expect(await screen.findByTestId('cp-indicator')).toBeTruthy();
    expect(screen.getByText('Open — anyone can add the next 4 lines')).toBeTruthy();
    expect(screen.getByTestId('cp-last-turn')).toHaveTextContent('Last turn: Bob');
    expect(screen.getByTestId('cp-turn-0')).toBeTruthy();
    // toHaveTextContent is exact by default; turn bodies are multi-line
    expect(screen.getByTestId('cp-turn-lines-0')).toHaveTextContent('first voice opens', {
      exact: false,
    });
  });

  it('counts lines live and blocks a wrong-count turn before any request', async () => {
    getCollabPoemMock.mockResolvedValue(makePoem());
    await render(<CollabPoemScreen />);
    await screen.findByTestId('cp-content');

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('cp-content'), 'one\ntwo\nthree');
    });
    expect(screen.getByTestId('cp-line-count')).toHaveTextContent('3/4 lines');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('cp-add-turn'));
    });
    expect(addCollabTurnMock).not.toHaveBeenCalled();
    expect(screen.getByText('needs exactly 4 lines (you have 3)')).toBeTruthy();
  });

  it('submits an exact-count turn and appends the returned poem', async () => {
    getCollabPoemMock.mockResolvedValue(makePoem());
    addCollabTurnMock.mockResolvedValue(
      makePoem({
        turnCount: 2,
        turns: [
          ...makePoem().turns,
          {
            order: 1,
            lines: 'second voice answers\nin kind\nacross the silence\nthen rests',
            author: { id: 'u1', username: 'author', displayName: 'Author Name', profilePhotoUrl: '' },
            createdAt: '2026-09-01T11:00:00.000Z',
          },
        ],
      }),
    );
    await render(<CollabPoemScreen />);
    await screen.findByTestId('cp-content');

    await act(async () => {
      await fireEvent.changeText(
        screen.getByTestId('cp-content'),
        'second voice answers\nin kind\nacross the silence\nthen rests',
      );
    });
    expect(screen.getByTestId('cp-line-count')).toHaveTextContent('4/4 lines');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('cp-add-turn'));
    });
    expect(addCollabTurnMock).toHaveBeenCalledWith(
      'p1',
      'second voice answers\nin kind\nacross the silence\nthen rests',
    );
    expect(await screen.findByTestId('cp-turn-1')).toBeTruthy();
    expect(toast.success).toHaveBeenCalledWith('Turn added');
  });

  it('finishes only as the creator; hidden for everyone else', async () => {
    finishCollabPoemMock.mockResolvedValue(makePoem({ status: 'finished' }));

    const { unmount } = await render(<CollabPoemScreen />);
    await screen.findByTestId('cp-indicator');
    expect(screen.getByTestId('cp-finish')).toBeTruthy();

    await act(async () => {
      await fireEvent.press(screen.getByTestId('cp-finish'));
    });
    expect(finishCollabPoemMock).toHaveBeenCalledWith('p1');
    expect(await screen.findByText('Finished by the creator — no more turns')).toBeTruthy();
    await unmount();

    // not the creator → no finish control, no composer changes
    getCollabPoemMock.mockResolvedValue(makePoem({ creatorId: 'u9' }));
    await render(<CollabPoemScreen />);
    await screen.findByTestId('cp-indicator');
    expect(screen.queryByTestId('cp-finish')).toBeNull();
  });
});

function mockPieceFlow(children: Segment[], cap = 1) {
  getPieceMock.mockResolvedValue({ piece: makePiece(), rootSegment: makeSegment('r1', null, 'The road began here', 0) });
  getReadingPathMock.mockResolvedValue(null);
  recordPathMock.mockImplementation(async (_pieceId: string, segmentId: string) => ({
    pieceId: 'p1',
    visitedSegmentIds: segmentId === 'r1' ? ['r1'] : ['r1', segmentId],
    currentSegmentId: segmentId,
    updatedAt: '2026-09-01T10:00:00.000Z',
  }));
  listChildrenMock.mockImplementation(async (_pieceId: string, segmentId: string) => ({
    parentId: segmentId,
    childCount: segmentId === 'r1' ? children.length : 0,
    cap,
    items: segmentId === 'r1' ? children : [],
  }));
}

describe('Branching reader (plan step 66: picker + breadcrumb)', () => {
  it('starts the path at the root and renders the segment + breadcrumb', async () => {
    mockPieceFlow([makeSegment('s1', 'r1', 'Left toward rain', 1)]);
    await render(<PieceReaderScreen />);

    expect(await screen.findByTestId('piece-segment-content')).toHaveTextContent(
      'The road began here',
    );
    expect(recordPathMock).toHaveBeenCalledWith('p1', 'r1');
    // crumb labels are sliced to 18 chars by crumbLabel()
    expect(screen.getByTestId('piece-breadcrumb')).toHaveTextContent('1. The road began her', {
      exact: false,
    });
    expect(screen.getByTestId('piece-child-s1')).toBeTruthy();
    // cap is one and used → composer hidden, cap hint shown
    expect(screen.queryByTestId('piece-new-segment')).toBeNull();
    expect(screen.getByTestId('piece-cap-hint')).toBeTruthy();
  });

  it('moves to a picked branch: records the path, swaps segment, shows back-to-parent', async () => {
    mockPieceFlow([makeSegment('s1', 'r1', 'Left toward rain', 1)]);
    await render(<PieceReaderScreen />);
    await screen.findByTestId('piece-child-s1');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-child-s1'));
    });
    expect(await screen.findByTestId('piece-segment-content')).toHaveTextContent(
      'Left toward rain',
    );
    expect(recordPathMock).toHaveBeenLastCalledWith('p1', 's1');
    expect(screen.getByTestId('piece-breadcrumb')).toHaveTextContent('2. Left toward rain', {
      exact: false,
    });
    expect(screen.getByTestId('piece-back-to-parent')).toBeTruthy();
  });

  it('writes a new segment under the current one and moves onto it', async () => {
    mockPieceFlow([], 1);
    addSegmentMock.mockResolvedValue(makeSegment('s1', 'r1', 'A new branch grows', 1));
    await render(<PieceReaderScreen />);
    await screen.findByTestId('piece-segment-content');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-new-segment'));
    });
    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('piece-segment-input'), 'A new branch grows');
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-add-segment'));
    });
    expect(addSegmentMock).toHaveBeenCalledWith('p1', {
      parentId: 'r1',
      content: 'A new branch grows',
    });
    expect(await screen.findByTestId('piece-segment-content')).toHaveTextContent(
      'A new branch grows',
    );
    expect(toast.success).toHaveBeenCalledWith('Segment added');
  });

  it('surfaces a branch-cap rejection as a toast and keeps the tree intact', async () => {
    mockPieceFlow([], 1);
    addSegmentMock.mockRejectedValue(
      new ApiError('Branch cap reached', 409, 'BRANCH_CAP_REACHED', { cap: 1 }),
    );
    await render(<PieceReaderScreen />);
    await screen.findByTestId('piece-segment-content');

    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-new-segment'));
    });
    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('piece-segment-input'), 'Too late');
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('piece-add-segment'));
    });
    expect(toast.error).toHaveBeenCalledWith('This branch already reached its cap.');
    expect(screen.getByTestId('piece-segment-content')).toHaveTextContent('The road began here');
  });
});

describe('Profile entry (plan step 66)', () => {
  it('exposes the Collaborate button that opens the hub', async () => {
    await render(<ProfileScreen />);
    const button = await screen.findByTestId('open-collabs');
    await act(async () => {
      await fireEvent.press(button);
    });
    expect(router.push).toHaveBeenCalledWith('/collabs');
  });
});
