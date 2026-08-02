import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IdentityPill } from '@/components/identity-ui';
import { ThemedText } from '@/components/themed-text';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import { blogVisibilityLabel } from '@/lib/blog-model';
import type { BlogPost, BlogVisibility } from '@/types/blog';

type BlogPostCardProps = {
  onCommentPress: () => void;
  onLikePress: () => void;
  onOpen: () => void;
  post: BlogPost;
};

export function BlogPostCard({
  onCommentPress,
  onLikePress,
  onOpen,
  post,
}: BlogPostCardProps) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`查看${post.author.displayName}的文章`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.postCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      <View style={styles.postHead}>
        <BlogCoverArt post={post} size={54} />
        <View style={styles.postCopy}>
          <ThemedText numberOfLines={1} style={styles.postTitle}>
            {post.title}
          </ThemedText>
          {post.summary ? (
            <ThemedText numberOfLines={2} style={[styles.postSummary, { color: colors.mutedText }]}>
              {post.summary}
            </ThemedText>
          ) : null}
          <ThemedText style={[styles.postMeta, { color: colors.mutedText }]}>
            {post.wordCount > 0 ? `${post.wordCount} 字 · ` : ''}
            {formatBlogTime(post.publishedAt)}
          </ThemedText>
        </View>
      </View>

      <View style={styles.postAuthorRow}>
        <SocialAvatar size={22} user={post.author} />
        <ThemedText numberOfLines={1} style={styles.postAuthorName}>
          {post.author.displayName}
        </ThemedText>
        {isPublicRole(post.author.role) ? <IdentityPill compact role={post.author.role} /> : null}
        <View style={styles.visibilityPill}>
          <MaterialCommunityIcons
            name={post.visibility === 'public' ? 'earth' : post.visibility === 'friends' ? 'account-group-outline' : 'lock-outline'}
            size={12}
            color={colors.primary}
          />
          <ThemedText style={[styles.visibilityPillText, { color: colors.primary }]}>
            {blogVisibilityLabel(post.visibility)}
          </ThemedText>
        </View>
      </View>

      <View style={[styles.postActions, { borderTopColor: colors.line }]}>
        <Pressable
          accessibilityLabel={post.likedByMe ? '取消点赞' : '点赞'}
          accessibilityRole="button"
          onPress={onLikePress}
          style={({ pressed }) => [styles.postAction, pressed && styles.pressed]}>
          <MaterialCommunityIcons
            name={post.likedByMe ? 'heart' : 'heart-outline'}
            size={17}
            color={post.likedByMe ? '#ff6b8f' : colors.mutedText}
          />
          <ThemedText
            style={[
              styles.postActionText,
              { color: post.likedByMe ? '#ff6b8f' : colors.mutedText },
            ]}>
            {post.likeCount > 0 ? post.likeCount : '赞'}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityLabel="评论"
          accessibilityRole="button"
          onPress={onCommentPress}
          style={({ pressed }) => [styles.postAction, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="message-text-outline" size={16} color={colors.mutedText} />
          <ThemedText style={[styles.postActionText, { color: colors.mutedText }]}>
            {post.commentCount > 0 ? post.commentCount : '评论'}
          </ThemedText>
        </Pressable>
      </View>
    </Pressable>
  );
}

export function BlogCoverArt({ post, size }: { post: BlogPost; size: number }) {
  const { colors } = useAppTheme();
  if (post.coverUrl) {
    return (
      <Image
        contentFit="cover"
        source={{ uri: post.coverUrl }}
        style={[styles.cover, { borderRadius: 10, height: size, width: size }]}
      />
    );
  }
  return (
    <View
      style={[
        styles.coverFallback,
        {
          backgroundColor: colors.primarySoft,
          borderColor: colors.line,
          borderRadius: 10,
          height: size,
          width: size,
        },
      ]}>
      <MaterialCommunityIcons name="book-open-page-variant-outline" size={size * 0.42} color={colors.primary} />
    </View>
  );
}

export function BlogVisibilitySegmented({
  onChange,
  value,
}: {
  onChange: (value: BlogVisibility) => void;
  value: BlogVisibility;
}) {
  const { colors } = useAppTheme();
  const options: { label: string; value: BlogVisibility }[] = [
    { label: '完全公开', value: 'public' },
    { label: '好友可见', value: 'friends' },
    { label: '仅自己', value: 'self' },
  ];
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((option) => (
        <Pressable
          accessibilityRole="button"
          key={option.value}
          onPress={() => onChange(option.value)}
          style={[styles.segment, value === option.value && styles.segmentActive]}>
          <ThemedText
            style={[
              styles.segmentText,
              { color: value === option.value ? colors.text : colors.mutedText },
            ]}>
            {option.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

export function BlogEmptyState({
  action,
  description,
  icon = 'book-open-page-variant-outline',
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
}) {
  return <SocialEmptyState action={action} description={description} icon={icon} title={title} />;
}

export function formatBlogTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function isPublicRole(role?: string): role is 'vip' | 'svip' {
  return role === 'vip' || role === 'svip';
}

const styles = StyleSheet.create({
  cover: {
    flexShrink: 0,
  },
  coverFallback: {
    alignItems: 'center',
    borderWidth: 1,
    flexShrink: 0,
    justifyContent: 'center',
  },
  postAction: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    height: 30,
    justifyContent: 'center',
  },
  postActionText: {
    fontSize: 11,
    fontWeight: '700',
  },
  postActions: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
  },
  postAuthorName: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
  },
  postAuthorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  postCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  postCopy: {
    flex: 1,
    minWidth: 0,
  },
  postHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  postMeta: {
    fontSize: 10,
    marginTop: 5,
  },
  postSummary: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  postTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.7,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#4b6bff',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  segmentText: {
    fontSize: 11,
    fontWeight: '800',
  },
  segmented: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    padding: 4,
  },
  visibilityPill: {
    alignItems: 'center',
    borderRadius: 999,
    flexDirection: 'row',
    gap: 4,
    marginLeft: 'auto',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  visibilityPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
});
