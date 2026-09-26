import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../lib/api/client';
import {
  Story,
  autosaveStoryDraft,
  createStory,
  updateStory,
} from '../lib/api/stories';
import {
  clearLocalStoryDraft,
  loadLocalStoryDraft,
  LocalStoryDraft,
  saveLocalStoryDraft,
  storyDraftKeyFor,
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
  /** null → create mode (first Save POSTs a new draft story). */
  story: Story | null;
  onCreated: (story: Story) => void;
  onSaved: (story: Story) => void;
  /** Test seam — production uses the 2s plan-spec debounce. */
  autosaveDebounceMs?: number;
}

function parseTags(raw: string): string[] {
  return raw
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

export function StoryEditor({ story, onCreated, onSaved, autosaveDebounceMs }: Props) {
  const debounceMs = autosaveDebounceMs ?? DEFAULT_AUTOSAVE_DEBOUNCE_MS;
  const draftKey = storyDraftKeyFor(story?.id ?? null);

  const [title, setTitle] = useState(story?.title ?? '');
  const [synopsis, setSynopsis] = useState(story?.synopsis ?? '');
  const [coverUrl, setCoverUrl] = useState(story?.coverUrl ?? '');
  const [tagsRaw, setTagsRaw] = useState((story?.tags ?? []).join(', '));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [autosave, setAutosave] = useState<AutosaveState>('idle');
  const [recovery, setRecovery] = useState<LocalStoryDraft | null>(null);

  const baselineRef = useRef({ title: story?.title ?? '', synopsis: story?.synopsis ?? '' });
  const latestRef = useRef({ title: story?.title ?? '', synopsis: story?.synopsis ?? '' });
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearedRef = useRef(false);

  // Offer recovery when the device holds text the server does not.
  useEffect(() => {
    let cancelled = false;
    void loadLocalStoryDraft(draftKey).then((draft) => {
      if (cancelled || !draft) return;
      const base = baselineRef.current;
      const differs = draft.title.trim() !== base.title.trim() || draft.synopsis !== base.synopsis;
      const hasText = draft.title.trim() !== '' || draft.synopsis.trim() !== '';
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
        if (latest.title.trim() || latest.synopsis.trim()) {
          void saveLocalStoryDraft(draftKey, latest);
        }
      }
    };
  }, [draftKey]);

  function scheduleLocalDraft(next: { title: string; synopsis: string }) {
    if (localTimer.current) clearTimeout(localTimer.current);
    if (!next.title.trim() && !next.synopsis.trim()) return;
    localTimer.current = setTimeout(() => {
      void saveLocalStoryDraft(draftKey, next);
    }, LOCAL_DRAFT_DEBOUNCE_MS);
  }

  async function runAutosave(next: { title: string; synopsis: string }) {
    if (!story) return;
    const baseline = baselineRef.current;
    const payload: { title?: string; synopsis?: string } = {};
    if (next.title.trim()) payload.title = next.title;
    payload.synopsis = next.synopsis;
    const titleChanged = payload.title !== undefined && payload.title !== baseline.title;
    const synopsisChanged = payload.synopsis !== undefined && payload.synopsis !== baseline.synopsis;
    if (!titleChanged && !synopsisChanged) {
      setAutosave('saved');
      return;
    }

    setAutosave('saving');
    try {
      await autosaveStoryDraft(story.id, payload);
      baselineRef.current = {
        title: payload.title !== undefined ? payload.title : baseline.title,
        synopsis: payload.synopsis !== undefined ? payload.synopsis : baseline.synopsis,
      };
      setAutosave('saved');
    } catch (err) {
      setAutosave('failed');
      if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
      else if (err instanceof ApiError && err.code === 'NOT_A_DRAFT')
        toast.error('Autosave only works on unpublished stories.');
      else toast.error("Autosave failed — your text is safe on this device.");
    }
  }

  function scheduleAutosave(next: { title: string; synopsis: string }) {
    if (!story) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      void runAutosave(next);
    }, debounceMs);
  }

  function touch(patch: { title?: string; synopsis?: string }) {
    clearedRef.current = false;
    const next = { ...latestRef.current, ...patch };
    latestRef.current = next;
    if (patch.title !== undefined) setTitle(patch.title);
    if (patch.synopsis !== undefined) setSynopsis(patch.synopsis);
    setFieldErrors((prev) => {
      const key = patch.title !== undefined ? 'title' : 'synopsis';
      if (!prev[key]) return prev;
      const rest = { ...prev };
      delete rest[key];
      return rest;
    });
    setAutosave('idle');
    scheduleLocalDraft(next);
    scheduleAutosave(next);
  }

  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!title.trim()) errors.title = 'is required';
    else if (title.length > 200) errors.title = 'must be at most 200 characters';
    if (synopsis.length > 5000) errors.synopsis = 'must be at most 5000 characters';
    if (coverUrl.trim().length > 2000) errors.coverUrl = 'must be at most 2000 characters';
    const tags = parseTags(tagsRaw);
    if (tags.length > 10) errors.tags = 'at most 10 tags';
    if (tags.some((tag) => tag.length > 40)) errors.tags = 'each tag must be at most 40 characters';
    return errors;
  }

  async function save() {
    const errors = validate();
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSaving(true);
    try {
      const tags = parseTags(tagsRaw);
      const payload = {
        title: title.trim(),
        synopsis,
        coverUrl: coverUrl.trim(),
        tags,
      };
      if (story) {
        const updated = await updateStory(story.id, payload);
        baselineRef.current = { title: payload.title, synopsis: payload.synopsis };
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        clearedRef.current = true;
        void clearLocalStoryDraft(draftKey);
        setAutosave('saved');
        toast.success('Saved');
        onSaved(updated);
      } else {
        const created = await createStory(payload);
        clearedRef.current = true;
        void clearLocalStoryDraft(draftKey);
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
          setFormError("Couldn't save your story. Please try again.");
        }
      }
    } finally {
      setSaving(false);
    }
  }

  function recoverDraft() {
    if (!recovery) return;
    setTitle(recovery.title);
    setSynopsis(recovery.synopsis);
    latestRef.current = { title: recovery.title, synopsis: recovery.synopsis };
    setRecovery(null);
    setFieldErrors({});
    scheduleAutosave({ title: recovery.title, synopsis: recovery.synopsis });
  }

  function discardDraft() {
    void clearLocalStoryDraft(draftKey);
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
        onChangeText={(value) => touch({ title: value })}
        error={fieldErrors.title}
        placeholder="Give your story a title"
        testID="story-title"
      />

      <TextField
        label="Cover image URL (optional)"
        value={coverUrl}
        onChangeText={setCoverUrl}
        error={fieldErrors.coverUrl}
        placeholder="https://…"
        autoCapitalize="none"
        testID="story-cover-url"
      />

      <TextField
        label="Synopsis"
        value={synopsis}
        onChangeText={(value) => touch({ synopsis: value })}
        error={fieldErrors.synopsis}
        multiline
        placeholder="What is this story about?"
        testID="story-synopsis"
      />

      <TextField
        label="Tags (comma separated)"
        value={tagsRaw}
        onChangeText={setTagsRaw}
        error={fieldErrors.tags}
        placeholder="fantasy, sea, coming-of-age"
        autoCapitalize="none"
        testID="story-tags"
      />

      <View style={styles.metaRow}>
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

      <Button label="Save" onPress={save} loading={saving} testID="story-save" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 18,
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
