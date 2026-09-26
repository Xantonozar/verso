import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../../components/Button';
import { ErrorState } from '../../../../components/ErrorState';
import { LoadingState } from '../../../../components/LoadingState';
import { StoryEditor } from '../../../../components/StoryEditor';
import {
  createChapter,
  getStory,
  listChapters,
  publishStory,
  reorderChapters,
  Story,
  StoryChapterSummary,
  unpublishStory,
} from '../../../../lib/api/stories';
import { loadReadingPosition } from '../../../../lib/storyDrafts';
import { ApiError } from '../../../../lib/api/client';
import { toast } from '../../../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../../../theme/tokens';

export default function EditStoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [story, setStory] = useState<Story | null>(null);
  const [chapters, setChapters] = useState<StoryChapterSummary[]>([]);
  const [resumeChapterId, setResumeChapterId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const fetchAll = useCallback(async () => {
    const [storyData, chapterPage, position] = await Promise.all([
      getStory(id),
      listChapters(id, { limit: 50 }),
      loadReadingPosition(id),
    ]);
    return { story: storyData, chapters: chapterPage.items, position };
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((data) => {
        if (cancelled) return;
        setStory(data.story);
        setChapters(data.chapters);
        if (data.position && data.chapters.some((c) => c.id === data.position)) {
          setResumeChapterId(data.position);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await fetchAll();
      setStory(data.story);
      setChapters(data.chapters);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchAll]);

  async function runBusy(action: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    try {
      await action();
      return true;
    } catch (err) {
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else if (err instanceof ApiError && err.status === 400) {
        const details = err.details;
        const first = Array.isArray(details)
          ? (details as { message?: string }[])[0]?.message
          : undefined;
        toast.error(first ? `Can't publish: ${first}` : err.message);
      } else if (err instanceof ApiError && err.code === 'ALREADY_PUBLISHED') {
        toast.error('This story is already published.');
      } else if (err instanceof ApiError && err.code === 'NOT_PUBLISHED') {
        toast.error('This story is not published.');
      } else {
        toast.error('That action failed. Please try again.');
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handlePublish() {
    await runBusy(async () => {
      setStory(await publishStory(id));
      toast.success('Story published');
    });
  }

  async function handleUnpublish() {
    await runBusy(async () => {
      setStory(await unpublishStory(id, 'draft'));
      toast.success('Story moved back to draft');
    });
  }

  async function handleNewChapter() {
    await runBusy(async () => {
      const chapter = await createChapter(id, { title: '' });
      setChapters((prev) => [
        ...prev,
        {
          id: chapter.id,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title,
          wordCount: chapter.wordCount,
          updatedAt: chapter.updatedAt,
        },
      ]);
      router.push(`/story/${id}/chapter/${chapter.id}/edit`);
    });
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= chapters.length) return;
    const next = [...chapters];
    [next[index], next[target]] = [next[target], next[index]];
    const previous = chapters;
    setChapters(next); // optimistic
    const ok = await runBusy(async () => {
      const result = await reorderChapters(
        id,
        next.map((c) => c.id),
      );
      setChapters(result.items);
    });
    if (!ok) setChapters(previous);
  }

  if (loading) return <LoadingState label="Loading story..." />;
  if (loadFailed || !story) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="editor-back" />
          <ErrorState message="Couldn't load this story." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isPublished = story.status === 'published';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="editor-back" />
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Edit story</Text>
          <View
            style={[styles.badge, isPublished && styles.badgePublished]}
            testID="status-badge"
          >
            <Text style={[styles.badgeText, isPublished && styles.badgeTextPublished]}>
              {isPublished ? 'Published' : story.status === 'unlisted' ? 'Unlisted' : 'Draft'}
            </Text>
          </View>
        </View>

        <StoryEditor story={story} onCreated={() => undefined} onSaved={setStory} />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Chapters</Text>
          <Text style={styles.sectionMeta} testID="chapter-count">
            {story.chapterCount} total
          </Text>
        </View>

        {chapters.length === 0 ? (
          <Text style={styles.emptyChapters} testID="empty-chapters">
            No chapters yet — add the first one to start writing.
          </Text>
        ) : (
          <View style={styles.chapterList}>
            {chapters.map((chapter, index) => (
              <View key={chapter.id} style={styles.chapterRow} testID={`chapter-row-${index}`}>
                <View style={styles.chapterInfo}>
                  <Text style={styles.chapterNumber}>{chapter.chapterNumber}</Text>
                  <View style={styles.chapterTexts}>
                    <Text style={styles.chapterTitle} numberOfLines={1}>
                      {chapter.title || 'Untitled chapter'}
                    </Text>
                    <Text style={styles.chapterMeta}>{chapter.wordCount} words</Text>
                  </View>
                </View>
                <View style={styles.chapterActions}>
                  <Button
                    label="↑"
                    variant="secondary"
                    disabled={index === 0 || busy}
                    onPress={() => move(index, -1)}
                    testID={`chapter-up-${index}`}
                  />
                  <Button
                    label="↓"
                    variant="secondary"
                    disabled={index === chapters.length - 1 || busy}
                    onPress={() => move(index, 1)}
                    testID={`chapter-down-${index}`}
                  />
                  <Button
                    label="Edit"
                    variant="secondary"
                    onPress={() => router.push(`/story/${id}/chapter/${chapter.id}/edit`)}
                    testID={`chapter-edit-${index}`}
                  />
                  <Button
                    label="Read"
                    variant="secondary"
                    onPress={() => router.push(`/story/${id}/chapter/${chapter.id}`)}
                    testID={`chapter-read-${index}`}
                  />
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.actions}>
          <Button label="+ New chapter" onPress={handleNewChapter} loading={busy} testID="new-chapter" />
          {resumeChapterId ? (
            <Button
              label="Resume reading"
              variant="secondary"
              onPress={() => router.push(`/story/${id}/chapter/${resumeChapterId}`)}
              testID="resume-reading"
            />
          ) : null}
          {isPublished ? (
            <Button
              label="Unpublish"
              variant="secondary"
              onPress={handleUnpublish}
              loading={busy}
              testID="unpublish-story"
            />
          ) : (
            <Button label="Publish" onPress={handlePublish} loading={busy} testID="publish-story" />
          )}
        </View>
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
  },
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  badge: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  badgePublished: {
    backgroundColor: colors.success,
  },
  badgeText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
  },
  badgeTextPublished: {
    color: colors.surface,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 20,
    color: colors.ink,
  },
  sectionMeta: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  emptyChapters: {
    ...typography.body,
    color: colors.inkMuted,
  },
  chapterList: {
    gap: spacing.sm,
  },
  chapterRow: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  chapterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  chapterNumber: {
    ...typography.title,
    fontSize: 18,
    color: colors.accent,
    minWidth: 28,
    textAlign: 'center',
  },
  chapterTexts: {
    flex: 1,
    gap: 2,
  },
  chapterTitle: {
    ...typography.body,
    color: colors.ink,
    fontWeight: '600',
  },
  chapterMeta: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  chapterActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
