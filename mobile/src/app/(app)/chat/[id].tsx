import { router, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../components/Button';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/LoadingState';
import { TextField } from '../../../components/TextField';
import { Message, listMessages, sendMessage } from '../../../lib/api/messaging';
import { colors, layout, radii, spacing, typography } from '../../../theme/tokens';

type LoadState = 'loading' | 'ready' | 'error';
type SendStatus = 'sending' | 'sent' | 'failed';

/** Server message plus local delivery state for the optimistic send path. */
type ChatMessage = Message & { status?: SendStatus };

type Params = {
  id: string;
  other: string;
  anon: string;
};

const HISTORY_LIMIT = 30;

/**
 * DM thread (plan step 76): cursor history (newest page first, older pages on
 * demand), optimistic send with pending/sent/failed states + retry, and the
 * per-message anonymous toggle (hidden when the whole thread is anonymous).
 */
export default function ChatScreen() {
  const { id, other, anon } = useLocalSearchParams<Params>();
  const conversationId = id ?? '';
  const threadAnonymous = anon === '1';

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadState, setLoadState] = useState<LoadState>(
    conversationId ? 'loading' : 'error',
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [olderLoading, setOlderLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(threadAnonymous);
  const tempSeq = useRef(0);

  const title = threadAnonymous
    ? 'Anonymous conversation'
    : (typeof other === 'string' && other.trim()) || 'Conversation';

  const load = useCallback((): Promise<void> => {
    setLoadState('loading');
    return listMessages(conversationId, { limit: HISTORY_LIMIT })
      .then((page) => {
        setMessages(page.items);
        setNextCursor(page.nextCursor);
        setLoadState('ready');
      })
      .catch(() => {
        setLoadState('error');
      });
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    listMessages(conversationId, { limit: HISTORY_LIMIT })
      .then((page) => {
        if (!cancelled) {
          setMessages(page.items);
          setNextCursor(page.nextCursor);
          setLoadState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setLoadState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  async function loadOlder() {
    if (!nextCursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const page = await listMessages(conversationId, {
        cursor: nextCursor,
        limit: HISTORY_LIMIT,
      });
      setMessages((prev) => [...prev, ...page.items]);
      setNextCursor(page.nextCursor);
    } catch {
      // keep the cursor so the user can retry with the same button
    } finally {
      setOlderLoading(false);
    }
  }

  async function attemptSend(content: string, tempId?: string) {
    const trimmed = content.trim();
    if (!trimmed) return;

    let key = tempId;
    if (!key) {
      tempSeq.current += 1;
      key = `temp-${tempSeq.current}`;
      const optimistic: ChatMessage = {
        id: key,
        conversationId,
        content: trimmed,
        isMine: true,
        isAnonymous: anonymous,
        senderId: null,
        sender: null,
        readAt: null,
        createdAt: new Date().toISOString(),
        status: 'sending',
      };
      setMessages((prev) => [optimistic, ...prev]);
      setDraft('');
    } else {
      setMessages((prev) =>
        prev.map((m) => (m.id === key ? { ...m, status: 'sending' } : m)),
      );
    }

    try {
      const sent = await sendMessage(conversationId, trimmed, anonymous);
      setMessages((prev) =>
        prev.map((m) => (m.id === key ? { ...sent, status: 'sent' } : m)),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) => (m.id === key ? { ...m, status: 'failed' } : m)),
      );
    }
  }

  async function sendDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    await attemptSend(trimmed);
  }

  async function retry(message: ChatMessage) {
    await attemptSend(message.content, message.id);
  }

  const chronological = [...messages].reverse();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Button label="Back" variant="secondary" onPress={() => router.back()} testID="chat-back" />
        <Text style={styles.heading} numberOfLines={1}>
          {title}
        </Text>
        {threadAnonymous ? (
          <Text style={styles.anonNote} testID="chat-thread-anon">
            Both sides are anonymous
          </Text>
        ) : (
          <Button
            label={anonymous ? 'Anonymous: On' : 'Anonymous: Off'}
            variant={anonymous ? 'primary' : 'secondary'}
            onPress={() => setAnonymous((prev) => !prev)}
            testID="chat-anon-toggle"
          />
        )}
      </View>

      {loadState === 'loading' ? (
        <LoadingState label="Loading conversation..." />
      ) : loadState === 'error' ? (
        <ErrorState message="Couldn't load this conversation." onRetry={load} />
      ) : (
        <ScrollView
          style={styles.thread}
          contentContainerStyle={styles.threadContent}
          testID="chat-thread"
        >
          {nextCursor ? (
            <Button
              label={olderLoading ? 'Loading…' : 'Load earlier messages'}
              variant="secondary"
              onPress={loadOlder}
              disabled={olderLoading}
              testID="chat-load-older"
            />
          ) : null}
          {chronological.length === 0 ? (
            <Text style={styles.emptyThread} testID="chat-empty">
              No messages yet — say hello.
            </Text>
          ) : (
            chronological.map((message) => (
              <View
                key={message.id}
                style={[styles.bubble, message.isMine ? styles.bubbleMine : styles.bubbleTheirs]}
                testID={`message-${message.id}`}
              >
                {!message.isMine && message.sender ? (
                  <Text style={styles.sender} numberOfLines={1}>
                    {message.sender.displayName}
                  </Text>
                ) : null}
                {message.isAnonymous ? (
                  <Text style={styles.anonymousTag} testID={`anon-${message.id}`}>
                    Anonymous
                  </Text>
                ) : null}
                <Text style={styles.content}>{message.content}</Text>
                {message.status === 'sending' ? (
                  <Text style={styles.status} testID={`status-${message.id}`}>
                    Sending…
                  </Text>
                ) : null}
                {message.status === 'failed' ? (
                  <Button
                    label="Failed — tap to retry"
                    variant="secondary"
                    onPress={() => retry(message)}
                    testID={`retry-${message.id}`}
                  />
                ) : null}
              </View>
            ))
          )}
        </ScrollView>
      )}

      <View style={styles.composer}>
        <TextField
          label="Message"
          value={draft}
          onChangeText={setDraft}
          placeholder={anonymous ? 'Send anonymously' : 'Write a message'}
          testID="chat-input"
        />
        <Button
          label="Send"
          onPress={sendDraft}
          disabled={!draft.trim()}
          testID="chat-send"
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
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  heading: {
    ...typography.title,
    fontSize: 22,
    color: colors.ink,
  },
  anonNote: {
    ...typography.label,
    color: colors.inkSecondary,
  },
  thread: {
    flex: 1,
  },
  threadContent: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  emptyThread: {
    ...typography.body,
    color: colors.inkSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xxl,
  },
  bubble: {
    maxWidth: '85%',
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.xs,
  },
  bubbleMine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.accentSoft,
  },
  bubbleTheirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
  },
  sender: {
    ...typography.label,
    fontWeight: '600',
    color: colors.ink,
  },
  anonymousTag: {
    ...typography.caption,
    color: colors.accent,
    fontWeight: '700',
  },
  content: {
    ...typography.body,
    color: colors.ink,
  },
  status: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  composer: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
