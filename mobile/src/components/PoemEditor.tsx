import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError } from '../lib/api/client';
import {
  Poem,
  autosaveDraft,
  createPoem,
  updatePoem,
} from '../lib/api/poems';
import {
  clearLocalDraft,
  draftKeyFor,
  loadLocalDraft,
  LocalPoemDraft,
  saveLocalDraft,
} from '../lib/poemDrafts';
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
  /** null → create mode (first Save POSTs a new draft). */
  poem: Poem | null;
  onCreated: (poem: Poem) => void;
  onSaved: (poem: Poem) => void;
  /** Test seam — production uses the 2s plan-spec debounce. */
  autosaveDebounceMs?: number;
}

export function PoemEditor({ poem, onCreated, onSaved, autosaveDebounceMs }: Props) {
  const debounceMs = autosaveDebounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  const draftKey = draftKeyFor(poem?.id ?? null);

  const [title, setTitle] = useState(poem?.title ?? '');
  const [content, setContent] = useState(poem?.content ?? '');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [recovery, setRecovery] = useState<LocalPoemDraft | null>(null);

  const baselineRef = useRef({ title: poem?.title ?? '', content: poem?.content ?? '' });
  const latestRef = useRef({ title: poem?.title ?? '', content: poem?.content ?? '' });
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedRef = useRef(false);

  const words = useMemo(() => {
    const trimmed = content.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [content]);
  const lines = useMemo(() => (content === '' ? 0 : content.split('\n').length), [content]);

  // Offer recovery when the device holds text the server does not.
  useEffect(() => {
    let cancelled = false;
    void loadLocalDraft(draftKey).then((draft) => {
      if (cancelled || !draft) return;
      const base = baselineRef.current;
      const differs =
        draft.title.trim() !== base.title.trim() || draft.content !== base.content;
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
          void saveLocalDraft(draftKey, latest);
        }
      }
    };
  }, [draftKey]);

  function scheduleLocalDraft(next: { title: string; content: string }) {
    if (localTimer.current) clearTimeout(localTimer.current);
    if (!next.title.trim() && !next.content) return;
    localTimer.current = setTimeout(() => {
      void saveLocalDraft(draftKey, next);
    }, LOCAL_DRAFT_DEBOUNCE_MS);
  }

  async function runAutosave(next: { title: string; content: string }) {
    if (!poem) return;
    const baseline = baselineRef.current;
    const payload: { title?: string; content?: string } = {};
    if (next.title.trim()) payload.title = next.title;
    payload.content = next.content;
    const titleChanged = payload.title !== undefined && payload.title !== baseline.title;
    const contentChanged = payload.content !== undefined && payload.content !== baseline.content;
    if (!titleChanged && !contentChanged) {
      setAutosave('saved');
      return;
    }

    setAutosave('saving');
    try {
      await autosaveDraft(poem.id, payload);
      baselineRef.current = {
        title: payload.title !== undefined ? payload.title : baseline.title,
        content: payload.content !== undefined ? payload.content : baseline.content,
      };
      setAutosave('saved');
    } catch (err) {
      setAutosave('failed');
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else if (err instanceof ApiError && err.code === 'NOT_A_DRAFT')
        toast.error('Autosave only works on drafts.');
      else toast.error("Autosave failed — your text is safe on this device.");
    }
  }

  function scheduleAutosave(next: { title: string; content: string }) {
    if (!poem) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void runAutosave(next);
    }, debounceMs);
  }

  function onTitleChange(value: string) {
    clearedRef.current = false;
    setTitle(value);
    latestRef.current = { ...latestRef.current, title: value };
    setFieldErrors((prev) => {
      if (!prev.title) return prev;
      const rest = { ...prev };
      delete rest.title;
      return rest;
    });
    setAutosave('idle');
    scheduleLocalDraft({ title: value, content: latestRef.current.content });
    scheduleAutosave({ title: value, content: latestRef.current.content });
  }

  function onContentChange(value: string) {
    clearedRef.current = false;
    setContent(value);
    latestRef.current = { ...latestRef.current, content: value };
    setFieldErrors((prev) => {
      if (!prev.content) return prev;
      const rest = { ...prev };
      delete rest.content;
      return rest;
    });
    setAutosave('idle');
    scheduleLocalDraft({ title: latestRef.current.title, content: value });
    scheduleAutosave({ title: latestRef.current.title, content: value });
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = 'is required';
    else if (title.length > 200) errors.title = 'must be at most 200 characters';
    if (!content) errors.content = 'is required';
    else if (content.length > 100_000) errors.content = 'must be at most 100000 characters';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      if (poem) {
        const payload = { title: title.trim(), content };
        const updated = await updatePoem(poem.id, payload);
        baselineRef.current = { ...payload };
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        clearedRef.current = true;
        void clearLocalDraft(draftKey);
        setAutosave('saved');
        toast.success('Saved');
        onSaved(updated);
      } else {
        const created = await createPoem({ title: title.trim(), content });
        clearedRef.current = true;
        void clearLocalDraft(draftKey);
        toast.success('Draft saved');
        onCreated(created);
      }
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
          setFormError("Couldn't save your poem. Please try again.");
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
    setRecovery(null);
    setFieldErrors({});
    scheduleAutosave({ title: recovery.title, content: recovery.content });
  }

  function discardDraft() {
    void clearLocalDraft(draftKey);
    setRecovery(null);
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
        label="Title"
        value={title}
        onChangeText={onTitleChange}
        error={fieldErrors.title}
        placeholder="Give it a title"
        testID="poem-title"
      />

      <View style={styles.contentBlock}>
        <Text style={styles.label}>Poem</Text>
        <TextInput
          value={content}
          onChangeText={onContentChange}
          multiline
          placeholder={'Write it here — line breaks are kept.'}
          placeholderTextColor={colors.inkMuted}
          accessibilityLabel="Poem content"
          testID="poem-content"
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
        <Text style={styles.counter} testID="poem-counter">
          {words} words · {lines} lines
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

      <Button label="Save" onPress={save} loading={saving} testID="poem-save" />
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
    minHeight: 220,
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
});
