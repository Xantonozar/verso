import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  addReaction,
  ReactionCounts,
  REACTION_LABELS,
  REACTION_TYPES,
  ReactionType,
  removeReaction,
} from '../../lib/api/engagement';
import { toast } from '../../lib/toast';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

interface Props {
  poemId: string;
  counts: ReactionCounts;
  active: ReactionType[];
  /** ViewerState from the BFF — null means unauthenticated (read-only). */
  interactive: boolean;
}

/**
 * Reaction picker (plan step 48): multi-select chips with an optimistic
 * toggle — the count flips instantly and rolls back if the server rejects.
 * POST duplicate → 409 ALREADY_REACTED rolls back too (tap-tap race).
 */
export function ReactionBar({ poemId, counts, active, interactive }: Props) {
  const [selected, setSelected] = useState<Set<ReactionType>>(new Set(active));
  const [localCounts, setLocalCounts] = useState<ReactionCounts>({ ...counts });
  const [pending, setPending] = useState<Set<ReactionType>>(new Set());

  const has = (type: ReactionType) => selected.has(type);
  const countOf = (type: ReactionType) => localCounts[type] ?? 0;

  const toggle = async (type: ReactionType) => {
    if (!interactive || pending.has(type)) return;

    const turningOn = !has(type);
    // Optimistic flip — both UI surfaces (chip + count) move immediately.
    setSelected((prev) => {
      const next = new Set(prev);
      if (turningOn) next.add(type);
      else next.delete(type);
      return next;
    });
    setLocalCounts((prev) => ({
      ...prev,
      [type]: Math.max(0, (prev[type] ?? 0) + (turningOn ? 1 : -1)),
    }));
    setPending((prev) => new Set(prev).add(type));

    try {
      if (turningOn) {
        await addReaction(poemId, type);
      } else {
        await removeReaction(poemId, type);
      }
    } catch (err) {
      // Rollback both pieces of optimistic state.
      setSelected((prev) => {
        const next = new Set(prev);
        if (turningOn) next.delete(type);
        else next.add(type);
        return next;
      });
      setLocalCounts((prev) => ({
        ...prev,
        [type]: Math.max(0, (prev[type] ?? 0) + (turningOn ? -1 : 1)),
      }));
      toast.error(err instanceof Error && err.message ? err.message : 'Could not react');
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(type);
        return next;
      });
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.heading} accessibilityRole="header">
        Reactions
      </Text>
      <View style={styles.row}>
        {REACTION_TYPES.map((type) => {
          const on = has(type);
          const count = countOf(type);
          return (
            <Pressable
              key={type}
              testID={`reaction-${type}`}
              accessibilityRole="button"
              accessibilityLabel={`${REACTION_LABELS[type]}${on ? ', selected' : ''}`}
              accessibilityState={{ selected: on, disabled: !interactive }}
              disabled={!interactive}
              onPress={() => {
                void toggle(type);
              }}
              style={({ pressed }) => [
                styles.chip,
                on && styles.chipOn,
                pressed && styles.chipPressed,
                !interactive && styles.chipReadonly,
              ]}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>
                {REACTION_LABELS[type]}
                {count > 0 ? ` ${count}` : ''}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  heading: {
    ...typography.label,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  chip: {
    minHeight: layout.touchTargetMin,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accentSoft,
  },
  chipPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  chipReadonly: {
    opacity: 0.7,
  },
  chipLabel: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  chipLabelOn: {
    color: colors.accent,
    fontWeight: '700',
  },
});
