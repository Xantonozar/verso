import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../lib/api/client';
import { autosaveChapterDraft, StoryChapter, updateChapter } from '../lib/api/stories';
import {
  chapterDraftKeyFor,
  clearLocalChapterDraft,
  loadLocalChapterDraft,
  LocalChapterDraft,
  saveLocalChapterDraft,
} from '../lib/storyDrafts';
import { toast } from '../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../lib/validation';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { Button } from './Button';
import { TextField } from './TextField';

const DEFAULT_AUTOSAVE_DEBOUNCE_MS = 2000;
const LOCAL_DRAFT_DEBOUNCE_MS = 400;

type AutosaveState = 'idle' | 'saving' | 'saved' | 'failed';

interface Props {
  storyId: string;
  chapter: StoryChapter;
  onSaved: (chapter: StoryChapter) => void;
  /** Fires whenever the working text diverges from / returns to the server copy. */
  onDirtyChange?: (dirty: boolean) => void;
  /** Test seam — production uses the 2s plan-spec debounce. */
  autosaveDebounceMs?: number;
}

export function ChapterEditor({
  storyId,
  chapter,
  onSaved,
  onDirtyChange,
  autosaveDebounceMs,
}: Props) {
  const debounceMs = autosaveDebounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  const draftKey = chapterDraftKeyFor(storyId, chapter.id);

  const [title, setTitle] = useState(chapter.title ?? '');
  const [content, setContent] = useState(chapter.content ?? '');
  const [preview, setPreview] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [recovery, setRecovery] = useState<LocalChapterDraft | null>(null);

  const baselineRef = useRef({ title: chapter.title ?? '', content: chapter.content ?? '' });
  const latestRef = useRef({ title: chapter.title ?? '', content: chapter.content ?? '' });
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedRef = useRef(false);

  const words = useMemo(() => {
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [content]);

  function markDirty(next: { title: string; content: string }) {
    const base = baselineRef.current;
    onDirtyChange?.(next.title !== base.title || next.content !== base.content);
  }

  // Offer recovery when the device holds text the server does not.
  useEffect(() => {
    let cancelled = false;
    void loadLocalChapterDraft(draftKey).then((draft) => {
      if (cancelled || !draft) return;
      const base = baselineRef.current;
      const differs = draft.title !== base.title || draft.content !== base.content;
      const hasText = draft.title.trim() !== '' || draft.content.trim() !== '';
      if (differs && hasText) setRecovery(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (localTimer.current) clearTimeout(localTimer.current);
      if (!clearedRef.current) {
        const latest = latestRef.current;
        if (latest.title.trim() || latest.content) {
          void saveLocalChapterDraft(draftKey, latest);
        }
      }
    };
  }, [draftKey]);

  function scheduleLocalDraft(next: { title: string; content: string }) {
    if (localTimer.current) clearTimeout(localTimer.current);
    if (!next.title.trim() && !next.content) return;
    localTimer.current = setTimeout(() => {
      void saveLocalChapterDraft(draftKey, next);
    }, LOCAL_DRAFT_DEBOUNCE_MS);
  }

  async function runAutosave(next: { title: string; content: string }) {
    const baseline = baselineRef.current;
    if (next.title === baseline.title && next.content === baseline.content) {
      setAutosave('saved');
      return;
    }

    setAutosave('saving');
    try {
      await autosaveChapterDraft(storyId, chapter.id, next);
      baselineRef.current = { ...next };
      markDirty(latestRef.current);
      setAutosave('saved');
    } catch (err) {
      setAutosave('failed');
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else if (err instanceof ApiError && err.code === 'NOT_A_DRAFT')
        toast.error('Autosave only works on unpublished stories.');
      else toast.error("Autosave failed — your text is safe on this device.");
    }
  }

  function scheduleAutosave(next: { title: string; content: string }) {
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void runAutosave(next);
    }, debounceMs);
  }

  function onTitleChange(value: string) {
    clearedRef.current = false;
    setTitle(value);
    const next = { ...latestRef.current, title: value };
    latestRef.current = next;
    markDirty(next);
    setFieldErrors((prev) => {
      if (!prev.title) return prev;
      const rest = { ...prev };
      delete rest.title;
      return rest;
    });
    setAutosave('idle');
    scheduleLocalDraft(next);
    scheduleAutosave(next);
  }

  function onContentChange(value: string) {
    clearedRef.current = false;
    setContent(value);
    const next = { ...latestRef.current, content: value };
    latestRef.current = next;
    markDirty(next);
    setFieldErrors((prev) => {
      if (!prev.content) return prev;
      const rest = { ...prev };
      delete rest.content;
      return rest;
    });
    setAutosave('idle');
    scheduleLocalDraft(next);
    scheduleAutosave(next);
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (title.length > 200) errors.title = 'must be at most 200 characters';
    if (content.length > 300_000) errors.content = 'must be at most 300000 characters';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const payload = { title: title.trim(), content };
      const updated = await updateChapter(storyId, chapter.id, payload);
      baselineRef.current = { ...payload };
      latestRef.current = { ...payload };
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      clearedRef.current = true;
      void clearLocalChapterDraft(draftKey);
      setAutosave('saved');
      onDirtyChange?.(false);
      toast.success('Chapter saved');
      onSaved(updated);
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
          setFormError("Couldn't save this chapter. Please try again.");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  function recoverDraft() {
    if (!recovery) return;
    setTitle(recovery.title);
    setContent(recovery.content);
    latestRef.current = { title: recovery.title, content: recovery.content };
    markDirty(latestRef.current);
    setRecovery(null);
    setFieldErrors({});
    scheduleAutosave({ title: recovery.title, content: recovery.content });
  }

  function discardDraft() {
    void clearLocalChapterDraft(draftKey);
    setRecovery(null);
  }

  if (preview) {
    return (
      <View style={styles.container}>
        <View style={styles.previewBanner} testID="preview-banner">
          <Text style={styles.previewLabel}>Preview</Text>
          <Button label="Back to editing" variant="secondary" onPress={() => setPreview(false)} testID="preview-off" />
        </View>
        <Text style={styles.previewTitle} testID="preview-title">
          {title || chapter.title || `Chapter ${chapter.chapterNumber}`}
        </Text>
        <Text style={styles.previewBody} testID="preview-body">
          {content}
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {recovery ? (
        <View style={styles.recovery} testID="draft-recovery">
          <Text style={styles.recoveryText}>
            Recover unsaved changes from your last session?
          </Text>
          <View style={styles.recoveryActions}>
            <Button label="Recover" onPress={recoverDraft} testID="recover-draft" />
            <Button
              label="Discard"
              variant="secondary"
              onPress={discardDraft}
              testID="discard-draft"
            />
          </View>
        </View>
      ) : null}

      <TextField
        label="Chapter title"
        value={title}
        onChangeText={onTitleChange}
        error={fieldErrors.title}
        placeholder="Chapter One"
        testID="chapter-title-input"
      />

      <View style={styles.contentBlock}>
        <Text style={styles.label}>Chapter</Text>
        <TextInput
          value={content}
          onChangeText={onContentChange}
          multiline
          placeholder={'Write the chapter here — line breaks are kept.'}
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Chapter content"
          testID="chapter-content-input"
          textAlignVertical="top"
          style={[styles.contentInput, fieldErrors.content && styles.inputError]}
        />
        {fieldErrors.content ? (
          <Text style={styles.fieldError} accessibilityLiveRegion="polite" accessibilityRole="alert">
            {fieldErrors.content}
          </Text>
        ) : null}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.counter} testID="chapter-counter">
          {words} words
        </Text>
        {autosave === 'saving' ? (
          <Text style={styles.indicator} testID="autosave-indicator">
            Saving…
          </Text>
        ) : autosave === 'saved' ? (
          <Text style={styles.indicator} testID="autosave-indicator">
            Saved
          </Text>
        ) : autosave === 'failed' ? (
          <Text style={styles.indicatorError} testID="autosave-indicator">
            Autosave failed
          </Text>
        ) : null}
      </View>

      {formError ? (
        <Text style={styles.formError} accessibilityRole="alert">
          {formError}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Button label="Save" onPress={save} loading={saving} testID="chapter-save" />
        <Button label="Preview" variant="secondary" onPress={() => setPreview(true)} testID="preview-on" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  label: {
    ...typography.label,
    color: colors.inkSecondary,
    marginBottom: spacing.xs,
  },
  contentBlock: {
    gap: spacing.xs,
  },
  contentInput: {
    minHeight: 260,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: spacing.md,
    ...typography.poemBody,
    color: colors.ink,
  },
  inputError: {
    borderColor: colors.error,
  },
  fieldError: {
    ...typography.caption,
    color: colors.error,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  counter: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  indicator: {
    ...typography.caption,
    color: colors.success,
  },
  indicatorError: {
    ...typography.caption,
    color: colors.error,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  recovery: {
    backgroundColor: colors.accentSoft,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  recoveryText: {
    ...typography.body,
    color: colors.ink,
  },
  recoveryActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    flexWrap: 'wrap',
  },
  previewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  previewLabel: {
    ...typography.caption,
    color: colors.accent,
    textTransform: 'uppercase',
  },
  previewTitle: {
    ...typography.title,
    color: colors.ink,
  },
  previewBody: {
    ...typography.poemBody,
    color: colors.ink,
    minHeight: 200,
  },
});
