import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  value: boolean;
  onValueChange: (next: boolean) => void;
  label: string;
  /** Small static line under the label (before the toggle is switched on). */
  hint?: string;
  testID: string;
  /** Rendered under the label while the toggle is on (explainers, extra fields). */
  children?: React.ReactNode;
}

/**
 * Shared switch row for composer options (plan step 62): label + optional
 * hint, with children revealed only while the option is on.
 */
export function ToggleRow({ value, onValueChange, label, hint, testID, children }: Props) {
  return (
    <View style={styles.row} testID={`${testID}-row`}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        testID={testID}
        accessibilityLabel={label}
        trackColor={{ false: colors.border, true: colors.accent }}
        ios_backgroundColor={colors.surface}
      />
      <View style={styles.labels}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        {value && children ? <View style={styles.child}>{children}</View> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  labels: {
    flex: 1,
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.ink,
    fontWeight: '600',
  },
  hint: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  child: {
    marginTop: spacing.xs,
  },
});
