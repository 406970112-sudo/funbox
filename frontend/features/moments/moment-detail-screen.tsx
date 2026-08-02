import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAvatar } from '@/features/social/social-ui';
import { useSocial } from '@/features/social/social-provider';
import {
  createMomentComment,
  deleteMoment,
  deleteMomentComment,
  getMoment,
  getMomentErrorMessage,
  likeMoment,
  listMomentComments,
  reportMoment,
  unlikeMoment,
  updateMomentVisibility,
} from '@/lib/moments-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import { applyMomentComment, applyMomentLike } from '@/lib/moments-model';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { Moment, MomentComment } from '@/types/moments';

import { formatMomentTime, MomentAttachmentCard, MomentImageGrid } from './moment-ui';

export function MomentDetailScreen() {
  const router = useRouter();
  const { momentId } = useLocalSearchParams<{ momentId: string }>();
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const { friends } = useSocial();
  const [moment, setMoment] = useState<Moment | null>(null);
  const [comments, setComments] = useState<MomentComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [replyTo, setReplyTo] = useState<MomentComment | null>(null);
  const [mentionIDs, setMentionIDs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!accessToken || !momentId) return;
    try {
      const [detail, commentPage] = await Promise.all([
        getMoment(accessToken, momentId),
        listMomentComments(accessToken, momentId),
      ]);
      setMoment(detail);
      setComments(commentPage.comments);
      setError('');
    } catch (caught) {
      setError(getMomentErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [accessToken, momentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleLike = useCallback(async () => {
    if (!accessToken || !moment) return;
    const next = !moment.likedByMe;
    setMoment(applyMomentLike(moment, next));
    try {
      if (next) {
        await likeMoment(accessToken, moment.id);
      } else {
        await unlikeMoment(accessToken, moment.id);
      }
    } catch (caught) {
      setError(getMomentErrorMessage(caught));
      await load();
    }
  }, [accessToken, load, moment]);

  const submitComment = useCallback(async () => {
    if (!accessToken || !moment || !commentBody.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await createMomentComment(accessToken, moment.id, {
        body: commentBody.trim(),
        mentionUserIds: mentionIDs,
        parentId: replyTo?.id,
      });
      setComments((items) => [...items, created]);
      setCommentBody('');
      setReplyTo(null);
      setMentionIDs([]);
      setMoment(applyMomentComment(moment, created));
    } catch (caught) {
      setError(getMomentErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }, [accessToken, commentBody, mentionIDs, moment, replyTo]);

  const removeComment = useCallback(
    async (comment: MomentComment) => {
      if (!accessToken) return;
      try {
        await deleteMomentComment(accessToken, comment.id);
        setComments((items) => items.filter((item) => item.id !== comment.id));
        if (moment) setMoment({ ...moment, commentCount: Math.max(0, moment.commentCount - 1) });
      } catch (caught) {
        setError(getMomentErrorMessage(caught));
      }
    },
    [accessToken, moment],
  );

  const toggleMention = useCallback(
    (friendId: string, displayName: string) => {
      setMentionIDs((current) => {
        const exists = current.includes(friendId);
        if (exists) {
          setCommentBody((body) => body.replace(`@${displayName} `, ''));
          return current.filter((id) => id !== friendId);
        }
        setCommentBody((body) => `${body}@${displayName} `);
        return [...current, friendId];
      });
    },
    [],
  );

  const mentionableFriends = useMemo(() => friends.slice(0, 8), [friends]);

  if (loading) {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </MobileScreen>
    );
  }

  if (!moment) {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <ThemedText style={styles.errorText}>{error || '这条动态已不存在或已删除。'}</ThemedText>
        <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
          <ThemedText style={styles.backButtonText}>返回</ThemedText>
        </Pressable>
      </MobileScreen>
    );
  }

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.pageTitle}>动态详情</ThemedText>
        {moment.canDelete ? (
          <Pressable
            accessibilityLabel="删除动态"
            accessibilityRole="button"
            onPress={() => {
              if (!accessToken) return;
              void deleteMoment(accessToken, moment.id).then(() => router.back());
            }}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="delete-outline" size={19} color="#d86f5b" />
          </Pressable>
        ) : (
          <Pressable
            accessibilityLabel="举报"
            accessibilityRole="button"
            onPress={() => {
              if (!accessToken) return;
              void reportMoment(accessToken, moment.id, '内容不合适');
            }}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="flag-outline" size={18} color={colors.mutedText} />
          </Pressable>
        )}
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={comments}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <DetailHeader moment={moment} onLikePress={() => void toggleLike()} />
            {moment.images.length > 0 ? <MomentImageGrid images={moment.images} /> : null}
            {moment.attachments.map((attachment) => (
              <MomentAttachmentCard attachment={attachment} key={attachment.refId} />
            ))}
            <View style={styles.commentHeader}>
              <ThemedText style={styles.commentTitle}>评论 {moment.commentCount}</ThemedText>
              {moment.visibility === 'self' && moment.canDelete ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (!accessToken) return;
                    void updateMomentVisibility(accessToken, moment.id, 'friends').then(load);
                  }}>
                  <ThemedText style={styles.switchText}>改为仅好友可见</ThemedText>
                </Pressable>
              ) : null}
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <CommentRow
            comment={item}
            onDelete={() => void removeComment(item)}
            onReply={() => setReplyTo(item)}
          />
        )}
        showsVerticalScrollIndicator={false}
        style={styles.list}
      />

      <View style={[styles.inputBar, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
        {replyTo ? (
          <View style={styles.replyPill}>
            <ThemedText numberOfLines={1} style={styles.replyPillText}>
              回复 {replyTo.author.displayName}
            </ThemedText>
            <Pressable accessibilityRole="button" onPress={() => setReplyTo(null)}>
              <MaterialCommunityIcons name="close" size={14} color={colors.mutedText} />
            </Pressable>
          </View>
        ) : null}
        {mentionableFriends.length > 0 ? (
          <View style={styles.mentionRow}>
            {mentionableFriends.map((friend) => {
              const selected = mentionIDs.includes(friend.user.id);
              return (
                <Pressable
                  accessibilityRole="button"
                  key={friend.user.id}
                  onPress={() => toggleMention(friend.user.id, friend.user.displayName)}
                  style={[
                    styles.mentionChip,
                    {
                      backgroundColor: selected ? colors.primary : colors.surfaceMuted,
                      borderColor: selected ? colors.primary : colors.line,
                    },
                  ]}>
                  <ThemedText
                    numberOfLines={1}
                    style={[styles.mentionChipText, { color: selected ? '#ffffff' : colors.mutedText }]}>
                    @{friend.user.displayName}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        <View style={styles.inputRow}>
          <TextInput
            multiline
            onChangeText={setCommentBody}
            placeholder={replyTo ? `回复 ${replyTo.author.displayName}` : '评论一下...'}
            placeholderTextColor={colors.mutedText}
            style={[styles.commentInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
            value={commentBody}
          />
          <Pressable
            accessibilityLabel="发送评论"
            accessibilityRole="button"
            disabled={submitting || !commentBody.trim()}
            onPress={() => void submitComment()}
            style={[styles.sendButton, (submitting || !commentBody.trim()) && styles.pressed]}>
            {submitting ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <MaterialCommunityIcons name="send" size={17} color="#ffffff" />
            )}
          </Pressable>
        </View>
        {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
      </View>
    </MobileScreen>
  );
}

function DetailHeader({
  moment,
  onLikePress,
}: {
  moment: Moment;
  onLikePress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.detailHeader}>
      <SocialAvatar size={46} user={moment.author} />
      <View style={styles.detailAuthor}>
        <ThemedText style={styles.detailName}>{moment.author.displayName}</ThemedText>
        <ThemedText style={[styles.detailTime, { color: colors.mutedText }]}>
          {formatMomentTime(moment.createdAt)} · {moment.visibility === 'self' ? '仅自己可见' : '好友可见'}
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel="点赞"
        accessibilityRole="button"
        onPress={onLikePress}
        style={[styles.likeButton, { backgroundColor: moment.likedByMe ? '#ffe9ef' : colors.surfaceMuted }]}>
        <MaterialCommunityIcons
          name={moment.likedByMe ? 'heart' : 'heart-outline'}
          size={17}
          color={moment.likedByMe ? '#ff6b8f' : colors.mutedText}
        />
        <ThemedText
          style={[
            styles.likeButtonText,
            { color: moment.likedByMe ? '#ff6b8f' : colors.mutedText },
          ]}>
          {moment.likeCount}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function CommentRow({
  comment,
  onDelete,
  onReply,
}: {
  comment: MomentComment;
  onDelete: () => void;
  onReply: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.commentRow, { borderBottomColor: colors.line }]}>
      <SocialAvatar size={34} user={comment.author} />
      <View style={styles.commentCopy}>
        <View style={styles.commentNameRow}>
          <ThemedText style={styles.commentAuthor}>{comment.author.displayName}</ThemedText>
          {comment.parentId ? <ThemedText style={styles.replyTag}>回复</ThemedText> : null}
          <ThemedText style={[styles.commentTime, { color: colors.mutedText }]}>
            {formatMomentTime(comment.createdAt)}
          </ThemedText>
        </View>
        <ThemedText style={styles.commentBody}>{comment.body}</ThemedText>
        <View style={styles.commentActions}>
          <Pressable accessibilityRole="button" onPress={onReply}>
            <ThemedText style={[styles.commentActionText, { color: colors.mutedText }]}>回复</ThemedText>
          </Pressable>
          {comment.canDelete ? (
            <Pressable accessibilityRole="button" onPress={onDelete}>
              <ThemedText style={styles.deleteText}>删除</ThemedText>
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    marginTop: 16,
  },
  backButtonText: {
    color: '#4b6bff',
    fontSize: 14,
    fontWeight: '800',
  },
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 5,
  },
  commentActionText: {
    fontSize: 10.5,
    fontWeight: '700',
  },
  commentAuthor: {
    fontSize: 12,
    fontWeight: '800',
  },
  commentBody: {
    fontSize: 12.5,
    lineHeight: 19,
    marginTop: 4,
  },
  commentCopy: {
    flex: 1,
    minWidth: 0,
  },
  commentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 20,
  },
  commentInput: {
    borderRadius: 12,
    flex: 1,
    fontSize: 13,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  commentNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  commentRow: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 12,
  },
  commentTime: {
    fontSize: 9.5,
  },
  commentTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  deleteText: {
    color: '#d86f5b',
    fontSize: 10.5,
    fontWeight: '700',
  },
  detailAuthor: {
    flex: 1,
    minWidth: 0,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
    marginBottom: 12,
    marginTop: 16,
  },
  detailName: {
    fontSize: 16,
    fontWeight: '900',
  },
  detailTime: {
    fontSize: 10.5,
    marginTop: 3,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 12,
    marginTop: 10,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
    paddingBottom: 12,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  inputRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 8,
  },
  likeButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  likeButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 18,
  },
  mentionChip: {
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 110,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  mentionChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  mentionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  page: {
    flex: 1,
    paddingTop: 14,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.6,
  },
  replyPill: {
    alignItems: 'center',
    backgroundColor: '#eef2ff',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  replyPillText: {
    color: '#4b6bff',
    flexShrink: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  replyTag: {
    color: '#7483a2',
    fontSize: 9.5,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 44,
  },
  switchText: {
    color: '#4b6bff',
    fontSize: 11,
    fontWeight: '700',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});
