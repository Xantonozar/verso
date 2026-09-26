import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from '../Button';
import { EmptyState } from '../EmptyState';
import { TextField } from '../TextField';
import {
  Comment,
  createComment,
  deleteComment,
  listComments,
} from '../../lib/api/engagement';
import { toast } from '../../lib/toast';
import { colors, layout, radii, spacing, typography } from '../../theme/tokens';

const PAGE_SIZE = 10;
const MAX_LEN = 500;

interface Props {
  poemId: string;
  interactive: boolean;
  currentUserId?: string;
  commentCount: number;
}

function authorName(comment: Comment): string {
  return comment.author?.displayName ?? 'Anonymous';
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function errorMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'details' in err) {
    const details = (err as { details?: unknown }).details;
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as { message?: string };
      if (first?.message) return first.message;
    }
  }
  if (err instanceof Error && err.message) return err.message;
  return 'Could not post comment';
}

/**
 * Nested, paginated comment thread (plan step 49): top-level pages with
 * embedded replies, 2-level reply composer, soft-delete of your own rows.
 */
export function CommentThread({ poemId, interactive, currentUserId, commentCount }: Props) {
  const [items, setItems] = useState<Comment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [text, setText] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);

  const fetchPage = useCallback(
    () =>
      listComments({
        targetType: 'poem',
        targetId: poemId,
        limit: PAGE_SIZE,
      }),
    [poemId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchPage()
      .then((page) => {
        if (!cancelled) {
          setItems(page.items);
          setCursor(page.nextCursor);
          setLoadFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchPage]);

  const load = useCallback(async () => {
    try {
      const page = await fetchPage();
      setItems(page.items);
      setCursor(page.nextCursor);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  const retry = () => {
    setLoading(true);
    setLoadFailed(false);
    void load();
  };

  const loadMore = async () => {
    if (!cursor) return;
    try {
      const page = await listComments({
        targetType: 'poem',
        targetId: poemId,
        cursor,
        limit: PAGE_SIZE,
      });
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch {
      toast.error('Could not load more comments');
    }
  };

  const post = async () => {
    const content = text.trim();
    if (content.length === 0) {
      setFieldError('cannot be empty');
      return;
    }
    if (content.length > MAX_LEN) {
      setFieldError(`must be at most ${MAX_LEN} characters`);
      return;
    }
    setFieldError(null);
    setPosting(true);
    try {
      const created = await createComment({
        targetType: 'poem',
        targetId: poemId,
        content,
        ...(replyTo ? { parentCommentId: replyTo.id } : {}),
      });
      if (replyTo) {
        const parentId = replyTo.id;
        setItems((prev) =>
          prev.map((item) =>
            item.id === parentId
              ? {
                  ...item,
                  replyCount: (item.replyCount ?? 0) + 1,
                  replies: [...(item.replies ?? []), created],
                }
              : item,
          ),
        );
      } else {
        setItems((prev) => [{ ...created, replyCount: 0, replies: [] }, ...prev]);
      }
      setText('');
      setReplyTo(null);
    } catch (err) {
      setFieldError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const remove = async (comment: Comment) => {
    try {
      await deleteComment(comment.id);
      if (comment.parentCommentId) {
        const parentId = comment.parentCommentId;
        setItems((prev) =>
          prev.map((item) =>
            item.id === parentId
              ? {
                  ...item,
                  replyCount: Math.max(0, (item.replyCount ?? 1) - 1),
                  replies: (item.replies ?? []).filter((r) => r.id !== comment.id),
                }
              : item,
          ),
        );
      } else {
        setItems((prev) => prev.filter((item) => item.id !== comment.id));
      }
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };

  const canDelete = (comment: Comment) =>
    comment.authorId != null &&
    currentUserId != null &&
    comment.authorId === currentUserId;

  const renderRow = (comment: Comment, isReply: boolean) => (
    <View key={comment.id} style={[styles.row, isReply && styles.replyRow]} testID={`comment-${comment.id}`}>
      <View style={styles.rowHeader}>
        <Text style={styles.author}>{authorName(comment)}</Text>
        <Text style={styles.date}>{formatDate(comment.createdAt)}</Text>
      </View>
      <Text style={styles.content} testID={`comment-content-${comment.id}`}>
        {comment.content}
      </Text>
      {interactive && !isReply ? (
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => {
              setFieldError(null);
              setReplyTo({ id: comment.id, name: authorName(comment) });
            }}
            accessibilityRole="button"
            accessibilityLabel={`Reply to ${authorName(comment)}`}
            testID={`reply-${comment.id}`}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>Reply</Text>
          </Pressable>
          {canDelete(comment) ? (
            <Pressable
              onPress={() => {
                void remove(comment);
              }}
              accessibilityRole="button"
              accessibilityLabel="Delete comment"
              testID={`delete-comment-${comment.id}`}
              style={styles.action}
            >
              <Text style={[styles.actionLabel, styles.deleteLabel]}>Delete</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {interactive && isReply && canDelete(comment) ? (
        <View style={styles.rowActions}>
          <Pressable
            onPress={() => {
              void remove(comment);
            }}
            accessibilityRole="button"
            accessibilityLabel="Delete reply"
            testID={`delete-comment-${comment.id}`}
            style={styles.action}
          >
            <Text style={[styles.actionLabel, styles.deleteLabel]}>Delete</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.section} testID="comment-thread">
      <Text style={styles.heading} accessibilityRole="header">
        Comments {commentCount > 0 ? `(${commentCount})` : ''}
      </Text>

      {loading ? (
        <Text style={styles.meta}>Loading comments…</Text>
      ) : loadFailed ? (
        <View style={styles.metaRow}>
          <Text style={styles.meta}>Couldn&apos;t load comments.</Text>
          <Button label="Try again" variant="secondary" onPress={retry} />
        </View>
      ) : items.length === 0 ? (
        <EmptyState title="No comments yet" subtitle="Be the first to respond." />
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <View key={item.id}>
              {renderRow(item, false)}
              {(item.replies ?? []).map((reply) => renderRow(reply, true))}
            </View>
          ))}
          {cursor ? (
            <Button
              label="Load more"
              variant="secondary"
              onPress={() => void loadMore()}
              testID="comments-load-more"
            />
          ) : null}
        </View>
      )}

      {interactive ? (
        <View style={styles.composer}>
          {replyTo ? (
            <View style={styles.replyBanner}>
              <Text style={styles.replyText}>Replying to {replyTo.name}</Text>
              <Pressable
                onPress={() => setReplyTo(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel reply"
                testID="reply-cancel"
                style={styles.action}
              >
                <Text style={styles.actionLabel}>Cancel</Text>
              </Pressable>
            </View>
          ) : null}
          <TextField
            label="Add a comment"
            value={text}
            onChangeText={(value) => {
              setText(value);
              if (fieldError) setFieldError(null);
            }}
            placeholder="Say something kind"
            multiline
            error={fieldError ?? undefined}
            testID="comment-input"
          />
          <Button
            label={replyTo ? 'Post reply' : 'Post comment'}
            onPress={() => void post()}
            loading={posting}
            testID="comment-submit"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.lg,
  },
  heading: {
    ...typography.label,
    color: colors.inkSecondary,
    fontWeight: '600',
  },
  meta: {
    ...typography.body,
    color: colors.inkMuted,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  list: {
    gap: spacing.md,
  },
  row: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  replyRow: {
    marginLeft: spacing.xl,
    backgroundColor: colors.surfaceAlt,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  author: {
    ...typography.label,
    color: colors.ink,
    fontWeight: '600',
  },
  date: {
    ...typography.caption,
    color: colors.inkMuted,
  },
  content: {
    ...typography.body,
    color: colors.ink,
  },
  rowActions: {
    flexDirection: 'row',
    gap: spacing.lg,
  },
  action: {
    minHeight: layout.touchTargetMin - 8,
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  actionLabel: {
    ...typography.label,
    color: colors.accent,
    fontWeight: '600',
  },
  deleteLabel: {
    color: colors.error,
  },
  composer: {
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
  },
  replyBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  replyText: {
    ...typography.label,
    color: colors.inkSecondary,
    fontStyle: 'italic',
  },
});
