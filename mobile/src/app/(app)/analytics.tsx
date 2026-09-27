import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import {
  getWriterAnalytics,
  WriterAnalytics,
  WriterDayStat,
  WriterTotals,
} from '../../lib/api/analytics';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error';
type DayMetricKey = Exclude<keyof WriterDayStat, 'date'>;

const TOTAL_LABELS: { key: keyof WriterTotals; label: string }[] = [
  { key: 'poems', label: 'Poems' },
  { key: 'reads', label: 'Reads' },
  { key: 'reactions', label: 'Reactions' },
  { key: 'comments', label: 'Comments' },
  { key: 'saves', label: 'Saves' },
  { key: 'followers', label: 'Followers' },
];

const DAY_METRICS: { key: DayMetricKey; label: string }[] = [
  { key: 'reads', label: 'reads' },
  { key: 'reactions', label: 'reactions' },
  { key: 'comments', label: 'comments' },
  { key: 'saves', label: 'saves' },
  { key: 'followers', label: 'new follows' },
];

/**
 * Writer dashboard (plan step 84): the heavy aggregate gets an explicit
 * loading state, a brand-new writer lands on an honest empty state, and a
 * failure keeps its own retry. Newest day first — what changed yesterday
 * matters more than what happened four weeks ago.
 */
export default function AnalyticsScreen() {
  const [stats, setStats] = useState<WriterAnalytics | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return getWriterAnalytics(30)
      .then((data) => {
        setStats(data);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    getWriterAnalytics(30)
      .then((data) => {
        if (cancelled) return;
        setStats(data);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isEmpty =
    stats !== null && Object.values(stats.totals).every((value) => value === 0);
  const activeDays = stats ? [...stats.days].reverse().filter((day) =>
    DAY_METRICS.some((metric) => day[metric.key] > 0),
  ) : [];

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button
          label="Back"
          variant="secondary"
          onPress={() => router.back()}
          testID="analytics-back"
        />
        <Text style={styles.heading}>Your reach</Text>

        {loadState === 'loading' ? (
          <LoadingState label="Gathering your readership..." />
        ) : loadState === 'error' ? (
          <ErrorState message="Couldn't load your analytics." onRetry={load} />
        ) : isEmpty ? (
          <View testID="analytics-empty">
            <EmptyState
              title="Nothing to measure yet."
              subtitle="Publish a poem — reads, reactions, and new followers will gather here."
            />
          </View>
        ) : (
          stats && (
            <View style={styles.section} testID="analytics-ready">
              <View style={styles.rangeRow}>
                <Text style={styles.rangeLabel}>
                  {stats.range.from} → {stats.range.to}
                </Text>
              </View>

              <View style={styles.totalsGrid} testID="analytics-totals">
                {TOTAL_LABELS.map((total) => (
                  <View key={total.key} style={styles.totalCard}>
                    <Text style={styles.totalValue} testID={`total-${total.key}`}>
                      {stats.totals[total.key]}
                    </Text>
                    <Text style={styles.totalLabel}>{total.label}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.sectionTitle}>Daily activity</Text>
              {activeDays.length === 0 ? (
                <Text style={styles.quietNote} testID="analytics-quiet">
                  No activity in the last {stats.range.days} days.
                </Text>
              ) : (
                <View style={styles.days} testID="analytics-days">
                  {activeDays.map((day) => (
                    <View key={day.date} style={styles.dayRow} testID={`day-${day.date}`}>
                      <Text style={styles.dayDate}>{day.date}</Text>
                      <Text style={styles.dayMetrics}>
                        {DAY_METRICS.map((metric) =>
                          day[metric.key] > 0 ? `${day[metric.key]} ${metric.label}` : null,
                        )
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          )
        )}
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
  section: {
    gap: spacing.md,
  },
  rangeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rangeLabel: {
    ...typography.caption,
    color: colors.inkSecondary,
  },
  totalsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  totalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    minWidth: '30%',
    flexGrow: 1,
    gap: 2,
  },
  totalValue: {
    ...typography.title,
    color: colors.ink,
  },
  totalLabel: {
    ...typography.caption,
    color: colors.inkSecondary,
  },
  sectionTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  quietNote: {
    ...typography.caption,
    color: colors.inkSecondary,
  },
  days: {
    gap: spacing.sm,
  },
  dayRow: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  dayDate: {
    ...typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  dayMetrics: {
    ...typography.caption,
    color: colors.inkSecondary,
  },
});
