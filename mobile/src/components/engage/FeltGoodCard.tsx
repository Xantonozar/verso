import Slider from '@react-native-community/slider';
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../Button';
import {
  FeltGoodSummary,
  ratePoem,
  updateFeltGood,
} from '../../lib/api/engagement';
import { toast } from '../../lib/toast';
import { colors, radii, spacing, typography } from '../../theme/tokens';

const DEBOUNCE_MS = 600;

interface Props {
  poemId: string;
  summary: FeltGoodSummary;
  /** Existing rating from the BFF viewer state (null = first rating). */
  initialScore: number | null;
  interactive: boolean;
  /** Trailing debounce for PATCH updates — injectable for tests (default 600ms). */
  debounceMs?: number;
}

/**
 * Felt Good slider (plan step 48): the first rating POSTs; later adjustments
 * PATCH on a trailing debounce so a drag sends one request. Score is clamped
 * 0–100 here and range-validated again by the server.
 */
export function FeltGoodCard({
  poemId,
  summary,
  initialScore,
  interactive,
  debounceMs = DEBOUNCE_MS,
}: Props) {
  const [hasRated, setHasRated] = useState(initialScore !== null);
  const [score, setScore] = useState(initialScore ?? 50);
  const [saving, setSaving] = useState(false);
  const [average, setAverage] = useState(summary.average);
  const [count, setCount] = useState(summary.count);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const flush = async (value: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setSaving(true);
    try {
      if (hasRated) {
        await updateFeltGood(poemId, clamped);
        toast.success('Rating updated');
      } else {
        await ratePoem(poemId, clamped);
        setHasRated(true);
        setCount((c) => c + 1);
        setAverage(clamped);
        toast.success('Rating saved');
      }
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'Could not save rating');
    } finally {
      setSaving(false);
    }
  };

  const onSlidingComplete = (value: number) => {
    if (!interactive) return;
    const clamped = Math.max(0, Math.min(100, Math.round(value)));
    setScore(clamped);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flush(clamped);
    }, debounceMs);
  };

  const submitFirst = () => {
    if (timer.current) clearTimeout(timer.current);
    void flush(score);
  };

  return (
    <View style={styles.card}>
      <Text style={styles.heading} accessibilityRole="header">
        Felt Good
      </Text>
      <Text style={styles.summary} testID="felt-good-summary">
        {average !== null
          ? `Average ${average} / 100 · ${count} rating${count === 1 ? '' : 's'}`
          : 'No ratings yet'}
      </Text>

      {interactive ? (
        <>
          <Slider
            testID="felt-good-slider"
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={score}
            onSlidingComplete={onSlidingComplete}
            accessibilityLabel="Felt Good rating"
          />
          <View style={styles.sliderRow}>
            <Text style={styles.score} testID="felt-good-score">
              {score} / 100
            </Text>
            {!hasRated ? (
              <Button
                label="Save rating"
                loading={saving}
                onPress={submitFirst}
                testID="felt-good-submit"
              />
            ) : (
              <Text style={styles.hint}>{saving ? 'Saving…' : 'Updates automatically'}</Text>
            )}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  heading: {
    ...typography.label,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  summary: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  score: {
    ...typography.title,
    fontSize: spacing.lg + 4,
    color: colors.ink,
  },
  hint: {
    ...typography.caption,
    color: colors.inkMuted,
  },
});
