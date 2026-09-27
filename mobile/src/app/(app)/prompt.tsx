import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { ApiError } from '../../lib/api/client';
import {
  FeedPoemItem,
  getCurrentPrompt,
  listMyPoems,
  listPromptSubmissions,
  Prompt,
  PromptSubmission,
  submitToPrompt,
} from '../../lib/api/prompts';
import { toast } from '../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error' | 'empty';
type PickerState = 'idle' | 'loading' | 'error';

/**
 * Weekly prompt screen (plan step 71): the current prompt, its submissions,
 * and the submission entry point — pick one of your published poems
 * (`GET /poems/mine`), one submission per week enforced by the server.
 */
export default function PromptScreen() {
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [items, setItems] = useState<PromptSubmission[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerState, setPickerState] = useState<PickerState>('idle');
  const [myPoems, setMyPoems] = useState<FeedPoemItem[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return getCurrentPrompt()
      .then((current) => {
        setPrompt(current);
        return listPromptSubmissions(current.id, { limit: 20 }).then((page) => {
          setItems(page.items);
          setLoadState('ready');
        });
      })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'NO_PROMPT') setLoadState('empty');
        else setLoadState('error');
      });
  }, []);

  // Effect fetch mirrors `load` without the synchronous setLoadState('loading')
  // (react-hooks/set-state-in-effect); `load` (with it) serves retry taps.
  useEffect(() => {
    let cancelled = false;
    getCurrentPrompt()
      .then((current) => {
        setPrompt(current);
        return listPromptSubmissions(current.id, { limit: 20 }).then((page) => {
          if (!cancelled) {
            setItems(page.items);
            setLoadState('ready');
          }
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.code === 'NO_PROMPT') setLoadState('empty');
        else setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openPicker() {
    setPickerOpen(true);
    setPickerState('loading');
    listMyPoems({ status: 'published', limit: 20 })
      .then((page) => {
        setMyPoems(page.items);
        setPickerState('idle');
      })
      .catch(() => {
        setPickerState('error');
      });
  }

  function closePicker() {
    if (submitting) return;
    setPickerOpen(false);
    setPickerState('idle');
  }

  async function submitPoem(picked: FeedPoemItem) {
    if (!prompt || submitting) return;
    setSubmitting(true);
    try {
      const summary = await submitToPrompt(prompt.id, picked.id);
      setPrompt({
        ...prompt,
        mySubmission: {
          id: summary.id,
          promptId: summary.promptId,
          poemId: summary.poemId,
          createdAt: summary.createdAt,
        },
      });
      setItems((prev) => [
        {
          id: summary.id,
          promptId: summary.promptId,
          poemId: summary.poemId,
          createdAt: summary.createdAt,
          poem: picked,
        },
        ...prev,
      ]);
      setPickerOpen(false);
      toast.success('Submitted to this week\u2019s prompt');
    } catch (err) {
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else if (err instanceof ApiError && err.code === 'ALREADY_SUBMITTED') {
        toast.error('You already submitted a poem');
      } else toast.error("Couldn't submit your poem");
    } finally {
      setSubmitting(false);
    }
  }

  const header = (
    <>
      <Button label="Back" variant="secondary" onPress={() => router.back()} testID="prompt-back" />
      <Text style={styles.heading}>Weekly prompt</Text>
    </>
  );

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <LoadingState label="Loading prompt..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <ErrorState message="Couldn't load this week's prompt." onRetry={load} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadState === 'empty' || !prompt) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          {header}
          <View testID="prompt-empty">
            <EmptyState
              title="No prompt this week"
              subtitle="New prompts land every week — check back soon."
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {header}

        <View style={styles.card} testID="prompt-card">
          <Text style={styles.week} testID="prompt-weekof">
            Week of {new Date(prompt.weekOf).toLocaleDateString()}
          </Text>
          <Text style={styles.text} testID="prompt-text">
            {prompt.text}
          </Text>
        </View>

        {prompt.mySubmission ? (
          <View style={styles.submitted} testID="prompt-submitted">
            <Text style={styles.submittedText}>
              Submitted — your poem is in this week&rsquo;s entries.
            </Text>
          </View>
        ) : (
          <Button
            label="Submit a poem"
            onPress={openPicker}
            testID="prompt-submit-open"
          />
        )}

        {pickerOpen ? (
          <View style={styles.picker} testID="prompt-picker">
            <Text style={styles.pickerTitle}>Pick one of your published poems</Text>
            {pickerState === 'loading' ? (
              <LoadingState label="Loading your poems..." />
            ) : pickerState === 'error' ? (
              <Text style={styles.pickerError} testID="prompt-picker-error">
                Couldn&rsquo;t load your poems.
              </Text>
            ) : myPoems.length === 0 ? (
              <Text style={styles.pickerHint} testID="prompt-picker-empty">
                Publish a poem first — submissions must be published.
              </Text>
            ) : (
              myPoems.map((poem) => (
                <Button
                  key={poem.id}
                  label={poem.title || 'Untitled'}
                  variant="secondary"
                  disabled={submitting}
                  onPress={() => submitPoem(poem)}
                  testID={`prompt-pick-${poem.id}`}
                />
              ))
            )}
            <Button
              label="Close"
              variant="secondary"
              disabled={submitting}
              onPress={closePicker}
              testID="prompt-picker-close"
            />
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Entries</Text>
          {items.length === 0 ? (
            <Text style={styles.hint} testID="prompt-submissions-empty">
              No entries yet — be the first.
            </Text>
          ) : (
            <View style={styles.list} testID="prompt-submissions">
              {items.map((item) => (
                <View key={item.id} style={styles.entry} testID={`prompt-sub-${item.id}`}>
                  <Text style={styles.entryTitle}>{item.poem.title || 'Untitled'}</Text>
                  <Text style={styles.entryMeta}>
                    {item.poem.author ? `@${item.poem.author.username}` : 'Anonymous'}
                  </Text>
                  {item.poem.excerpt ? (
                    <Text style={styles.entryExcerpt}>{item.poem.excerpt}</Text>
                  ) : null}
                </View>
              ))}
            </View>
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
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  card: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  week: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  text: {
    ...typography.title,
    fontSize: 20,
    color: colors.ink,
  },
  submitted: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  submittedText: {
    ...typography.body,
    color: colors.ink,
  },
  picker: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  pickerTitle: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  pickerError: {
    ...typography.body,
    color: colors.error,
  },
  pickerHint: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  block: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
  },
  hint: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  list: {
    gap: spacing.sm,
  },
  entry: {
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  entryTitle: {
    ...typography.title,
    fontSize: 16,
    color: colors.ink,
  },
  entryMeta: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  entryExcerpt: {
    ...typography.body,
    color: colors.inkSecondary,
  },
});
