import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet } from 'react-native';
import { colors, radii } from '../theme/tokens';
interface Props {
  height?: number;
  width?: number | `${number}%`;
}

/**
 * Skeleton loader (§12 shared components, built once) — a softly pulsing
 * block for list/card placeholders. The pulse stops when the user has
 * reduce-motion enabled (a11y), leaving a static block.
 */
export function Skeleton({ height = 16, width = '100%' }: Props) {
  const [opacity] = useState(() => new Animated.Value(0.4));

  useEffect(() => {
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;

    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (cancelled || reduced) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      );
      loop.start();
    });

    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [opacity]);

  return (
    <Animated.View
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[styles.block, { opacity, height, width }]}
    />
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.skeleton,
    borderRadius: radii.sm,
  },
});
