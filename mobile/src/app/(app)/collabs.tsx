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
  CollabPoem,
  createCollabPoem,
  createPiece,
  listCollabPoems,
  listPieces,
  PieceMode,
  PieceSummary,
} from '../../lib/api/collab';
import { toast } from '../../lib/toast';
import {
  CONNECTIVITY_TOAST,
  FieldErrors,
  isConnectivityError,
  mapApiFieldErrors,
  splitFieldErrors,
} from '../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * Collaboration hub (plan step 66): two lists — fixed-turn relay poems and
 * open/branching pieces — each with an inline create form. Detail lives in
 * /collab-poem/[id] (relay) and /piece/[id] (branching reader).
 */
export default function CollabsScreen() {
  const [poems, setPoems] = useState<CollabPoem[]>([]);
  const [pieces, setPieces] = useState<PieceSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const [showPoemForm, setShowPoemForm] = useState(false);
  const [poemTitle, setPoemTitle] = useState('');
  const [linesPerTurn, setLinesPerTurn] = useState('4');
  const [poemErrors, setPoemErrors] = useState<FieldErrors>({});
  const [poemFormError, setPoemFormError] = useState<string | null>(null);
  const [creatingPoem, setCreatingPoem] = useState(false);

  const [showPieceForm, setShowPieceForm] = useState(false);
  const [pieceTitle, setPieceTitle] = useState('');
  const [pieceContent, setPieceContent] = useState('');
  const [pieceMode, setPieceMode] = useState<PieceMode>('single_ending');
  const [pieceErrors, setPieceErrors] = useState<FieldErrors>({});
  const [pieceFormError, setPieceFormError] = useState<string | null>(null);
  const [creatingPiece, setCreatingPiece] = useState(false);

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return Promise.all([listCollabPoems(), listPieces()])
      .then(([poemPage, piecePage]) => {
        setPoems(poemPage.items);
        setPieces(piecePage.items);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCollabPoems(), listPieces()])
      .then(([poemPage, piecePage]) => {
        if (!cancelled) {
          setPoems(poemPage.items);
          setPieces(piecePage.items);
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

  async function submitPoem() {
    const trimmed = poemTitle.trim();
    const errors: FieldErrors = {};
    const lines = Number(linesPerTurn);
    if (!trimmed) errors.title = 'is required';
    if (!Number.isInteger(lines) || lines < 1 || lines > 20)
      errors.linesPerTurn = 'must be a whole number from 1 to 20';
    setPoemErrors(errors);
    setPoemFormError(null);
    if (Object.keys(errors).length > 0) return;

    setCreatingPoem(true);
    try {
      const created = await createCollabPoem({ title: trimmed, linesPerTurn: lines });
      setPoems((prev) => [created, ...prev]);
      setShowPoemForm(false);
      setPoemTitle('');
      setLinesPerTurn('4');
      toast.success('Relay poem started');
    } catch (err) {
      handleFormError(err, setPoemErrors, setPoemFormError, "Couldn't start the relay poem.");
    } finally {
      setCreatingPoem(false);
    }
  }

  async function submitPiece() {
    const trimmed = pieceTitle.trim();
    const content = pieceContent.trim();
    const errors: FieldErrors = {};
    if (!trimmed) errors.title = 'is required';
    if (!content) errors.content = 'is required';
    setPieceErrors(errors);
    setPieceFormError(null);
    if (Object.keys(errors).length > 0) return;

    setCreatingPiece(true);
    try {
      const created = await createPiece({ title: trimmed, mode: pieceMode, content });
      setPieces((prev) => [created, ...prev]);
      setShowPieceForm(false);
      setPieceTitle('');
      setPieceContent('');
      setPieceMode('single_ending');
      toast.success('Branching piece created');
    } catch (err) {
      handleFormError(err, setPieceErrors, setPieceFormError, "Couldn't create the piece.");
    } finally {
      setCreatingPiece(false);
    }
  }

  if (loadState === 'loading') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collabs-back" />
          <Text style={styles.heading}>Collaborate</Text>
          <LoadingState label="Loading collaborations..." />
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (loadState === 'error') {
    return (
      <SafeAreaView style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collabs-back" />
          <Text style={styles.heading}>Collaborate</Text>
          <ErrorState message="Couldn't load collaborations." onRetry={load} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const empty = poems.length === 0 && pieces.length === 0 && !showPoemForm && !showPieceForm;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="collabs-back" />
        <Text style={styles.heading}>Collaborate</Text>

        {empty ? (
          <View testID="collabs-empty">
            <EmptyState
              title="No collaborations yet"
              subtitle="Start a relay poem turn by turn, or open a branching piece others can fork."
            />
          </View>
        ) : null}

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Relay poems</Text>
          <Text style={styles.sectionHint}>
            Turn by turn — everyone adds the same number of lines.
          </Text>
          {poems.length > 0 ? (
            <View style={styles.list} testID="collab-list">
              {poems.map((poem) => (
                <Button
                  key={poem.id}
                  label={`${poem.title} · ${poem.turnCount} ${
                    poem.turnCount === 1 ? 'turn' : 'turns'
                  }${poem.status === 'finished' ? ' · finished' : ''}`}
                  variant="secondary"
                  onPress={() => router.push(`/collab-poem/${poem.id}`)}
                  testID={`collab-item-${poem.id}`}
                />
              ))}
            </View>
          ) : null}

          {!showPoemForm ? (
            <Button
              label="+ New relay poem"
              onPress={() => setShowPoemForm(true)}
              testID="collabs-new-collab"
            />
          ) : (
            <View style={styles.form}>
              <Text style={styles.formTitle}>New relay poem</Text>
              <TextField
                label="Title"
                value={poemTitle}
                onChangeText={(value) => {
                  setPoemTitle(value);
                  setPoemErrors((prev) => {
                    if (!prev.title) return prev;
                    const rest = { ...prev };
                    delete rest.title;
                    return rest;
                  });
                }}
                error={poemErrors.title}
                placeholder="Two voices"
                testID="collab-title"
              />
              <TextField
                label="Lines per turn"
                value={linesPerTurn}
                onChangeText={(value) => {
                  setLinesPerTurn(value);
                  setPoemErrors((prev) => {
                    if (!prev.linesPerTurn) return prev;
                    const rest = { ...prev };
                    delete rest.linesPerTurn;
                    return rest;
                  });
                }}
                error={poemErrors.linesPerTurn}
                placeholder="4"
                keyboardType="number-pad"
                testID="collab-lines"
              />
              {poemFormError ? (
                <Text
                  style={styles.formError}
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  testID="collab-form-error"
                >
                  {poemFormError}
                </Text>
              ) : null}
              <Button
                label="Start relay"
                onPress={submitPoem}
                loading={creatingPoem}
                testID="collab-create"
              />
              <Button
                label="Cancel"
                variant="secondary"
                disabled={creatingPoem}
                onPress={() => {
                  setShowPoemForm(false);
                  setPoemTitle('');
                  setLinesPerTurn('4');
                  setPoemErrors({});
                  setPoemFormError(null);
                }}
                testID="collab-cancel"
              />
            </View>
          )}
        </View>

        <View style={styles.block}>
          <Text style={styles.sectionTitle}>Branching pieces</Text>
          <Text style={styles.sectionHint}>
            Readers choose a branch at every fork — and can write the next one.
          </Text>
          {pieces.length > 0 ? (
            <View style={styles.list} testID="piece-list">
              {pieces.map((piece) => (
                <Button
                  key={piece.id}
                  label={`${piece.title} · ${
                    piece.mode === 'single_ending' ? 'one ending' : `${piece.maxBranches} endings`
                  }`}
                  variant="secondary"
                  onPress={() => router.push(`/piece/${piece.id}`)}
                  testID={`piece-item-${piece.id}`}
                />
              ))}
            </View>
          ) : null}

          {!showPieceForm ? (
            <Button
              label="+ New branching piece"
              onPress={() => setShowPieceForm(true)}
              testID="collabs-new-piece"
            />
          ) : (
            <View style={styles.form}>
              <Text style={styles.formTitle}>New branching piece</Text>
              <TextField
                label="Title"
                value={pieceTitle}
                onChangeText={(value) => {
                  setPieceTitle(value);
                  setPieceErrors((prev) => {
                    if (!prev.title) return prev;
                    const rest = { ...prev };
                    delete rest.title;
                    return rest;
                  });
                }}
                error={pieceErrors.title}
                placeholder="The fork in the road"
                testID="piece-title"
              />
              <View style={styles.modeBlock}>
                <Text style={styles.label}>Endings</Text>
                <View style={styles.modeRow}>
                  <Button
                    label="One ending"
                    variant={pieceMode === 'single_ending' ? 'primary' : 'secondary'}
                    onPress={() => setPieceMode('single_ending')}
                    style={styles.modeButton}
                    testID="piece-mode-single"
                  />
                  <Button
                    label="Many endings"
                    variant={pieceMode === 'multi_ending' ? 'primary' : 'secondary'}
                    onPress={() => setPieceMode('multi_ending')}
                    style={styles.modeButton}
                    testID="piece-mode-multi"
                  />
                </View>
              </View>
              <TextField
                label="Opening segment"
                value={pieceContent}
                onChangeText={(value) => {
                  setPieceContent(value);
                  setPieceErrors((prev) => {
                    if (!prev.content) return prev;
                    const rest = { ...prev };
                    delete rest.content;
                    return rest;
                  });
                }}
                error={pieceErrors.content}
                placeholder="Where the story starts..."
                multiline
                testID="piece-content"
              />
              {pieceFormError ? (
                <Text
                  style={styles.formError}
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                  testID="piece-form-error"
                >
                  {pieceFormError}
                </Text>
              ) : null}
              <Button
                label="Create piece"
                onPress={submitPiece}
                loading={creatingPiece}
                testID="piece-create"
              />
              <Button
                label="Cancel"
                variant="secondary"
                disabled={creatingPiece}
                onPress={() => {
                  setShowPieceForm(false);
                  setPieceTitle('');
                  setPieceContent('');
                  setPieceMode('single_ending');
                  setPieceErrors({});
                  setPieceFormError(null);
                }}
                testID="piece-cancel"
              />
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function handleFormError(
  err: unknown,
  setFields: React.Dispatch<React.SetStateAction<FieldErrors>>,
  setFormError: React.Dispatch<React.SetStateAction<string | null>>,
  fallback: string,
) {
  if (isConnectivityError(err)) {
    toast.error(CONNECTIVITY_TOAST);
    return;
  }
  const mapped = mapApiFieldErrors(err);
  if (mapped) {
    const { fields, formMessage } = splitFieldErrors(mapped);
    setFields(fields);
    if (formMessage) setFormError(formMessage);
  } else {
    setFormError(fallback);
  }
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
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.title,
    fontSize: 18,
    color: colors.ink,
  },
  sectionHint: {
    ...typography.body,
    color: colors.inkSecondary,
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
    marginTop: spacing.sm,
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
  modeBlock: {
    gap: spacing.sm,
  },
  modeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  modeButton: {
    flex: 1,
  },
  formError: {
    ...typography.body,
    color: colors.error,
  },
});
