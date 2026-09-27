import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { CommentThread } from '../../../components/engage/CommentThread';
import { FeltGoodCard } from '../../../components/engage/FeltGoodCard';
import { ReactionBar } from '../../../components/engage/ReactionBar';
import { SaveButton } from '../../../components/engage/SaveButton';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { useAuth } from '../../../context/AuthContext';
import { ApiError } from '../../../lib/api/client';
import {
  addPoemToCollection,
  CollectionSummary,
  listCollections,
  removePoemFromCollection,
} from '../../../lib/api/collections';
import { getMobilePoem, MobilePoemResponse } from '../../../lib/api/engagement';
import { toast } from '../../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../../lib/validation';
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
  const [mobile, setMobile] = useState<MobilePoemResponse | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCollections, setPickerCollections] = useState<CollectionSummary[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const fetchPoem = useCallback(async (): Promise<MobilePoemResponse> => getMobilePoem(id), [id]);

  useEffect(() => {
    let cancelled = false;
    fetchPoem()
      .then((data) => {
        if (!cancelled) {
          setMobile(data);
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
      setMobile(await fetchPoem());
      setState('ready');
    } catch (err) {
      setState(
        err instanceof ApiError && err.code === 'POEM_NOT_FOUND' ? 'gone' : 'error',
      );
    }
  }, [fetchPoem]);

  function openPicker() {
    setPickerOpen(true);
    setPickerCollections(null);
    setPickerError(null);
    listCollections()
      .then((page) => {
        setPickerCollections(page.items);
      })
      .catch(() => {
        setPickerError("Couldn't load your collections.");
      });
  }

  function toggleCollection(collection: CollectionSummary) {
    if (!mobile || !pickerCollections || togglingId) return;
    const poemId = mobile.poem.id;
    const wasIn = collection.poemIds.includes(poemId);

    const applyMembership = (rows: CollectionSummary[], inCollection: boolean) =>
      rows.map((row) => {
        if (row.id !== collection.id) return row;
        const poemIds = inCollection
          ? row.poemIds.includes(poemId)
            ? row.poemIds
            : [...row.poemIds, poemId]
          : row.poemIds.filter((pid) => pid !== poemId);
        return { ...row, poemIds, poemCount: poemIds.length };
      });

    setPickerCollections(applyMembership(pickerCollections, !wasIn));
    setTogglingId(collection.id);
    const request = wasIn
      ? removePoemFromCollection(collection.id, poemId)
      : addPoemToCollection(collection.id, poemId);
    request
      .then(() => {
        toast.success(wasIn ? 'Removed from collection' : 'Added to collection');
      })
      .catch((err: unknown) => {
        setPickerCollections((prev) => (prev ? applyMembership(prev, wasIn) : prev));
        toast.error(
          isConnectivityError(err) ? CONNECTIVITY_TOAST : "Couldn't update the collection. Try again.",
        );
      })
      .finally(() => {
        setTogglingId(null);
      });
  }

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

  if (state === 'error' || !mobile) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />
          <ErrorState message="Couldn't load this poem." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const poem = mobile.poem;
  const viewer = mobile.viewer;
  const isOwner = !!user && poem.authorId === user.id;
  const interactive = viewer !== null;

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

        {user ? (
          <Button
            label="Add to collection"
            variant="secondary"
            onPress={openPicker}
            testID="add-to-collection"
          />
        ) : null}

        <View style={styles.engagement} testID="reader-engagement">
          <ReactionBar
            poemId={poem.id}
            counts={mobile.reactionCounts}
            active={viewer?.reactions ?? []}
            interactive={interactive}
          />
          <FeltGoodCard
            poemId={poem.id}
            summary={mobile.feltGood}
            initialScore={viewer?.feltGood?.score ?? null}
            interactive={interactive}
          />
          {viewer ? (
            <SaveButton
              poemId={poem.id}
              initialSaved={viewer.saved}
              initialCount={poem.stats?.saveCount ?? 0}
            />
          ) : null}
          <CommentThread
            poemId={poem.id}
            interactive={interactive}
            currentUserId={viewer ? user?.id : undefined}
            commentCount={poem.stats?.commentCount ?? 0}
          />
        </View>
      </ScrollView>

      <Modal
        visible={pickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add to collection</Text>
            {pickerCollections === null ? (
              <LoadingState label="Loading collections..." />
            ) : pickerError ? (
              <ErrorState message={pickerError} onRetry={openPicker} />
            ) : pickerCollections.length === 0 ? (
              <EmptyState
                title="No collections yet"
                subtitle="Create one from your profile first."
              />
            ) : (
              pickerCollections.map((collection) => {
                const inCollection = collection.poemIds.includes(poem.id);
                return (
                  <Button
                    key={collection.id}
                    label={inCollection ? `✓ ${collection.title}` : collection.title}
                    variant={inCollection ? 'primary' : 'secondary'}
                    onPress={() => toggleCollection(collection)}
                    disabled={togglingId === collection.id}
                    testID={`pick-${collection.id}`}
                  />
                );
              })
            )}
            <Button
              label="Close"
              variant="secondary"
              onPress={() => setPickerOpen(false)}
              testID="picker-close"
            />
          </View>
        </View>
      </Modal>
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
  engagement: {
    gap: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.xl,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
    marginBottom: spacing.xs,
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
