import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { EmptyState } from './EmptyState';
import { ErrorState } from './ErrorState';
import { FeedCard } from './FeedCard';
import { Skeleton } from './Skeleton';
import { FeedItem, FeedItemPage } from '../lib/api/discover';
import { toast } from '../lib/toast';
import { CONNECTIVITY_TOAST, isConnectivityError } from '../lib/validation';
import { colors, layout, spacing, typography } from '../theme/tokens';

interface Props {
  fetchPage: (cursor: string | null) => Promise<FeedItemPage>;
  emptyTitle: string;
  emptySubtitle?: string;
  testIDPrefix: string;
}

/**
 * Cursor-paginated poem list with the four distinct states the plan demands
 * (step 56): skeleton → items (+ `end` footer when the cursor runs out) vs
 * `empty` when there's genuinely nothing, and a retryable error view.
 *
 * Remount via `key` (at the call site) to reset — a fresh instance starts in
 * the skeleton state and reloads page 1.
 */
export function PagedFeedList({ fetchPage, emptyTitle, emptySubtitle, testIDPrefix }: Props) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const fetchRef = useRef(fetchPage);

  useEffect(() => {
    fetchRef.current = fetchPage;
  });

  const load = useCallback((cursorToUse: string | null, replace: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    fetchRef
      .current(cursorToUse)
      .then((page) => {
        setItems((prev) => {
          if (replace) return page.items;
          const seen = new Set(prev.map((i) => i.id));
          return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
        });
        setCursor(page.nextCursor);
        setLoaded(true);
      })
      .catch((err) => {
        if (isConnectivityError(err)) toast.error(CONNECTIVITY_TOAST);
        setError('Could not load poems. Please try again.');
        setLoaded(true);
      })
      .finally(() => {
        inFlight.current = false;
        setLoadingMore(false);
      });
  }, []);

  useEffect(() => {
    load(null, true);
  }, [load]);

  function onEndReached() {
    if (!cursor || loadingMore || inFlight.current) return;
    setLoadingMore(true);
    load(cursor, false);
  }

  function retry() {
    setItems([]);
    setCursor(null);
    setLoaded(false);
    setError(null);
    inFlight.current = false;
    load(null, true);
  }

  const showSkeleton = !loaded && !error;
  const showEmpty = loaded && !error && items.length === 0;
  const showEnd = loaded && items.length > 0 && cursor === null;

  if (showSkeleton) {
    return (
      <View style={styles.list} testID={`${testIDPrefix}-skeleton`} accessibilityLabel="Loading poems">
        <Skeleton height={120} />
        <Skeleton height={120} />
        <Skeleton height={120} />
      </View>
    );
  }

  if (error) {
    return <ErrorState message={error} onRetry={retry} />;
  }

  if (showEmpty) {
    return <EmptyState title={emptyTitle} subtitle={emptySubtitle} />;
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <FeedCard item={item} testID={`${testIDPrefix}-item-${item.id}`} />}
      contentContainerStyle={styles.list}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.5}
      testID={`${testIDPrefix}-list`}
      ListFooterComponent={
        <View style={styles.footer} testID={`${testIDPrefix}-footer`}>
          {loadingMore ? (
            <Text style={styles.footerText} testID={`${testIDPrefix}-loading-more`}>
              Loading…
            </Text>
          ) : null}
          {showEnd ? (
            <Text style={styles.footerText} testID={`${testIDPrefix}-end`}>
              You&apos;ve reached the end
            </Text>
          ) : null}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xxxl,
    gap: spacing.md,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flexGrow: 1,
  },
  footer: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
  },
  footerText: {
    ...typography.caption,
    color: colors.inkMuted,
  },
});
