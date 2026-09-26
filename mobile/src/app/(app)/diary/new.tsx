import { router } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { createDiary, DiaryVisibility } from '../../../lib/api/diary';
import { toast } from '../../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../../theme/tokens';

const MAX_CONTENT = 280;

/**
 * Diary composer (plan step 52) — deliberately NOT the PoemEditor: a diary
 * post is a single trimmed line (1-280 chars, server-enforced), no title,
 * no moods/tags, no autosave. Public/followers only; the server has no
 * private/unlisted diary.
 */
export default function NewDiaryScreen() {
  const [content, setContent] = useState('');
  const [visibility, setVisibility] = useState<DiaryVisibility>('public');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  function onContentChange(value: string) {
    setContent(value);
    setFieldErrors((prev) => {
      if (!prev.content) return prev;
      const rest = { ...prev };
      delete rest.content;
      return rest;
    });
  }

  async function post() {
    const trimmed = content.trim();
    const errors: FieldErrors = {};
    if (!trimmed) errors.content = 'is required';
    else if (content.length > MAX_CONTENT)
      errors.content = `must be at most ${MAX_CONTENT} characters`;
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setPosting(true);
    try {
      await createDiary({ content: trimmed, visibility });
      toast.success('Posted to your diary');
      router.back();
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else {
        const mapped = mapApiFieldErrors(err);
        if (mapped) {
          const { fields, formMessage } = splitFieldErrors(mapped);
          setFieldErrors(fields);
          if (formMessage) setFormError(formMessage);
        } else {
          setFormError("Couldn't post your diary line. Please try again.");
        }
      }
    } finally {
      setPosting(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="diary-back" />
        <Text style={styles.heading}>New diary</Text>
        <Text style={styles.subtitle} testID="diary-subtitle">
          One line for today.
        </Text>

        <View style={styles.contentBlock}>
          <TextInput
            value={content}
            onChangeText={onContentChange}
            multiline
            maxLength={MAX_CONTENT}
            placeholder="What happened, in one line?"
            placeholderTextColor={colors.inkMuted}
            accessibilityLabel="Diary entry"
            testID="diary-content"
            textAlignVertical="top"
            style={[styles.contentInput, fieldErrors.content && styles.inputError]}
          />
          <Text style={styles.counter} testID="diary-counter">
            {content.length}/{MAX_CONTENT}
          </Text>
          {fieldErrors.content ? (
            <Text
              style={styles.fieldError}
              accessibilityLiveRegion="polite"
              accessibilityRole="alert"
              testID="diary-content-error"
            >
              {fieldErrors.content}
            </Text>
          ) : null}
        </View>

        <View style={styles.visibilityBlock}>
          <Text style={styles.label}>Who can read this</Text>
          <View style={styles.visibilityRow}>
            <Button
              label="Public"
              variant={visibility === 'public' ? 'primary' : 'secondary'}
              onPress={() => setVisibility('public')}
              style={styles.visibilityButton}
              testID="diary-visibility-public"
            />
            <Button
              label="Followers"
              variant={visibility === 'followers' ? 'primary' : 'secondary'}
              onPress={() => setVisibility('followers')}
              style={styles.visibilityButton}
              testID="diary-visibility-followers"
            />
          </View>
        </View>

        {formError ? (
          <Text
            style={styles.formError}
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
            testID="diary-form-error"
          >
            {formError}
          </Text>
        ) : null}

        <Button label="Post" onPress={post} loading={posting} testID="diary-post" />
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
  subtitle: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  contentBlock: {
    gap: spacing.xs,
  },
  contentInput: {
    minHeight: 120,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    ...typography.body,
    color: colors.ink,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: colors.error,
  },
  counter: {
    ...typography.caption,
    color: colors.inkMuted,
    textAlign: 'right',
  },
  label: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  visibilityBlock: {
    gap: spacing.sm,
  },
  visibilityRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  visibilityButton: {
    flex: 1,
  },
  fieldError: {
    ...typography.caption,
    color: colors.error,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
});
