import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { savePoem, unsavePoem } from '../../lib/api/engagement';
import { toast } from '../../lib/toast';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

interface Props {
  poemId: string;
  initialSaved: boolean;
  initialCount: number;
}

/**
 * Save toggle (plan step 47): both server verbs are idempotent, so the tap
 * flips optimistically and only rolls back when the request itself fails.
 */
export function SaveButton({ poemId, initialSaved, initialCount }: Props) {
  const [saved, setSaved] = useState(initialSaved);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    const turningOn = !saved;
    setSaved(turningOn);
    setCount((c) => Math.max(0, c + (turningOn ? 1 : -1)));
    setBusy(true);
    try {
      const res = turningOn ? await savePoem(poemId) : await unsavePoem(poemId);
      // Idempotent responses report the authoritative server state.
      setSaved(res.saved);
      setCount(res.stats.saveCount);
    } catch (err) {
      setSaved(!turningOn);
      setCount((c) => Math.max(0, c + (turningOn ? -1 : 1)));
      toast.error(err instanceof Error && err.message ? err.message : 'Could not update save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable
      onPress={() => {
        void toggle();
      }}
      accessibilityRole="button"
      accessibilityLabel={saved ? 'Saved, tap to remove' : 'Save poem'}
      accessibilityState={{ selected: saved, disabled: busy }}
      testID="save-toggle"
      style={({ pressed }) => [
        styles.button,
        saved && styles.buttonOn,
        pressed && styles.pressed,
        busy && styles.busy,
      ]}
    >
      <Text style={[styles.label, saved && styles.labelOn]}>
        {saved ? `Saved ${count}` : `Save ${count}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignSelf: 'flex-start',
  },
  buttonOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  pressed: {
    backgroundColor: colors.surfaceAlt,
  },
  busy: {
    opacity: 0.6,
  },
  label: {
    ...typography.label,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  labelOn: {
    color: colors.accent,
  },
});
