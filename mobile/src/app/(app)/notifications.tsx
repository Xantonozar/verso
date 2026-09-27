import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import {
  listNotifications,
  markNotificationRead,
  NotificationItem,
  setPushToken,
} from '../../lib/api/notifications';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error';
type PushStatus = 'unknown' | 'granted' | 'denied' | 'undetermined';

/**
 * Notifications inbox (plan steps 78/81): poetic event feed with unread
 * badge, mark-as-read on view, cursor "load older", and a pre-permission
 * push explainer that registers the Expo push token after the OS prompt.
 */
export default function NotificationsScreen() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>('unknown');
  const [pushDismissed, setPushDismissed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const markedRef = useRef<Set<string>>(new Set());
  const aliveRef = useRef(true);

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return listNotifications()
      .then((page) => {
        setItems(page.items);
        setUnreadCount(page.unreadCount);
        setNextCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    listNotifications()
      .then((page) => {
        if (cancelled) return;
        setItems(page.items);
        setUnreadCount(page.unreadCount);
        setNextCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    Notifications.getPermissionsAsync()
      .then((result) => {
        if (!cancelled) setPushStatus(result.status as PushStatus);
      })
      .catch(() => {
        if (!cancelled) setPushStatus('unknown');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Mark-on-view: every loaded row counts as seen; guarded by markedRef so
  // state updates from successful marks never re-trigger the same calls.
  useEffect(() => {
    items.forEach((item) => {
      if (!item.isUnread || markedRef.current.has(item.id)) return;
      markedRef.current.add(item.id);
      markNotificationRead(item.id)
        .then((updated) => {
          if (!aliveRef.current) return;
          setItems((prev) =>
            prev.map((row) =>
              row.id === updated.id ? { ...row, isUnread: false, readAt: updated.readAt } : row,
            ),
          );
          setUnreadCount((count) => Math.max(0, count - 1));
        })
        .catch(() => {
          markedRef.current.delete(item.id);
        });
    });
  }, [items]);

  const loadMore = useCallback(() => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    listNotifications({ cursor: nextCursor })
      .then((page) => {
        if (!aliveRef.current) return;
        setItems((prev) => [...prev, ...page.items]);
        setUnreadCount(page.unreadCount);
        setNextCursor(page.nextCursor);
      })
      .catch(() => {
        // Keep what we have; the button stays for another attempt.
      })
      .finally(() => {
        setLoadingMore(false);
      });
  }, [nextCursor, loadingMore]);

  async function enablePush() {
    setPushBusy(true);
    try {
      if (Platform.OS === 'android') {
        // Android 13+ shows the OS prompt only after a channel exists.
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Verso alerts',
          importance: Notifications.AndroidImportance.HIGH,
        });
      }
      const result = await Notifications.requestPermissionsAsync();
      setPushStatus(result.status as PushStatus);
      if (result.status !== 'granted') return;
      const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
      const projectId = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
      const token = (
        await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
      ).data;
      await setPushToken(token);
    } catch {
      // Token fetch can fail offline; permission itself may still be granted.
    } finally {
      setPushBusy(false);
    }
  }

  function openRelated(item: NotificationItem) {
    if (item.relatedType === 'poem') {
      router.push(`/poem/${item.relatedId}`);
    } else if (item.relatedType === 'user') {
      router.push(`/user/${item.relatedId}`);
    } else if (item.relatedType === 'collab_poem') {
      router.push(`/collab-poem/${item.relatedId}`);
    } else if (item.relatedType === 'duel') {
      router.push('/duel');
    }
  }

  const showPushCard = !pushDismissed && pushStatus !== 'granted';

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button
          label="Back"
          variant="secondary"
          onPress={() => router.back()}
          testID="notifications-back"
        />
        <View style={styles.headerRow}>
          <Text style={styles.heading}>Notifications</Text>
          {unreadCount > 0 ? (
            <View
              testID="unread-badge"
              style={styles.unreadBadge}
              accessibilityLabel={`${unreadCount} unread`}
            >
              <Text style={styles.unreadText}>{unreadCount}</Text>
            </View>
          ) : null}
        </View>

        {showPushCard ? (
          <View style={styles.pushCard} testID="push-explainer">
            <Text style={styles.pushTitle}>Never miss a response</Text>
            <Text style={styles.pushBody}>
              Get a gentle alert when someone reacts to your poem, leaves a comment, or follows
              you.
            </Text>
            {pushStatus === 'denied' ? (
              <Text style={styles.pushDenied} testID="push-denied-note">
                Notifications are turned off for Verso. You can turn them back on in your device
                settings at any time.
              </Text>
            ) : (
              <Button
                label="Turn on alerts"
                onPress={() => {
                  void enablePush();
                }}
                loading={pushBusy}
                testID="push-enable"
              />
            )}
            <Button
              label="Not now"
              variant="secondary"
              onPress={() => setPushDismissed(true)}
              testID="push-dismiss"
            />
          </View>
        ) : null}

        {loadState === 'loading' ? (
          <LoadingState label="Loading notifications..." />
        ) : loadState === 'error' ? (
          <ErrorState message="Couldn't load your notifications." onRetry={load} />
        ) : items.length === 0 ? (
          <View testID="notifications-empty">
            <EmptyState
              title="You're all caught up."
              subtitle="Reactions, comments, follows, and duel results will land here."
            />
          </View>
        ) : (
          <View style={styles.list} testID="notifications-list">
            {items.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => openRelated(item)}
                accessibilityRole="button"
                accessibilityLabel={item.poeticMessage}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                testID={`notification-item-${item.id}`}
              >
                <View style={styles.rowMain}>
                  <View style={styles.rowHeader}>
                    <Text style={styles.rowMessage} numberOfLines={3}>
                      {item.poeticMessage}
                    </Text>
                    {item.isUnread ? <View style={styles.rowDot} /> : null}
                  </View>
                  <Text style={styles.rowMeta}>
                    {item.type.replace('_', ' ')} · {new Date(item.createdAt).toLocaleString()}
                  </Text>
                </View>
              </Pressable>
            ))}
            {nextCursor ? (
              <Button
                label={loadingMore ? 'Loading…' : 'Load older'}
                variant="secondary"
                onPress={loadMore}
                testID="notifications-load-more"
              />
            ) : null}
          </View>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  heading: {
    ...typography.title,
    color: colors.ink,
  },
  unreadBadge: {
    minWidth: 24,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    alignItems: 'center',
  },
  unreadText: {
    ...typography.caption,
    color: colors.onAccent,
    fontWeight: '700',
  },
  pushCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
  },
  pushTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.ink,
  },
  pushBody: {
    ...typography.body,
    color: colors.inkSecondary,
  },
  pushDenied: {
    ...typography.caption,
    color: colors.inkSecondary,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowPressed: {
    backgroundColor: colors.surfaceAlt,
  },
  rowMain: {
    gap: spacing.xs,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowMessage: {
    ...typography.body,
    color: colors.ink,
    flexShrink: 1,
  },
  rowDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    marginTop: spacing.xs,
  },
  rowMeta: {
    ...typography.caption,
    color: colors.inkSecondary,
    textTransform: 'capitalize',
  },
});
