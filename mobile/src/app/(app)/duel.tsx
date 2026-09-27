import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import {
  DuelDetail,
  DuelVotes,
  getDuel,
  listDuels,
  VoteSide,
  voteDuel,
} from '../../lib/api/duels';
import { Poem } from '../../lib/api/poems';
import { toast } from '../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error' | 'empty';

function bump(votes: DuelVotes, side: VoteSide): DuelVotes {
  return side === 'A'
    ? { ...votes, poemA: votes.poemA + 1 }
    : { ...votes, poemB: votes.poemB + 1 };
}

function statusLine(duel: DuelDetail): string {
  if (duel.status === 'open') return 'Submission phase — voting has not opened';
  if (duel.status === 'closed') return 'Voting has closed';
  return 'Voting is open';
}

/**
 * Duel screen (plan step 71): the newest duel, side by side, with an
 * optimistic vote that rolls back (and toasts) when the server refuses —
 * the unique vote index makes replays/dupes come back as 409.
 */
export default function DuelScreen() {
  const [duel, setDuel] = useState<DuelDetail | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [voting, setVoting] = useState(false);

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return listDuels(1)
      .then((page) => {
        if (page.items.length === 0) {
          setLoadState('empty');
          return undefined;
        }
        return getDuel(page.items[0].id).then((detail) => {
          setDuel(detail);
          setLoadState('ready');
        });
      })
      .catch(() => {
        setLoadState('error');
      });
  }, []);

  // Effect fetch mirrors `load` without the synchronous setLoadState('loading')
  // (react-hooks/set-state-in-effect); `load` (with it) serves retry taps.
  useEffect(() => {
    let cancelled = false;
    listDuels(1)
      .then((page) => {
        if (page.items.length === 0) {
          if (!cancelled) setLoadState('empty');
          return;
        }
        getDuel(page.items[0].id)
          .then((detail) => {
            if (!cancelled) {
              setDuel(detail);
              setLoadState('ready');
            }
          })
          .catch(() => {
            if (!cancelled) setLoadState('error');
          });
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function castVote(side: VoteSide) {
    if (!duel || voting || duel.myVote !== null || duel.status !== 'voting') return;
    const previous = { votes: duel.votes, myVote: duel.myVote };
    setDuel({ ...duel, votes: bump(duel.votes, side), myVote: side });
    setVoting(true);
    try {
      const settled = await voteDuel(duel.id, side);
      setDuel((current) =>
        current
          ? {
              ...current,
              votes: settled.votes,
              myVote: settled.myVote,
              status: settled.status,
            }
          : current,
      );
      toast.success('Vote counted');
    } catch (err) {
      setDuel((current) =>
        current ? { ...current, votes: previous.votes, myVote: previous.myVote } : current,
      );
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else toast.error("Your vote didn't go through");
    } finally {
      setVoting(false);
    }
  }

  const header = (
    <>
      <Button label="Back" variant="secondary" onPress={() => router.back()} testID="duel-back" />
      <Text style={styles.heading}>Duel</Text>
    </>
  );

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <LoadingState label="Loading duel..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <ErrorState message="Couldn't load the duel." onRetry={load} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadState === 'empty' || !duel) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <View testID="duel-empty">
            <EmptyState
              title="No duels yet"
              subtitle="Two poems face off on a theme — check back when voting opens."
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const canVote = duel.status === 'voting' && duel.myVote === null && !voting;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {header}

        <Text style={styles.theme} testID="duel-theme">
          {duel.theme}
        </Text>
        <Text style={styles.status} testID="duel-status">
          {statusLine(duel)}
        </Text>
        <Text style={styles.deadline} testID="duel-deadline">
          Voting closes {new Date(duel.votingDeadline).toLocaleString()}
        </Text>
        <Text style={styles.tally} testID="duel-votes">
          {`A ${duel.votes.poemA} · B ${duel.votes.poemB}`}
          {duel.myVote ? ` · you voted ${duel.myVote}` : ''}
        </Text>

        <View style={styles.board} testID="duel-board">
          <Side
            label="Poem A"
            poem={duel.poemA}
            votes={duel.votes.poemA}
            voted={duel.myVote === 'A'}
            disabled={!canVote}
            onPress={() => castVote('A')}
            testPrefix="duel-a"
          />
          <Side
            label="Poem B"
            poem={duel.poemB}
            votes={duel.votes.poemB}
            voted={duel.myVote === 'B'}
            disabled={!canVote}
            onPress={() => castVote('B')}
            testPrefix="duel-b"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Side(props: {
  label: string;
  poem: Poem;
  votes: number;
  voted: boolean;
  disabled: boolean;
  onPress: () => void;
  testPrefix: string;
}) {
  return (
    <View style={styles.side} testID={`${props.testPrefix}-side`}>
      <Text style={styles.sideLabel}>{props.label}</Text>
      <Text style={styles.sideTitle} testID={`${props.testPrefix}-title`}>
        {props.poem.title}
      </Text>
      <Text style={styles.sideByline} testID={`${props.testPrefix}-byline`}>
        {props.poem.anonymous
          ? 'Anonymous'
          : props.poem.author
            ? `@${props.poem.author.username}`
            : ''}
      </Text>
      <Text style={styles.sideBody} testID={`${props.testPrefix}-body`}>
        {props.poem.content}
      </Text>
      <Text style={styles.sideVotes} testID={`${props.testPrefix}-votes`}>
        {props.votes} {props.votes === 1 ? 'vote' : 'votes'}
      </Text>
      <Button
        label={props.voted ? 'Your vote' : `Vote for ${props.label}`}
        variant={props.voted ? 'primary' : 'secondary'}
        disabled={props.disabled || props.voted}
        onPress={props.onPress}
        testID={`${props.testPrefix}-vote`}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  theme: {
    ...typography.title,
    fontSize: 22,
    color: colors.ink,
  },
  status: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  deadline: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  tally: {
    ...typography.body,
    color: colors.ink,
  },
  board: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'flex-start',
  },
  side: {
    flex: 1,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  sideLabel: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  sideTitle: {
    ...typography.title,
    fontSize: 16,
    color: colors.ink,
  },
  sideByline: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  sideBody: {
    ...typography.body,
    color: colors.ink,
  },
  sideVotes: {
    ...typography.body,
    color: colors.inkSecondary,
  },
});
