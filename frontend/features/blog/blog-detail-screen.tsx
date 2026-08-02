import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, useLocalSearchParams, useRouter } from 'expo-router';
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
  createBlogComment,
  deleteBlogComment,
  getBlogErrorMessage,
  getBlogPost,
  likeBlogPost,
  listBlogComments,
  reportBlogPost,
  unlikeBlogPost,
} from '@/lib/blog-api';
import { applyBlogComment, applyBlogLike, buildBlogCommentThread } from '@/lib/blog-model';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { BlogComment, BlogPost, BlogVisibility } from '@/types/blog';

import { BlogCoverArt, formatBlogTime, BlogVisibilitySegmented } from './blog-ui';

export function BlogDetailScreen() {
  const router = useRouter();
  const { postId } = useLocalSearchParams<{ postId: string }>();
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const { friends } = useSocial();
  const [post, setPost] = useState<BlogPost | null>(null);
  const [comments, setComments] = useState<BlogComment[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [replyTo, setReplyTo] = useState<BlogComment | null>(null);
  const [mentionIDs, setMentionIDs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showVisibility, setShowVisibility] = useState(false);

  const load = useCallback(async () => {
    const id = postId;
    if (!accessToken || !id) return;
    try {
      const [detail, commentPage] = await Promise.all([
        getBlogPost(accessToken, id),
        accessToken ? listBlogComments(accessToken, id) : Promise.resolve({ comments: [], nextCursor: '' }),
      ]);
      setPost(detail);
      setComments(commentPage.comments);
      setError('');
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [accessToken, postId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleLike = useCallback(async () => {
    if (!accessToken || !post) return;
    const next = !post.likedByMe;
    setPost(applyBlogLike(post, next));
    try {
      if (next) {
        await likeBlogPost(accessToken, post.id);
      } else {
        await unlikeBlogPost(accessToken, post.id);
      }
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
      await load();
    }
  }, [accessToken, load, post]);

  const submitComment = useCallback(async () => {
    if (!accessToken || !post || !commentBody.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      const created = await createBlogComment(accessToken, post.id, {
        body: commentBody.trim(),
        mentionUserIds: mentionIDs,
        parentId: replyTo?.id,
      });
      setComments((items) => [...items, created]);
      setCommentBody('');
      setReplyTo(null);
      setMentionIDs([]);
      setPost(applyBlogComment(post, created));
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  }, [accessToken, commentBody, mentionIDs, post, replyTo]);

  const removeComment = useCallback(
    async (comment: BlogComment) => {
      if (!accessToken) return;
      try {
        await deleteBlogComment(accessToken, comment.id);
        setComments((items) => items.filter((item) => item.id !== comment.id));
        if (post) setPost({ ...post, commentCount: Math.max(0, post.commentCount - 1) });
      } catch (caught) {
        setError(getBlogErrorMessage(caught));
      }
    },
    [accessToken, post],
  );

  const toggleMention = useCallback(
    (friendId: string, displayName: string) => {
      setMentionIDs((current) => {
        const exists = current.includes(friendId);
        if (exists) {
          setCommentBody((value) => value.replace(`@${displayName} `, ''));
          return current.filter((id) => id !== friendId);
        }
        setCommentBody((value) => `${value}@${displayName} `);
        return [...current, friendId];
      });
    },
    [],
  );

  const mentionableFriends = useMemo(() => friends.slice(0, 8), [friends]);
  const thread = useMemo(() => buildBlogCommentThread(comments), [comments]);

  const updateVisibility = useCallback(
    async (visibility: BlogVisibility) => {
      if (!accessToken || !post) return;
      try {
        const { updateBlogPost } = await import('@/lib/blog-api');
        const updated = await updateBlogPost(accessToken, post.id, {
          body: post.body,
          summary: post.summary,
          title: post.title,
          visibility,
        });
        setPost(updated);
        setShowVisibility(false);
      } catch (caught) {
        setError(getBlogErrorMessage(caught));
      }
    },
    [accessToken, post],
  );

  if (loading) {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </MobileScreen>
    );
  }

  if (!post) {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <ThemedText style={styles.errorText}>{error || '这篇文章已不存在或已删除。'}</ThemedText>
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
        <ThemedText style={styles.pageTitle}>文章</ThemedText>
        <View style={styles.topActions}>
          {post.canDelete ? (
            <Pressable
              accessibilityLabel="编辑文章"
              accessibilityRole="button"
              onPress={() => router.push(`/blog/create?postId=${post.id}` as Href)}
              style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="square-edit-outline" size={18} color={colors.text} />
            </Pressable>
          ) : null}
          <Pressable
            accessibilityLabel="更多操作"
            accessibilityRole="button"
            onPress={() => {
              if (!post.canDelete) return;
              setShowVisibility((value) => !value);
            }}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="dots-horizontal" size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {showVisibility && post.canDelete ? (
        <View style={[styles.visibilityPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.settingTitleRow}>
            <MaterialCommunityIcons name="eye-outline" size={16} color={colors.primary} />
            <ThemedText style={styles.settingTitle}>修改可见范围</ThemedText>
          </View>
          <BlogVisibilitySegmented onChange={(value) => void updateVisibility(value)} value={post.visibility} />
        </View>
      ) : null}

      <FlatList
        contentContainerStyle={styles.listContent}
        data={thread.roots}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <BlogCoverArt post={post} size={120} />
            <ThemedText style={styles.articleTitle}>{post.title}</ThemedText>
            <View style={styles.authorRow}>
              <SocialAvatar size={34} user={post.author} />
              <View style={styles.authorCopy}>
                <ThemedText style={styles.authorName}>{post.author.displayName}</ThemedText>
                <ThemedText style={[styles.articleMeta, { color: colors.mutedText }]}>
                  {post.wordCount > 0 ? `${post.wordCount} 字 · ` : ''}
                  {formatBlogTime(post.publishedAt)}
                </ThemedText>
              </View>
            </View>
            <View style={[styles.articleBody, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <ThemedText style={styles.articleBodyText}>{post.body}</ThemedText>
            </View>
            <View style={[styles.articleActions, { borderTopColor: colors.line }]}>
              <Pressable
                accessibilityRole="button"
                onPress={() => void toggleLike()}
                style={[styles.articleAction, post.likedByMe && styles.likedAction]}>
                <MaterialCommunityIcons
                  name={post.likedByMe ? 'heart' : 'heart-outline'}
                  size={17}
                  color={post.likedByMe ? '#ff6b8f' : colors.mutedText}
                />
                <ThemedText style={[styles.articleActionText, { color: colors.mutedText }]}>
                  {post.likeCount}
                </ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (!accessToken) {
                    router.push('/auth');
                    return;
                  }
                  void reportBlogPost(accessToken, post.id, '内容不合适')
                    .then(() => setError('已提交报告。'))
                    .catch((caught) => setError(getBlogErrorMessage(caught)));
                }}
                style={styles.articleAction}>
                <MaterialCommunityIcons name="flag-outline" size={16} color={colors.mutedText} />
                <ThemedText style={[styles.articleActionText, { color: colors.mutedText }]}>报告</ThemedText>
              </Pressable>
            </View>

            <View style={[styles.commentComposer, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <SocialAvatar size={30} user={post.author} />
              <TextInput
                maxLength={200}
                multiline
                onChangeText={setCommentBody}
                placeholder={replyTo ? `回复 ${replyTo.author.displayName}` : '写评论，支持 @ 好友'}
                placeholderTextColor={colors.mutedText}
                style={[styles.commentInput, { color: colors.text }]}
                value={commentBody}
              />
              {replyTo ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setReplyTo(null)}
                  style={styles.cancelReply}>
                  <MaterialCommunityIcons name="close" size={13} color={colors.mutedText} />
                </Pressable>
              ) : null}
              <Pressable
                accessibilityLabel="发送评论"
                accessibilityRole="button"
                disabled={submitting}
                onPress={() => void submitComment()}
                style={styles.sendButton}>
                {submitting ? (
                  <ActivityIndicator color="#ffffff" size="small" />
                ) : (
                  <MaterialCommunityIcons name="send" size={15} color="#ffffff" />
                )}
              </Pressable>
            </View>

            {mentionableFriends.length > 0 ? (
              <View style={styles.mentionRow}>
                {mentionableFriends.map((friend) => (
                  <Pressable
                    accessibilityRole="button"
                    key={friend.user.id}
                    onPress={() => toggleMention(friend.user.id, friend.user.displayName)}
                    style={[
                      styles.mentionChip,
                      {
                        backgroundColor: mentionIDs.includes(friend.user.id) ? colors.primarySoft : colors.surface,
                        borderColor: colors.line,
                      },
                    ]}>
                    <ThemedText
                      style={[
                        styles.mentionChipText,
                        { color: mentionIDs.includes(friend.user.id) ? colors.primary : colors.mutedText },
                      ]}>
                      @{friend.user.displayName}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <ThemedText style={[styles.commentsTitle, { color: colors.mutedText }]}>
              {post.commentCount > 0 ? `${post.commentCount} 条评论` : '还没有评论'}
            </ThemedText>
          </View>
        }
        ListEmptyComponent={
          <ThemedText style={[styles.noComments, { color: colors.mutedText }]}>
            登录后发表第一条真实评论。
          </ThemedText>
        }
        renderItem={({ item }) => (
          <CommentRow
            childrenByParent={thread.childrenByParent}
            comment={item}
            onDelete={removeComment}
            onReply={() => {
              if (!accessToken) {
                router.push('/auth');
                return;
              }
              setReplyTo(item);
            }}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </MobileScreen>
  );
}

function CommentRow({
  childrenByParent,
  comment,
  onDelete,
  onReply,
}: {
  childrenByParent: Map<string, BlogComment[]>;
  comment: BlogComment;
  onDelete?: (comment: BlogComment) => void;
  onReply: () => void;
}) {
  const { colors } = useAppTheme();
  const children = childrenByParent.get(comment.id) ?? [];
  return (
    <View>
      <View style={[styles.commentItem, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <SocialAvatar size={30} user={comment.author} />
        <View style={styles.commentCopy}>
          <View style={styles.commentHead}>
            <ThemedText style={styles.commentName}>{comment.author.displayName}</ThemedText>
            <ThemedText style={[styles.commentTime, { color: colors.mutedText }]}>
              {formatBlogTime(comment.createdAt)}
            </ThemedText>
          </View>
          <ThemedText style={styles.commentBody}>{comment.body}</ThemedText>
          <View style={styles.commentActions}>
            <Pressable accessibilityRole="button" onPress={onReply} style={styles.commentAction}>
              <ThemedText style={[styles.commentActionText, { color: colors.mutedText }]}>回复</ThemedText>
            </Pressable>
            {onDelete && comment.canDelete ? (
              <Pressable accessibilityRole="button" onPress={() => onDelete(comment)} style={styles.commentAction}>
                <ThemedText style={[styles.commentActionText, { color: '#d86f5b' }]}>删除</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
      {children.map((child) => (
        <View key={child.id} style={[styles.replyItem, { borderLeftColor: colors.line }]}>
          <CommentRow
            childrenByParent={childrenByParent}
            comment={child}
            onDelete={onDelete}
            onReply={onReply}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  articleAction: {
    alignItems: 'center',
    backgroundColor: '#f5f7fc',
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 34,
    justifyContent: 'center',
  },
  articleActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  articleActions: {
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 10,
  },
  articleBody: {
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 12,
    padding: 14,
  },
  articleBodyText: {
    fontSize: 13,
    lineHeight: 22,
  },
  articleMeta: {
    fontSize: 10,
    marginTop: 3,
  },
  articleTitle: {
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 26,
    marginTop: 12,
  },
  authorCopy: {
    flex: 1,
  },
  authorName: {
    fontSize: 13,
    fontWeight: '800',
  },
  authorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
    marginTop: 10,
  },
  backButton: {
    backgroundColor: '#4b6bff',
    borderRadius: 10,
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  backButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  cancelReply: {
    alignItems: 'center',
    height: 28,
    justifyContent: 'center',
    width: 24,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  commentAction: {
    paddingVertical: 4,
  },
  commentActionText: {
    fontSize: 10,
    fontWeight: '700',
  },
  commentActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 4,
  },
  commentBody: {
    color: '#3e475d',
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  commentComposer: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 9,
  },
  commentCopy: {
    flex: 1,
    minWidth: 0,
  },
  commentHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  commentInput: {
    flex: 1,
    fontSize: 12,
    maxHeight: 84,
    minHeight: 32,
    padding: 0,
  },
  commentItem: {
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginBottom: 8,
    padding: 11,
  },
  commentName: {
    fontSize: 11,
    fontWeight: '800',
  },
  commentTime: {
    fontSize: 9.5,
  },
  commentsTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 9,
    marginTop: 16,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 12,
    textAlign: 'center',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  likedAction: {
    backgroundColor: '#fff0f4',
  },
  listContent: {
    paddingBottom: 30,
  },
  mentionChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  mentionChipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  mentionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 9,
  },
  noComments: {
    fontSize: 11,
    paddingVertical: 10,
    textAlign: 'center',
  },
  page: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  replyItem: {
    borderLeftWidth: 2,
    marginLeft: 18,
    paddingLeft: 10,
  },
  sendButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 10,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  settingTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  settingTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
  },
  topActions: {
    flexDirection: 'row',
    gap: 8,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingTop: 6,
  },
  visibilityPanel: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 13,
  },
});
