import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { useAuth } from '../../../context/AuthContext';
import { ApiError } from '../../../lib/api/client';
import { getPoem, Poem } from '../../../lib/api/poems';
import { colors, layout, radii, spacing, typography } from '../../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'gone' | 'error';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function PoemSkeleton() {
  return (
    <View
      style={styles.skeleton}
      testID="poem-skeleton"
      accessibilityRole="progressbar"
      accessibilityLabel="Loading poem"
    >
      <View style={styles.skeletonTitle} />
      <View style={styles.skeletonLine} />
      <View style={[styles.skeletonLine, styles.skeletonLineShort]} />
      <View style={[styles.skeletonLine, styles.skeletonLineMedium]} />
    </View>
  );
}

export default function PoemReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [poem, setPoem] = useState<Poem | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const fetchPoem = useCallback(async (): Promise<Poem> => getPoem(id), [id]);

  useEffect(() => {
    let cancelled = false;
    fetchPoem()
      .then((data) => {
        if (!cancelled) {
          setPoem(data);
          setState('ready');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState(
            err instanceof ApiError && err.code === 'POEM_NOT_FOUND' ? 'gone' : 'error',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPoem]);

  const reload = useCallback(async () => {
    setState('loading');
    try {
      setPoem(await fetchPoem());
      setState('ready');
    } catch (err) {
      setState(
        err instanceof ApiError && err.code === 'POEM_NOT_FOUND' ? 'gone' : 'error',
      );
    }
  }, [fetchPoem]);

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />
          <PoemSkeleton />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'gone') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />
          <ErrorState message="This poem is no longer available." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !poem) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />
          <ErrorState message="Couldn't load this poem." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isOwner = !!user && poem.authorId === user.id;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />

        <View style={styles.headerRow}>
          {isOwner && poem.status === 'draft' ? (
            <View style={styles.badge} testID="draft-badge">
              <Text style={styles.badgeText}>Draft</Text>
            </View>
          ) : (
            <View />
          )}
          {isOwner ? (
            <Button
              label="Edit poem"
              variant="secondary"
              onPress={() => router.push(`/poem/${poem.id}/edit`)}
              testID="edit-poem"
            />
          ) : null}
        </View>

        <Text style={styles.title} testID="reader-title">
          {poem.title}
        </Text>

        <Text style={styles.byline} testID="reader-byline">
          {poem.anonymous
            ? 'Anonymous'
            : poem.author
              ? `${poem.author.displayName} · @${poem.author.username}`
              : ''}
          {poem.publishedAt ? ` · ${formatDate(poem.publishedAt)}` : ''}
        </Text>

        <Text style={styles.body} testID="reader-body">
          {poem.content}
        </Text>

        {poem.authorNote ? (
          <View style={styles.noteCard}>
            <Text style={styles.noteLabel}>{"Author's note"}</Text>
            <Text style={styles.noteText} testID="reader-author-note">
              {poem.authorNote}
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  badge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgeText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  title: {
    ...typography.title,
    color: colors.ink,
  },
  byline: {
    ...typography.body,
    color: colors.inkMuted,
  },
  body: {
    ...typography.poemBody,
    color: colors.ink,
  },
  noteCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  noteLabel: {
    ...typography.label,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  noteText: {
    ...typography.body,
    color: colors.inkSecondary,
    fontStyle: 'italic',
  },
  skeleton: {
    gap: spacing.md,
    paddingVertical: spacing.lg,
  },
  skeletonTitle: {
    height: 32,
    width: '70%',
    borderRadius: radii.sm,
    backgroundColor: colors.skeleton,
  },
  skeletonLine: {
    height: 18,
    width: '100%',
    borderRadius: radii.sm,
    backgroundColor: colors.skeleton,
  },
  skeletonLineShort: {
    width: '55%',
  },
  skeletonLineMedium: {
    width: '85%',
  },
});
