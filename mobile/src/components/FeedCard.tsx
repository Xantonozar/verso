import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FeedItem } from '../lib/api/discover';
import { colors, radii, spacing, typography } from '../theme/tokens';

interface Props {
  item: FeedItem;
  testID?: string;
}

function statCount(n?: number): number {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

/**
 * One poem row for feed/discovery surfaces (Phase 5) — title, excerpt,
 * author (null → "Anonymous"), chips, and stats. Tapping opens the reader.
 */
function FeedCardBase({ item, testID }: Props) {
  const stats = item.stats;
  const authorLabel = item.anonymous
    ? 'Anonymous'
    : item.author
      ? item.author.displayName || item.author.username
      : '';

  return (
    <Pressable
      onPress={() => router.push(`/poem/${item.id}`)}
      accessibilityRole="button"
      accessibilityLabel={`Open poem ${item.title || 'untitled'} by ${authorLabel || 'unknown'}`}
      testID={testID}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <Text style={styles.title} numberOfLines={1}>
        {item.title || 'Untitled'}
      </Text>
      <Text style={styles.excerpt} numberOfLines={3}>
        {item.excerpt}
      </Text>

      {authorLabel ? <Text style={styles.author}>by {authorLabel}</Text> : null}

      {item.moods.length > 0 || item.tags.length > 0 ? (
        <View style={styles.chipRow}>
          {item.moods.map((m) => (
            <Text key={`m-${m}`} style={styles.chip}>
              {m}
            </Text>
          ))}
          {item.tags.map((t) => (
            <Text key={`t-${t}`} style={styles.chip}>
              #{t}
            </Text>
          ))}
        </View>
      ) : null}

      <Text style={styles.stats}>
        {statCount(stats?.reads)} reads · {statCount(stats?.reactionCount)} reactions ·{' '}
        {statCount(stats?.commentCount)} comments
      </Text>
    </Pressable>
  );
}

export const FeedCard = React.memo(FeedCardBase);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  pressed: {
    backgroundColor: colors.surfaceAlt,
  },
  title: {
    ...typography.title,
    color: colors.ink,
    fontSize: 18,
  },
  excerpt: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  author: {
    ...typography.label,
    color: colors.inkMuted,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    ...typography.caption,
    color: colors.accent,
    backgroundColor: colors.accentSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  stats: {
    ...typography.caption,
    color: colors.inkMuted,
  },
});
