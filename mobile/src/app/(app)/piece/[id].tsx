import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { TextField } from '../../../components/TextField';
import { ApiError } from '../../../lib/api/client';
import {
  addSegment,
  getPiece,
  getReadingPath,
  getSegment,
  listSegmentChildren,
  PieceSummary,
  recordReadingPath,
  Segment,
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

function crumbLabel(segment: Segment | undefined, index: number): string {
  const firstLine = segment?.content.split('\n')[0]?.trim() ?? '';
  return firstLine ? `${index + 1}. ${firstLine.slice(0, 18)}` : `#${index + 1}`;
}

/**
 * Branching reader (plan step 66): current segment, path-history breadcrumb,
 * branch picker at forks (children endpoint), write-the-next-segment composer,
 * and walk-back via the append-only reading path.
 */
export default function PieceReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [piece, setPiece] = useState<PieceSummary | null>(null);
  const [current, setCurrent] = useState<Segment | null>(null);
  const [children, setChildren] = useState<Segment[]>([]);
  const [cap, setCap] = useState(1);
  const [visitedIds, setVisitedIds] = useState<string[]>([]);
  const [seen, setSeen] = useState<Record<string, Segment>>({});
  const [state, setState] = useState<LoadState>('loading');
  const [moving, setMoving] = useState(false);

  const [showComposer, setShowComposer] = useState(false);
  const [content, setContent] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadSegmentState = useCallback(
    async (pieceId: string, segment: Segment, visited: string[]) => {
      const kids = await listSegmentChildren(pieceId, segment.id);
      setChildren(kids.items);
      setCap(kids.cap);
      setCurrent(segment);
      setVisitedIds(visited);
      setSeen((prev) => ({ ...prev, [segment.id]: segment }));
    },
    [],
  );

  // Fetch-only (no synchronous setState) so the effect stays lint-clean;
  // `reload` wraps it with the loading transition for retries.
  const fetchAll = useCallback(
    (isCancelled?: () => boolean): Promise<void> => {
      return getPiece(id)
        .then(async (detail) => {
          const root = detail.rootSegment;
          if (!root) throw new Error('missing root');
          if (isCancelled?.()) return;
          setPiece(detail.piece);

          let path = await getReadingPath(id);
          if (!path || !path.currentSegmentId) {
            // first visit — start the append-only path at the root
            path = await recordReadingPath(id, root.id);
          }
          if (isCancelled?.()) return;

          let cur = root;
          if (path.currentSegmentId && path.currentSegmentId !== root.id) {
            try {
              cur = await getSegment(id, path.currentSegmentId);
            } catch {
              cur = root;
            }
          }
          if (isCancelled?.()) return;
          await loadSegmentState(
            id,
            cur,
            path.visitedSegmentIds.length ? path.visitedSegmentIds : [root.id],
          );
          if (!isCancelled?.()) setState('ready');
        })
        .catch((err: unknown) => {
          if (isCancelled?.()) return;
          setState(
            err instanceof ApiError && err.code === 'PIECE_NOT_FOUND' ? 'gone' : 'error',
          );
        });
    },
    [id, loadSegmentState],
  );

  useEffect(() => {
    let cancelled = false;
    fetchAll(() => cancelled).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  const reload = useCallback(() => {
    setState('loading');
    fetchAll().catch(() => undefined);
  }, [fetchAll]);

  async function moveTo(segment: Segment) {
    if (!piece || moving) return;
    setMoving(true);
    setFormError(null);
    try {
      const path = await recordReadingPath(piece.id, segment.id);
      await loadSegmentState(piece.id, segment, path.visitedSegmentIds);
      setShowComposer(false);
      setContent('');
      setFieldErrors({});
    } catch (err) {
      toast.error(
        isConnectivityError(err)
          ? CONNECTIVITY_TOAST
          : "Couldn't move there. Try again.",
      );
    } finally {
      setMoving(false);
    }
  }

  async function goToParent() {
    if (!piece || !current?.parentId || moving) return;
    const parentId = current.parentId;
    setMoving(true);
    try {
      const parent = seen[parentId] ?? (await getSegment(piece.id, parentId));
      const path = await recordReadingPath(piece.id, parent.id);
      await loadSegmentState(piece.id, parent, path.visitedSegmentIds);
    } catch (err) {
      toast.error(
        isConnectivityError(err) ? CONNECTIVITY_TOAST : "Couldn't go back. Try again.",
      );
    } finally {
      setMoving(false);
    }
  }

  async function submitSegment() {
    if (!piece || !current || submitting) return;
    const trimmed = content.trim();
    const errors: FieldErrors = {};
    if (!trimmed) errors.content = 'is required';
    setFieldErrors(errors);
    setFormError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      const segment = await addSegment(piece.id, { parentId: current.id, content: trimmed });
      await moveTo(segment);
      toast.success('Segment added');
    } catch (err) {
      if (isConnectivityError(err)) {
        toast.error(CONNECTIVITY_TOAST);
      } else if (err instanceof ApiError && err.code === 'BRANCH_CAP_REACHED') {
        toast.error('This branch already reached its cap.');
        const kids = await listSegmentChildren(piece.id, current.id).catch(() => null);
        if (kids) {
          setChildren(kids.items);
          setCap(kids.cap);
        }
      } else {
        const mapped = mapApiFieldErrors(err);
        if (mapped) {
          const { fields, formMessage } = splitFieldErrors(mapped);
          setFieldErrors(fields);
          if (formMessage) setFormError(formMessage);
        } else {
          setFormError("Couldn't add the segment. Please try again.");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="piece-back" />
          <LoadingState label="Loading piece..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'gone') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="piece-back" />
          <ErrorState message="This piece is no longer available." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (state === 'error' || !piece || !current) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="piece-back" />
          <ErrorState message="Couldn't load this piece." onRetry={reload} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (moving) {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="piece-back" />
          <LoadingState label="Moving..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const canWrite = children.length < cap;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="piece-back" />
        <Text style={styles.heading} testID="piece-title">
          {piece.title}
        </Text>
        <Text style={styles.modeHint} testID="piece-mode">
          {piece.mode === 'single_ending' ? 'One ending' : `Up to ${piece.maxBranches} endings`}
        </Text>

        <View style={styles.breadcrumb} testID="piece-breadcrumb">
          <Text style={styles.breadcrumbLabel}>Your path</Text>
          <Text style={styles.breadcrumbText} accessibilityRole="text">
            {visitedIds
              .map((segmentId, index) => crumbLabel(seen[segmentId], index))
              .join('  ›  ')}
          </Text>
        </View>

        <View style={styles.segment} testID="piece-segment">
          <Text style={styles.segmentMeta}>
            {current.author?.displayName ?? 'Unknown'} · depth {current.depth}
          </Text>
          <Text style={styles.segmentContent} testID="piece-segment-content">
            {current.content}
          </Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>
            Branches ({children.length}/{cap})
          </Text>
          {children.length > 0 ? (
            <View style={styles.list} testID="piece-children">
              {children.map((child) => (
                <Button
                  key={child.id}
                  label={`↳ ${child.content.split('\n')[0].slice(0, 40)}`}
                  variant="secondary"
                  onPress={() => moveTo(child)}
                  testID={`piece-child-${child.id}`}
                />
              ))}
            </View>
          ) : (
            <Text style={styles.emptyBranches} testID="piece-children-empty">
              No branches here yet.
            </Text>
          )}

          {canWrite ? (
            !showComposer ? (
              <Button
                label="+ Write next segment"
                onPress={() => setShowComposer(true)}
                testID="piece-new-segment"
              />
            ) : (
              <View style={styles.form}>
                <Text style={styles.formTitle}>Next segment</Text>
                <TextField
                  label="Content"
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
                  placeholder="Where does this branch go?"
                  multiline
                  testID="piece-segment-input"
                />
                {formError ? (
                  <Text
                    style={styles.formError}
                    accessibilityLiveRegion="polite"
                    accessibilityRole="alert"
                    testID="piece-form-error"
                  >
                    {formError}
                  </Text>
                ) : null}
                <Button
                  label="Add segment"
                  onPress={submitSegment}
                  loading={submitting}
                  testID="piece-add-segment"
                />
                <Button
                  label="Cancel"
                  variant="secondary"
                  disabled={submitting}
                  onPress={() => {
                    setShowComposer(false);
                    setContent('');
                    setFieldErrors({});
                    setFormError(null);
                  }}
                  testID="piece-cancel-segment"
                />
              </View>
            )
          ) : (
            <Text style={styles.capHint} testID="piece-cap-hint">
              Every branch here has reached its cap.
            </Text>
          )}
        </View>

        {current.parentId ? (
          <Button
            label="← Back to parent"
            variant="secondary"
            onPress={goToParent}
            testID="piece-back-to-parent"
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
  modeHint: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  breadcrumb: {
    gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  breadcrumbLabel: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  breadcrumbText: {
    ...typography.body,
    color: colors.ink,
  },
  segment: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  segmentMeta: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  segmentContent: {
    ...typography.body,
    color: colors.ink,
  },
  block: {
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
  },
  list: {
    gap: spacing.sm,
  },
  emptyBranches: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  capHint: {
    ...typography.body,
    color: colors.inkSecondary,
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
  formError: {
    ...typography.body,
    color: colors.error,
  },
});
