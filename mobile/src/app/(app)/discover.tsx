import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FeedCard } from '../../components/FeedCard';
import { PagedFeedList } from '../../components/PagedFeedList';
import { Skeleton } from '../../components/Skeleton';
import { ApiError } from '../../lib/api/client';
import {
  FeedItem,
  getMoodFeed,
  getTagFeed,
  getRandomPoem,
  getTrending,
} from '../../lib/api/discover';
import { toast } from '../../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../../lib/validation';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

/**
 * Discovery (Phase 5, plan step 56): four tabs — Trending (precomputed),
 * Moods, Tags (chips derived from trending), Random. Every list distinguishes
 * "nothing here yet" from "reached the end"; random surfaces the server's
 * DISCOVER_EMPTY as its own empty state.
 */
type Tab = 'trending' | 'moods' | 'tags' | 'random';

const TABS: { id: Tab; label: string }[] = [
  { id: 'trending', label: 'Trending' },
  { id: 'moods', label: 'Moods' },
  { id: 'tags', label: 'Tags' },
  { id: 'random', label: 'Random' },
];

const MOODS = ['rain', 'calm', 'joy', 'grief', 'hope', 'anger', 'love', 'awe'];

export default function DiscoverScreen() {
  const [tab, setTab] = useState<Tab>('trending');

  const [mood, setMood] = useState<string | null>(null);

  const [tagInput, setTagInput] = useState('');
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [tagPool, setTagPool] = useState<string[]>([]);
  const tagPoolLoaded = useRef(false);

  const [randomItem, setRandomItem] = useState<FeedItem | null>(null);
  const [randomLoading, setRandomLoading] = useState(false);
  const [randomEmpty, setRandomEmpty] = useState(false);
  const [randomError, setRandomError] = useState<string | null>(null);

  // Tag chips come from the trending payload — one indexed read, no extra
  // endpoint (client-side derivation, plan step 56).
  useEffect(() => {
    if (tab !== 'tags' || tagPoolLoaded.current) return;
    tagPoolLoaded.current = true;
    getTrending({ limit: 20 })
      .then((page) => {
        const pool: string[] = [];
        for (const item of page.items) {
          for (const t of item.tags) {
            if (!pool.includes(t)) pool.push(t);
          }
        }
        setTagPool(pool);
      })
      .catch(() => {
        // Chips are convenience only — manual tag entry still works.
        setTagPool([]);
      });
  }, [tab]);

  const drawRandom = useCallback(() => {
    setRandomLoading(true);
    setRandomEmpty(false);
    setRandomError(null);
    getRandomPoem()
      .then((item) => {
        setRandomItem(item);
      })
      .catch((err) => {
        if (err instanceof ApiError && err.code === 'DISCOVER_EMPTY') {
          setRandomItem(null);
          setRandomEmpty(true);
        } else if (isConnectivityError(err)) {
          toast.error(CONNECTIVITY_TOAST);
          setRandomError('Could not reach the server. Please try again.');
        } else {
          setRandomError('Could not pick a poem. Please try again.');
        }
      })
      .finally(() => setRandomLoading(false));
  }, []);

  function submitTag() {
    const trimmed = tagInput.trim().toLowerCase();
    if (!trimmed) return;
    setActiveTag(trimmed);
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Button
          label="Back"
          variant="secondary"
          onPress={() => router.back()}
          testID="discover-back"
        />
        <Text style={styles.heading}>Discover</Text>
        <View style={styles.tabRow}>
          {TABS.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              accessibilityRole="tab"
              accessibilityLabel={`${t.label} tab`}
              accessibilityState={{ selected: tab === t.id }}
              testID={`discover-tab-${t.id}`}
              style={({ pressed }) => [
                styles.tab,
                tab === t.id && styles.tabActive,
                pressed && styles.tabPressed,
              ]}
            >
              <Text style={[styles.tabLabel, tab === t.id && styles.tabLabelActive]}>{t.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.body}>
        {tab === 'trending' ? (
          <PagedFeedList
            fetchPage={(cursor) => getTrending({ cursor, limit: 20 })}
            emptyTitle="Nothing trending yet"
            emptySubtitle="Published poems with recent reactions will show up here."
            testIDPrefix="trending"
          />
        ) : null}

        {tab === 'moods' ? (
          <View style={styles.tabPane}>
            <ScrollView
              horizontal
              contentContainerStyle={styles.chipRow}
              testID="mood-chips"
              accessibilityLabel="Mood picker"
            >
              {MOODS.map((m) => (
                <Pressable
                  key={m}
                  onPress={() => setMood(m)}
                  accessibilityRole="button"
                  accessibilityLabel={`Mood ${m}`}
                  accessibilityState={{ selected: mood === m }}
                  testID={`mood-chip-${m}`}
                  style={({ pressed }) => [
                    styles.chip,
                    mood === m && styles.chipActive,
                    pressed && styles.chipPressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, mood === m && styles.chipLabelActive]}>{m}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {mood ? (
              <PagedFeedList
                key={`mood:${mood}`}
                fetchPage={(cursor) => getMoodFeed(mood, { cursor, limit: 20 })}
                emptyTitle="Nothing here yet"
                emptySubtitle={`No published poems carry the mood “${mood}” right now.`}
                testIDPrefix="mood-list"
              />
            ) : (
              <EmptyState
                title="Pick a mood"
                subtitle="Choose a mood above to see poems that carry it."
              />
            )}
          </View>
        ) : null}

        {tab === 'tags' ? (
          <View style={styles.tabPane}>
            <View style={styles.tagInputRow}>
              <TextInput
                value={tagInput}
                onChangeText={setTagInput}
                onSubmitEditing={submitTag}
                placeholder="Search a tag"
                placeholderTextColor={colors.inkMuted}
                accessibilityLabel="Tag search"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.tagInput}
                testID="tags-input"
              />
              <Button label="Go" onPress={submitTag} style={styles.tagGo} testID="tags-go" />
            </View>

            {tagPool.length > 0 ? (
              <ScrollView
                horizontal
                contentContainerStyle={styles.chipRow}
                testID="tag-chips"
                accessibilityLabel="Popular tags"
              >
                {tagPool.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => {
                      setTagInput(t);
                      setActiveTag(t);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Tag ${t}`}
                    accessibilityState={{ selected: activeTag === t }}
                    testID={`tag-chip-${t}`}
                    style={({ pressed }) => [
                      styles.chip,
                      activeTag === t && styles.chipActive,
                      pressed && styles.chipPressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, activeTag === t && styles.chipLabelActive]}>
                      #{t}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {activeTag ? (
              <PagedFeedList
                key={`tag:${activeTag}`}
                fetchPage={(cursor) => getTagFeed(activeTag, { cursor, limit: 20 })}
                emptyTitle="Nothing here yet"
                emptySubtitle={`No published poems carry #${activeTag} right now.`}
                testIDPrefix="tag-list"
              />
            ) : (
              <EmptyState
                title="Pick a tag"
                subtitle="Tap a tag above or type one to see poems with it."
              />
            )}
          </View>
        ) : null}

        {tab === 'random' ? (
          <View style={styles.randomPane}>
            {randomLoading ? (
              <View style={styles.randomSkeleton} testID="random-skeleton" accessibilityLabel="Picking a poem">
                <Skeleton height={140} />
              </View>
            ) : null}

            {randomError ? <ErrorState message={randomError} onRetry={drawRandom} /> : null}

            {randomEmpty ? (
              <EmptyState
                title="Nothing published yet"
                subtitle="There are no published poems to pick from right now."
              />
            ) : null}

            {randomItem ? (
              <View style={styles.randomCard} testID="random-result">
                <FeedCard item={randomItem} testID="random-item" />
              </View>
            ) : null}

            {!randomError ? (
              <Button
                label={randomItem ? 'Draw another' : 'Give me a poem'}
                onPress={drawRandom}
                loading={randomLoading}
                testID="discover-random"
              />
            ) : null}
          </View>
        ) : null}
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
    paddingTop: spacing.md,
  },
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tab: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 36,
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  tabPressed: {
    opacity: 0.8,
  },
  tabLabel: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  tabLabelActive: {
    color: colors.onAccent,
  },
  tabPane: {
    flex: 1,
    gap: spacing.md,
  },
  chipRow: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.accent,
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipLabel: {
    ...typography.label,
    color: colors.inkSecondary,
    textTransform: 'lowercase',
  },
  chipLabelActive: {
    color: colors.accent,
  },
  tagInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
  },
  tagInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: 44,
    ...typography.body,
    color: colors.ink,
  },
  tagGo: {
    paddingHorizontal: spacing.lg,
  },
  randomPane: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  randomSkeleton: {
    gap: spacing.md,
  },
  randomCard: {
    gap: spacing.md,
  },
});
