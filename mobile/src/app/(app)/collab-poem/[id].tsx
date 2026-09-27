import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../../context/AuthContext';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { TextField } from '../../../components/TextField';
import { ApiError } from '../../../lib/api/client';
import {
  addCollabTurn,
  CollabPoem,
  finishCollabPoem,
  getCollabPoem,
} from '../../../lib/api/collab';
import { toast } from '../../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'gone' | 'error';

/** Mirrors the server's line counter (plan step 63): CRLF-normalized, one
 * trailing newline dropped, interior blanks count. */
export function countTurnLines(content: string): number {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n$/, '');
  return normalized.split('\n').length;
}

/**
 * Relay collab poem (plan step 66): whose-turn/open-ended indicator, the
 * appended turn list, an exact-line-count composer, and creator-only finish.
 */
export default function CollabPoemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [poem, setPoem] = useState<CollabPoem | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  const [content, setContent] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);

  const fetchPoem = useCallback((): Promise<CollabPoem> => getCollabPoem(id), [id]);

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
            err instanceof ApiError && err.code === 'COLLAB_NOT_FOUND' ? 'gone' : 'error',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPoem]);

  function reload() {
    setState('loading');
    fetchPoem()
      .then((data) => {
        setPoem(data);
        setState('ready');
      })
      .catch((err: unknown) => {
        setState(
          err instanceof ApiError && err.code === 'COLLAB_NOT_FOUND' ? 'gone' : 'error',
        );
      });
  }

  const lineCount = countTurnLines(content);

  async function submitTurn() {
    if (!poem || submitting) return;
    const errors: FieldErrors = {};
    if (!content.trim()) errors.content = 'is required';
    else if (lineCount !== poem.linesPerTurn)
      errors.content = `needs exactly ${poem.linesPerTurn} lines (you have ${lineCount})`;
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const updated = await addCollabTurn(poem.id, content);
      setPoem(updated);
      setContent('');
      toast.success('Turn added');
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else {
        const mapped = mapApiFieldErrors(err);
        if (mapped) {
          const { fields, formMessage } = splitFieldErrors(mapped);
          setFieldErrors(fields);
          if (formMessage) setFormError(formMessage);
        } else if (err instanceof ApiError && err.code === 'COLLAB_FINISHED') {
          reload();
        } else {
          setFormError("Couldn't add the turn. Please try again.");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function finish() {
    if (!poem || finishing) return;
    setFinishing(true);
    try {
      setPoem(await finishCollabPoem(poem.id));
      toast.success('Relay poem finished');
    } catch (err) {
      toast.error(
        isConnectivityError(err)
          ? CONNECTIVITY_TOAST
          : err instanceof ApiError && err.code === 'FORBIDDEN'
            ? 'Only the creator can finish this poem.'
            : "Couldn't finish the poem. Try again.",
      );
    } finally {
      setFinishing(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="cp-back" />
          <LoadingState label="Loading relay poem..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'gone') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="cp-back" />
          <ErrorState message="This relay poem is no longer available." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !poem) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="cp-back" />
          <ErrorState message="Couldn't load this relay poem." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const isCreator = user != null && user.id === poem.creatorId;
  const lastTurn = poem.turns.length > 0 ? poem.turns[poem.turns.length - 1] : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="cp-back" />
        <Text style={styles.heading} testID="cp-title">
          {poem.title}
        </Text>

        <View style={styles.indicator} testID="cp-indicator">
          <Text style={styles.indicatorText} accessibilityRole="text">
            {poem.status === 'open'
              ? `Open — anyone can add the next ${poem.linesPerTurn} ${
                  poem.linesPerTurn === 1 ? 'line' : 'lines'
                }`
              : 'Finished by the creator — no more turns'}
          </Text>
          {lastTurn ? (
            <Text style={styles.indicatorSub} testID="cp-last-turn">
              Last turn: {lastTurn.author?.displayName ?? 'Unknown'}
            </Text>
          ) : (
            <Text style={styles.indicatorSub} testID="cp-last-turn">
              No turns yet — the opener sets the tone
            </Text>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>
            Turns ({poem.turnCount}, {poem.linesPerTurn} lines each)
          </Text>
          {poem.turns.map((turn) => (
            <View key={turn.order} style={styles.turn} testID={`cp-turn-${turn.order}`}>
              <Text style={styles.turnAuthor}>
                {turn.author?.displayName ?? 'Unknown'} · turn {turn.order + 1}
              </Text>
              <Text style={styles.turnLines} testID={`cp-turn-lines-${turn.order}`}>
                {turn.lines}
              </Text>
            </View>
          ))}
        </View>

        {poem.status === 'open' ? (
          <View style={styles.form}>
            <Text style={styles.formTitle}>Add a turn</Text>
            <TextField
              label={`Your ${poem.linesPerTurn} lines`}
              value={content}
              onChangeText={(value) => {
                setContent(value);
                setFieldErrors((prev) => {
                  if (!prev.content) return prev;
                  const rest = { ...prev };
                  delete rest.content;
                  return rest;
                });
              }}
              error={fieldErrors.content}
              placeholder={Array.from({ length: poem.linesPerTurn }, (_, i) => `line ${i + 1}`).join('\n')}
              multiline
              testID="cp-content"
            />
            <Text
              style={[styles.lineCount, lineCount === poem.linesPerTurn && styles.lineCountOk]}
              testID="cp-line-count"
            >
              {lineCount}/{poem.linesPerTurn} lines
            </Text>
            {formError ? (
              <Text
                style={styles.formError}
                accessibilityLiveRegion="polite"
                accessibilityRole="alert"
                testID="cp-form-error"
              >
                {formError}
              </Text>
            ) : null}
            <Button
              label="Add turn"
              onPress={submitTurn}
              loading={submitting}
              testID="cp-add-turn"
            />
          </View>
        ) : null}

        {isCreator && poem.status === 'open' ? (
          <Button
            label="Finish poem"
            variant="secondary"
            onPress={finish}
            loading={finishing}
            testID="cp-finish"
          />
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
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  indicator: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  indicatorText: {
    ...typography.body,
    color: colors.ink,
    fontWeight: '600',
  },
  indicatorSub: {
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
  turn: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  turnAuthor: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  turnLines: {
    ...typography.body,
    color: colors.ink,
  },
  form: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  formTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
  },
  lineCount: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  lineCountOk: {
    color: colors.success ?? colors.ink,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
});
