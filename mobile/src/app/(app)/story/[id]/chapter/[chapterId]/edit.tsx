import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../../../../components/Button';
import { ChapterEditor } from '../../../../../../components/ChapterEditor';
import { ErrorState } from '../../../../../../components/ErrorState';
import { LoadingState } from '../../../../../../components/LoadingState';
import { getChapter, StoryChapter } from '../../../../../../lib/api/stories';
import { colors, layout, radii, spacing, typography } from '../../../../../../theme/tokens';

export default function EditChapterScreen() {
  const { id, chapterId } = useLocalSearchParams<{ id: string; chapterId: string }>();
  const [chapter, setChapter] = useState<StoryChapter | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const fetchChapter = useCallback(async (): Promise<StoryChapter> => getChapter(id, chapterId), [id, chapterId]);

  useEffect(() => {
    let cancelled = false;
    fetchChapter()
      .then((data) => {
        if (!cancelled) setChapter(data);
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
  }, [fetchChapter]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setChapter(await fetchChapter());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchChapter]);

  function attemptBack() {
    if (dirty) {
      setConfirmingLeave(true);
      return;
    }
    router.back();
  }

  if (loading) return <LoadingState label="Loading chapter..." />;
  if (loadFailed || !chapter) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="editor-back" />
          <ErrorState message="Couldn't load this chapter." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (confirmingLeave) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.confirmCard} testID="leave-confirm">
            <Text style={styles.confirmText}>
              You have unsaved changes. Leave the editor anyway? They are kept on this device and
              offered for recovery next time.
            </Text>
            <View style={styles.confirmActions}>
              <Button
                label="Keep editing"
                onPress={() => setConfirmingLeave(false)}
                testID="keep-editing"
              />
              <Button
                label="Leave"
                variant="secondary"
                onPress={() => {
                  setConfirmingLeave(false);
                  router.back();
                }}
                testID="leave-editor"
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.headerRow}>
          <Button label="Back" variant="secondary" onPress={attemptBack} testID="editor-back" />
          <Text style={styles.heading}>Chapter {chapter.chapterNumber}</Text>
        </View>
        <ChapterEditor storyId={id} chapter={chapter} onSaved={setChapter} onDirtyChange={setDirty} />
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
  confirmCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  confirmText: {
    ...typography.body,
    color: colors.ink,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
});
