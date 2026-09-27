import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { FeedCard } from '../../../components/FeedCard';
import { LoadingState } from '../../../components/LoadingState';
import { ApiError } from '../../../lib/api/client';
import {
  CollectionDetail,
  getCollection,
  removePoemFromCollection,
} from '../../../lib/api/collections';
import { toast } from '../../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../../lib/validation';
import { colors, layout, spacing, typography } from '../../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'gone' | 'error';

/**
 * Collection detail (plan step 58) — hydrated poems in `poemIds` order plus
 * remove with optimistic update: the row drops immediately and rolls back to
 * the snapshot if the DELETE fails.
 */
export default function CollectionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<CollectionDetail | null>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [removingId, setRemovingId] = useState<string | null>(null);

  const fetchDetail = useCallback((): Promise<CollectionDetail> => getCollection(id), [id]);

  useEffect(() => {
    let cancelled = false;
    fetchDetail()
      .then((data) => {
        if (!cancelled) {
          setDetail(data);
          setState('ready');
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState(
            err instanceof ApiError && err.code === 'COLLECTION_NOT_FOUND' ? 'gone' : 'error',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchDetail]);

  const reload = useCallback(() => {
    setState('loading');
    fetchDetail()
      .then((data) => {
        setDetail(data);
        setState('ready');
      })
      .catch((err: unknown) => {
        setState(
          err instanceof ApiError && err.code === 'COLLECTION_NOT_FOUND' ? 'gone' : 'error',
        );
      });
  }, [fetchDetail]);

  function removePoem(poemId: string) {
    if (!detail || removingId) return;
    const snapshot = detail;
    setRemovingId(poemId);
    setDetail({
      ...detail,
      poems: detail.poems.filter((poem) => poem.id !== poemId),
      poemIds: detail.poemIds.filter((pid) => pid !== poemId),
      poemCount: Math.max(0, detail.poemCount - 1),
    });
    removePoemFromCollection(id, poemId)
      .then(() => {
        toast.success('Removed from collection');
      })
      .catch((err: unknown) => {
        setDetail(snapshot);
        toast.error(
          isConnectivityError(err) ? CONNECTIVITY_TOAST : "Couldn't remove the poem. Try again.",
        );
      })
      .finally(() => {
        setRemovingId(null);
      });
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collection-back" />
          <LoadingState label="Loading collection..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'gone') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collection-back" />
          <ErrorState message="This collection is no longer available." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !detail) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collection-back" />
          <ErrorState message="Couldn't load this collection." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collection-back" />

        <View style={styles.header} testID="collection-header">
          <Text style={styles.title}>{detail.title}</Text>
          {detail.description ? <Text style={styles.description}>{detail.description}</Text> : null}
          <Text style={styles.meta} testID="collection-meta">
            {detail.visibility.charAt(0).toUpperCase() + detail.visibility.slice(1)} ·{' '}
            {detail.poemCount} {detail.poemCount === 1 ? 'poem' : 'poems'}
          </Text>
        </View>

        {detail.poems.length === 0 ? (
          <EmptyState
            title="No poems here yet"
            subtitle="Open any poem and use Add to collection to fill this shelf."
          />
        ) : (
          <View style={styles.poemList} testID="collection-poems">
            {detail.poems.map((poem) => (
              <View key={poem.id} style={styles.poemBlock}>
                <FeedCard item={poem} testID={`collection-poem-${poem.id}`} />
                <Button
                  label="Remove"
                  variant="secondary"
                  onPress={() => removePoem(poem.id)}
                  disabled={removingId === poem.id}
                  testID={`remove-${poem.id}`}
                />
              </View>
            ))}
          </View>
        )}
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
  header: {
    gap: spacing.xs,
  },
  title: {
    ...typography.title,
    color: colors.ink,
  },
  description: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  poemList: {
    gap: spacing.lg,
  },
  poemBlock: {
    gap: spacing.sm,
  },
});
