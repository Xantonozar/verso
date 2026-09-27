import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { TextField } from '../../components/TextField';
import {
  CollectionSummary,
  CollectionVisibility,
  createCollection,
  listCollections,
} from '../../lib/api/collections';
import { toast } from '../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

const MAX_TITLE = 80;
const MAX_DESCRIPTION = 300;

type LoadState = 'loading' | 'ready' | 'error';

const VISIBILITIES: CollectionVisibility[] = ['public', 'followers', 'private'];

/**
 * Collections hub (plan step 58) — list of the signed-in user's collections
 * plus an inline create flow. Detail/add/remove live in /collection/[id] and
 * the reader picker.
 */
export default function CollectionsScreen() {
  const [items, setItems] = useState<CollectionSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<CollectionVisibility>('public');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return listCollections()
      .then((page) => {
        setItems(page.items);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    listCollections()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function resetForm() {
    setTitle('');
    setDescription('');
    setVisibility('public');
    setFieldErrors({});
    setFormError(null);
  }

  async function submit() {
    const trimmed = title.trim();
    const errors: FieldErrors = {};
    if (!trimmed) errors.title = 'is required';
    else if (trimmed.length > MAX_TITLE) errors.title = `must be at most ${MAX_TITLE} characters`;
    if (description.length > MAX_DESCRIPTION)
      errors.description = `must be at most ${MAX_DESCRIPTION} characters`;
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setCreating(true);
    try {
      const created = await createCollection({
        title: trimmed,
        description: description.trim() || undefined,
        visibility,
      });
      setItems((prev) => [created, ...prev]);
      setShowForm(false);
      resetForm();
      toast.success('Collection created');
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
          setFormError("Couldn't create the collection. Please try again.");
        }
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collections-back" />
        <Text style={styles.heading}>Collections</Text>

        {loadState === 'loading' ? (
          <LoadingState label="Loading collections..." />
        ) : loadState === 'error' ? (
          <ErrorState message="Couldn't load your collections." onRetry={load} />
        ) : (
          <View style={styles.block}>
            {items.length === 0 && !showForm ? (
              <View testID="collections-empty">
                <EmptyState
                  title="No collections yet"
                  subtitle="Group poems you love into shelves of your own."
                />
              </View>
            ) : (
              <View style={styles.list} testID="collections-list">
                {items.map((collection) => (
                  <Button
                    key={collection.id}
                    label={`${collection.title} · ${collection.poemCount} ${
                      collection.poemCount === 1 ? 'poem' : 'poems'
                    }`}
                    variant="secondary"
                    onPress={() => router.push(`/collection/${collection.id}`)}
                    testID={`collection-item-${collection.id}`}
                  />
                ))}
              </View>
            )}

            {!showForm ? (
              <Button
                label="+ New collection"
                onPress={() => setShowForm(true)}
                testID="collections-new"
              />
            ) : (
              <View style={styles.form}>
                <Text style={styles.formTitle}>New collection</Text>
                <TextField
                  label="Title"
                  value={title}
                  onChangeText={(value) => {
                    setTitle(value);
                    setFieldErrors((prev) => {
                      if (!prev.title) return prev;
                      const rest = { ...prev };
                      delete rest.title;
                      return rest;
                    });
                  }}
                  error={fieldErrors.title}
                  placeholder="Night reads"
                  testID="collections-title"
                />
                <TextField
                  label="Description"
                  value={description}
                  onChangeText={(value) => {
                    setDescription(value);
                    setFieldErrors((prev) => {
                      if (!prev.description) return prev;
                      const rest = { ...prev };
                      delete rest.description;
                      return rest;
                    });
                  }}
                  error={fieldErrors.description}
                  placeholder="Optional — what ties this shelf together"
                  multiline
                  testID="collections-description"
                />
                <View style={styles.visibilityBlock}>
                  <Text style={styles.label}>Who can see this</Text>
                  <View style={styles.visibilityRow}>
                    {VISIBILITIES.map((option) => (
                      <Button
                        key={option}
                        label={option.charAt(0).toUpperCase() + option.slice(1)}
                        variant={visibility === option ? 'primary' : 'secondary'}
                        onPress={() => setVisibility(option)}
                        style={styles.visibilityButton}
                        testID={`collections-visibility-${option}`}
                      />
                    ))}
                  </View>
                </View>
                {formError ? (
                  <Text
                    style={styles.formError}
                    accessibilityLiveRegion="polite"
                    accessibilityRole="alert"
                    testID="collections-form-error"
                  >
                    {formError}
                  </Text>
                ) : null}
                <Button label="Create" onPress={submit} loading={creating} testID="collections-create" />
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={creating}
                  onPress={() => {
                    setShowForm(false);
                    resetForm();
                  }}
                  testID="collections-cancel"
                />
              </View>
            )}
          </View>
        )}
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
  block: {
    gap: spacing.lg,
  },
  list: {
    gap: spacing.sm,
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
  formError: {
    ...typography.body,
    color: colors.error,
  },
});
