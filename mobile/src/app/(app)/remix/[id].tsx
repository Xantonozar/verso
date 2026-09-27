import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { TextField } from '../../../components/TextField';
import { getPoem, Poem } from '../../../lib/api/poems';
import { createRemix } from '../../../lib/api/remixes';
import { toast } from '../../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Remix screen (plan step 71): attribution of the original is shown BEFORE
 * submit, the editor starts from the original's title, and on success we
 * land on the new poem (which itself carries `remixOf` for readers).
 */
export default function RemixScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [original, setOriginal] = useState<Poem | null>(null);
  const [loadState, setLoadState] = useState<LoadState>(() =>
    typeof id === 'string' && id.length > 0 ? 'loading' : 'error',
  );

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id || Array.isArray(id)) return undefined;
    let cancelled = false;
    getPoem(id)
      .then((poem) => {
        if (cancelled) return;
        setOriginal(poem);
        setTitle(`${poem.title} (remix)`);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function submit() {
    if (!original || !id || Array.isArray(id)) return;
    const trimmedTitle = title.trim();
    const trimmedContent = content.trim();
    const nextErrors: FieldErrors = {};
    if (!trimmedTitle) nextErrors.title = 'is required';
    if (!trimmedContent) nextErrors.content = 'is required';
    setErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const created = await createRemix({
        originalPoemId: id,
        title: trimmedTitle,
        content: trimmedContent,
      });
      toast.success('Remix published');
      router.replace(`/poem/${created.poem.id}`);
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else {
        const mapped = mapApiFieldErrors(err);
        if (mapped) {
          const { fields, formMessage } = splitFieldErrors(mapped);
          setErrors(fields);
          if (formMessage) setFormError(formMessage);
        } else {
          setFormError("Couldn't publish the remix.");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <>
      <Button label="Back" variant="secondary" onPress={() => router.back()} testID="remix-back" />
      <Text style={styles.heading}>Remix</Text>
    </>
  );

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <LoadingState label="Loading the original..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadState === 'error' || !original) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <ErrorState message="Couldn't load the poem to remix." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {header}

        <View style={styles.attribution} testID="remix-attribution">
          <Text style={styles.attributionLabel}>Remixed from</Text>
          <Text style={styles.attributionTitle} testID="remix-original-title">
            {original.title}
          </Text>
          <Text style={styles.attributionByline} testID="remix-original-byline">
            {original.anonymous
              ? 'Anonymous'
              : original.author
                ? `${original.author.displayName} · @${original.author.username}`
                : ''}
          </Text>
        </View>

        <TextField
          label="Title"
          value={title}
          onChangeText={(value) => {
            setTitle(value);
            setErrors((prev) => {
              if (!prev.title) return prev;
              const rest = { ...prev };
              delete rest.title;
              return rest;
            });
          }}
          error={errors.title}
          placeholder="Your take on it"
          testID="remix-title"
        />
        <TextField
          label="Your version"
          value={content}
          onChangeText={(value) => {
            setContent(value);
            setErrors((prev) => {
              if (!prev.content) return prev;
              const rest = { ...prev };
              delete rest.content;
              return rest;
            });
          }}
          error={errors.content}
          placeholder="Write your remix..."
          multiline
          testID="remix-content"
        />

        {formError ? (
          <Text
            style={styles.formError}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            testID="remix-error"
          >
            {formError}
          </Text>
        ) : null}

        <Button label="Publish remix" onPress={submit} loading={submitting} testID="remix-submit" />
        <Button
          label="Cancel"
          variant="secondary"
          disabled={submitting}
          onPress={() => router.back()}
          testID="remix-cancel"
        />
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
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  attribution: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  attributionLabel: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  attributionTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
  },
  attributionByline: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
});
