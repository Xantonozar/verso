import { router } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { PagedFeedList } from '../../components/PagedFeedList';
import { getFeed } from '../../lib/api/discover';
import { colors, layout, spacing, typography } from '../../theme/tokens';

/**
 * Following feed (Phase 5, plan step 56) — cursor-driven infinite scroll via
 * the shared PagedFeedList: skeleton → items (+ `feed-end`) vs `feed-empty`
 * (nobody you follow has posted yet), retryable error view.
 */
export default function FeedScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="feed-back" />
        <Text style={styles.heading}>Your feed</Text>
        <Text style={styles.subtitle}>Fresh poems from writers you follow.</Text>
      </View>

      <View style={styles.body}>
        <PagedFeedList
          fetchPage={(cursor) => getFeed({ cursor, limit: 20 })}
          emptyTitle="Nothing here yet"
          emptySubtitle="Follow writers and their published poems will land here."
          testIDPrefix="feed"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  body: {
    flex: 1,
    paddingTop: spacing.lg,
  },
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  subtitle: {
    ...typography.body,
    color: colors.inkSecondary,
  },
});
