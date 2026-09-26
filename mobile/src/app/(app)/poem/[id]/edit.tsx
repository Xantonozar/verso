import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../../components/Button';
import { ErrorState } from '../../../../components/ErrorState';
import { LoadingState } from '../../../../components/LoadingState';
import { PoemEditor } from '../../../../components/PoemEditor';
import { ApiError } from '../../../../lib/api/client';
import { publishPoem, unpublishPoem } from '../../../../lib/api/engagement';
import { getPoem, Poem } from '../../../../lib/api/poems';
import { toast } from '../../../../lib/toast';
import { colors, layout, radii, spacing, typography } from '../../../../theme/tokens';

export default function EditPoemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [poem, setPoem] = useState<Poem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const fetchPoem = useCallback(async (): Promise<Poem> => getPoem(id), [id]);

  useEffect(() => {
    let cancelled = false;
    fetchPoem()
      .then((data) => {
        if (!cancelled) setPoem(data);
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
  }, [fetchPoem]);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setPoem(await fetchPoem());
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPoem]);

  const publish = async () => {
    if (!poem || publishing) return;
    setPublishing(true);
    try {
      setPoem(await publishPoem(poem.id));
      toast.success('Poem published');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VALIDATION_ERROR') {
        const details = err.details;
        const first = Array.isArray(details) ? (details[0] as { message?: string }) : undefined;
        toast.error(first?.message ?? 'Poem cannot be published');
      } else {
        toast.error(err instanceof Error && err.message ? err.message : 'Could not publish');
      }
    } finally {
      setPublishing(false);
    }
  };

  const unpublish = async () => {
    if (!poem || publishing) return;
    setPublishing(true);
    try {
      setPoem(await unpublishPoem(poem.id));
      toast.success('Poem moved back to draft');
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not unpublish');
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <LoadingState label="Loading poem..." />;
  if (loadFailed || !poem) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="editor-back" />
          <ErrorState message="Couldn't load this poem." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="editor-back" />
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Edit poem</Text>
          <View style={styles.headerRight}>
            {poem.status === 'draft' ? (
              <View style={styles.badge} testID="draft-badge">
                <Text style={styles.badgeText}>Draft</Text>
              </View>
            ) : poem.status === 'published' ? (
              <View style={styles.badge} testID="published-badge">
                <Text style={styles.badgeText}>Published</Text>
              </View>
            ) : null}
            {poem.status === 'draft' ? (
              <Button
                label="Publish"
                onPress={() => void publish()}
                loading={publishing}
                testID="poem-publish"
              />
            ) : poem.status === 'published' ? (
              <Button
                label="Unpublish"
                variant="secondary"
                onPress={() => void unpublish()}
                loading={publishing}
                testID="poem-unpublish"
              />
            ) : null}
          </View>
        </View>
        <PoemEditor poem={poem} onCreated={() => undefined} onSaved={setPoem} />
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexWrap: 'wrap',
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
  badgeText: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '600',
  },
});
