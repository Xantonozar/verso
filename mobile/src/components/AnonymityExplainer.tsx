import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors, typography } from '../theme/tokens';

interface Props {
  testID?: string;
}

/**
 * Trust copy for every anonymous composer (plan step 62): states what stays
 * hidden from readers AND that moderators can still see the author — never
 * promise total anonymity.
 */
export function AnonymityExplainer({ testID = 'anonymity-explainer' }: Props) {
  return (
    <Text style={styles.text} testID={testID}>
      Your name and profile stay hidden from other readers. Moderators can still
      see who wrote this.
    </Text>
  );
}

const styles = StyleSheet.create({
  text: {
    ...typography.caption,
    color: colors.inkMuted,
  },
});
