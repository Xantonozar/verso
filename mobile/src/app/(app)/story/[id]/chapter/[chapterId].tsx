import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../../../components/Button';
import { ErrorState } from '../../../../../components/ErrorState';
import { LoadingState } from '../../../../../components/LoadingState';
import {
  getChapter,
  listChapters,
  getStory,
  Story,
  StoryChapter,
  StoryChapterSummary,
} from '../../../../../lib/api/stories';
import { saveReadingPosition } from '../../../../../lib/storyDrafts';
import { colors, layout, radii, spacing, typography } from '../../../../../theme/tokens';

interface Neighbours {
  prev: StoryChapterSummary | null;
  next: StoryChapterSummary | null;
}

/**
 * Reader (plan 2B.6): one chapter, prev/next navigation, "Chapter x of y"
 * progress, and a persisted reading position so the owner can resume. An
 * unavailable chapter (deleted/removed/invisible) renders the error state —
 * existence is never leaked (fail-closed 404 from the server).
 */
export default function StoryChapterReaderScreen() {
  const { id, chapterId } = useLocalSearchParams<{ id: string; chapterId: string }>();
  const [story, setStory] = useState<Story | null>(null);
  const [chapter, setChapter] = useState<StoryChapter | null>(null);
  const [neighbours, setNeighbours] = useState<Neighbours>({ prev: null, next: null });
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchAll = useCallback(async () => {
    const [storyData, chapterData] = await Promise.all([getStory(id), getChapter(id, chapterId)]);
    const n = chapterData.chapterNumber;
    const [around, prevPage] = await Promise.all([
      listChapters(id, { cursor: String(Math.max(0, n - 1)), limit: 2 }),
      n > 1 ? listChapters(id, { cursor: String(n - 2), limit: 1 }) : null,
    ]);
    return {
      story: storyData,
      chapter: chapterData,
      prev: prevPage?.items[0] ?? null,
      next: around.items.find((c) => c.chapterNumber === n + 1) ?? null,
    };
  }, [id, chapterId]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then((data) => {
        if (cancelled) return;
        setStory(data.story);
        setChapter(data.chapter);
        setNeighbours({ prev: data.prev, next: data.next });
        void saveReadingPosition(id, chapterId);
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
  }, [fetchAll, id, chapterId]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const data = await fetchAll();
      setStory(data.story);
      setChapter(data.chapter);
      setNeighbours({ prev: data.prev, next: data.next });
      void saveReadingPosition(id, chapterId);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchAll, id, chapterId]);

  if (loading) return <LoadingState label="Loading chapter..." />;
  if (loadFailed || !chapter || !story) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />
          <ErrorState message="This chapter isn't available right now." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const total = story.chapterCount;
  const position = chapter.chapterNumber;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="reader-back" />
          <Text style={styles.progress} testID="reader-progress">
            Chapter {position} of {total}
          </Text>
        </View>

        <Text style={styles.storyTitle}>{story.title}</Text>
        <Text style={styles.chapterTitle} testID="chapter-title">
          {chapter.title || `Chapter ${position}`}
        </Text>

        <Text style={styles.body} testID="chapter-content">
          {chapter.content}
        </Text>

        <View style={styles.navRow}>
          <Button
            label="← Previous"
            variant="secondary"
            disabled={!neighbours.prev}
            onPress={() =>
              neighbours.prev && router.replace(`/story/${id}/chapter/${neighbours.prev.id}`)
            }
            testID="nav-prev"
          />
          <Button
            label="Next →"
            disabled={!neighbours.next}
            onPress={() =>
              neighbours.next && router.replace(`/story/${id}/chapter/${neighbours.next.id}`)
            }
            testID="nav-next"
          />
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
  progress: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  storyTitle: {
    ...typography.caption,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  chapterTitle: {
    ...typography.title,
    color: colors.ink,
  },
  body: {
    ...typography.poemBody,
    color: colors.ink,
    minHeight: 200,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
    borderRadius: radii.sm,
  },
});
