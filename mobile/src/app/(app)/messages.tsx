import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { LoadingState } from '../../components/LoadingState';
import { ConversationSummary, listConversations } from '../../lib/api/messaging';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * DM inbox (plan step 76, screen table line 939): conversation list with
 * last-message preview, unread badge, and the anonymous-thread indicator.
 * Opening a row routes into /chat/[id].
 */
export default function MessagesScreen() {
  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loadState, setLoadState] = useState<LoadState>('loading');

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return listConversations()
      .then((page) => {
        setItems(page.items);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    listConversations()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openConversation(conversation: ConversationSummary) {
    router.push({
      pathname: '/chat/[id]',
      params: {
        id: conversation.id,
        other: conversation.otherUser?.displayName ?? '',
        anon: conversation.isAnonymous ? '1' : '0',
      },
    });
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="messages-back" />
        <Text style={styles.heading}>Messages</Text>

        {loadState === 'loading' ? (
          <LoadingState label="Loading messages..." />
        ) : loadState === 'error' ? (
          <ErrorState message="Couldn't load your messages." onRetry={load} />
        ) : items.length === 0 ? (
          <View testID="messages-empty">
            <EmptyState
              title="No conversations yet"
              subtitle="Open a poet's profile and tap Message to start talking."
            />
          </View>
        ) : (
          <View style={styles.list} testID="messages-list">
            {items.map((conversation) => {
              const title = conversation.isAnonymous
                ? 'Anonymous conversation'
                : conversation.otherUser?.displayName || 'Conversation';
              const handle = conversation.isAnonymous
                ? null
                : conversation.otherUser?.username || null;
              return (
                <Pressable
                  key={conversation.id}
                  onPress={() => openConversation(conversation)}
                  accessibilityRole="button"
                  accessibilityLabel={`Conversation with ${title}`}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                  testID={`conversation-item-${conversation.id}`}
                >
                  <View style={styles.rowMain}>
                    <View style={styles.rowHeader}>
                      <Text style={styles.rowTitle} numberOfLines={1}>
                        {title}
                      </Text>
                      {conversation.unreadCount > 0 ? (
                        <View
                          style={styles.unreadBadge}
                          accessibilityLabel={`${conversation.unreadCount} unread`}
                        >
                          <Text style={styles.unreadText}>{conversation.unreadCount}</Text>
                        </View>
                      ) : null}
                    </View>
                    {handle ? <Text style={styles.rowHandle}>@{handle}</Text> : null}
                    <Text style={styles.rowPreview} numberOfLines={1}>
                      {conversation.isAnonymous ? 'Anonymous: ' : ''}
                      {conversation.lastMessage?.content ?? 'No messages yet'}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
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
  heading: {
    ...typography.title,
    color: colors.ink,
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
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  rowTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.ink,
    flexShrink: 1,
  },
  rowHandle: {
    ...typography.caption,
    color: colors.inkSecondary,
  },
  rowPreview: {
    ...typography.body,
    color: colors.inkSecondary,
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
});
