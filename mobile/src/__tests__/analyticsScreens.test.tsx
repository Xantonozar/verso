import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import AnalyticsScreen from '../app/(app)/analytics';
import { getWriterAnalytics, WriterAnalytics, WriterDayStat } from '../lib/api/analytics';

/**
 * Phase 12 mobile gate (plan step 84): writer dashboard rendering —
 * heavy-query loading state, totals + newest-first daily rows, the
 * brand-new-writer empty state, quiet-window note, and error + retry.
 */

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn(), back: jest.fn() },
  Redirect: () => null,
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: () => null,
  useLocalSearchParams: jest.fn(),
}));

jest.mock('../lib/api/analytics', () => ({
  getWriterAnalytics: jest.fn(),
  recordPoemRead: jest.fn(),
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
  router: { back: jest.Mock };
};

const getWriterAnalyticsMock = getWriterAnalytics as jest.Mock;

const ZERO_DAY = (date: string): WriterDayStat => ({
  date,
  reads: 0,
  reactions: 0,
  comments: 0,
  saves: 0,
  followers: 0,
});

function zeroDays(count: number): WriterDayStat[] {
  const days: WriterDayStat[] = [];
  for (let i = 0; i < count; i++) days.push(ZERO_DAY(`2026-08-${String(i + 1).padStart(2, '0')}`));
  return days;
}

const ACTIVE_FIXTURE: WriterAnalytics = {
  range: { from: '2026-09-01', to: '2026-09-30', days: 30 },
  totals: { poems: 2, reads: 120, reactions: 30, comments: 9, saves: 14, followers: 40 },
  days: [
    ZERO_DAY('2026-09-10'),
    {
      date: '2026-09-20',
      reads: 12,
      reactions: 3,
      comments: 1,
      saves: 2,
      followers: 4,
    },
  ],
};

const NEW_WRITER_FIXTURE: WriterAnalytics = {
  range: { from: '2026-09-01', to: '2026-09-30', days: 30 },
  totals: { poems: 0, reads: 0, reactions: 0, comments: 0, saves: 0, followers: 0 },
  days: zeroDays(30),
};

const QUIET_FIXTURE: WriterAnalytics = {
  range: { from: '2026-09-01', to: '2026-09-30', days: 30 },
  totals: { poems: 3, reads: 42, reactions: 7, comments: 2, saves: 5, followers: 6 },
  days: zeroDays(30),
};

beforeEach(() => {
  jest.clearAllMocks();
  getWriterAnalyticsMock.mockResolvedValue(ACTIVE_FIXTURE);
});

describe('Writer dashboard (plan step 84)', () => {
  test('shows the heavy-query loading state, then totals and the active day row', async () => {
    let resolveStats!: (value: WriterAnalytics) => void;
    getWriterAnalyticsMock.mockReturnValue(
      new Promise<WriterAnalytics>((resolve) => {
        resolveStats = resolve;
      }),
    );

    await render(<AnalyticsScreen />);
    expect(screen.getByText('Gathering your readership...')).toBeTruthy();

    await act(async () => {
      resolveStats(ACTIVE_FIXTURE);
    });

    expect(await screen.findByTestId('analytics-ready')).toBeTruthy();
    expect(screen.getByTestId('total-reads')).toHaveTextContent('120');
    expect(screen.getByTestId('total-poems')).toHaveTextContent('2');
    expect(screen.getByTestId('total-followers')).toHaveTextContent('40');
    expect(screen.getByTestId('day-2026-09-20')).toBeTruthy();
    expect(screen.queryByTestId('day-2026-09-10')).toBeNull();
    expect(screen.getByText(/12 reads/)).toBeTruthy();
    expect(screen.getByText('2026-09-01 → 2026-09-30')).toBeTruthy();
    expect(getWriterAnalyticsMock).toHaveBeenCalledWith(30);
  });

  test('new writer lands on the honest empty state', async () => {
    getWriterAnalyticsMock.mockResolvedValue(NEW_WRITER_FIXTURE);

    await render(<AnalyticsScreen />);
    expect(await screen.findByTestId('analytics-empty')).toBeTruthy();
    expect(screen.getByText('Nothing to measure yet.')).toBeTruthy();
    expect(screen.queryByTestId('analytics-ready')).toBeNull();
  });

  test('totals with a quiet window show the no-activity note instead of rows', async () => {
    getWriterAnalyticsMock.mockResolvedValue(QUIET_FIXTURE);

    await render(<AnalyticsScreen />);
    expect(await screen.findByTestId('analytics-quiet')).toBeTruthy();
    expect(screen.getByText('No activity in the last 30 days.')).toBeTruthy();
    expect(screen.queryByTestId('analytics-days')).toBeNull();
    expect(screen.getByTestId('total-reads')).toHaveTextContent('42');
  });

  test('failure shows its own error state and retry recovers', async () => {
    getWriterAnalyticsMock
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(ACTIVE_FIXTURE);

    await render(<AnalyticsScreen />);
    expect(await screen.findByText("Couldn't load your analytics.")).toBeTruthy();

    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByTestId('analytics-ready')).toBeTruthy();
    expect(getWriterAnalyticsMock).toHaveBeenCalledTimes(2);
  });

  test('Back returns to the previous screen', async () => {
    await render(<AnalyticsScreen />);
    await screen.findByTestId('analytics-ready');

    await fireEvent.press(screen.getByTestId('analytics-back'));
    expect(router.back).toHaveBeenCalled();
  });
});
