import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IdentityPill } from '@/components/identity-ui';
import { ThemedText } from '@/components/themed-text';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { Moment, MomentAttachment, MomentImage } from '@/types/moments';

type MomentCardProps = {
  moment: Moment;
  onCommentPress: () => void;
  onLikePress: () => void;
  onOpen: () => void;
  onMorePress?: () => void;
};

export function MomentCard({
  moment,
  onCommentPress,
  onLikePress,
  onMorePress,
  onOpen,
}: MomentCardProps) {
  const { colors } = useAppTheme();

  return (
    <Pressable
      accessibilityLabel={`查看${moment.author.displayName}的动态`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.momentCard,
        {
          backgroundColor: colors.surface,
          borderColor: colors.line,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      <View style={styles.momentHead}>
        <SocialAvatar size={42} user={moment.author} />
        <View style={styles.momentAuthorCopy}>
          <View style={styles.momentNameRow}>
            <ThemedText numberOfLines={1} style={styles.momentName}>
              {moment.author.displayName}
            </ThemedText>
            {isPublicRole(moment.author.role) ? (
              <IdentityPill compact role={moment.author.role} />
            ) : null}
          </View>
          <ThemedText style={[styles.momentTime, { color: colors.mutedText }]}>
            {formatMomentTime(moment.createdAt)}
            {moment.visibility === 'self' ? ' · 仅自己可见' : ''}
          </ThemedText>
        </View>
        {onMorePress ? (
          <Pressable
            accessibilityLabel="更多操作"
            accessibilityRole="button"
            hitSlop={8}
            onPress={onMorePress}
            style={styles.moreButton}>
            <MaterialCommunityIcons name="dots-horizontal" size={18} color={colors.mutedText} />
          </Pressable>
        ) : null}
      </View>

      <ThemedText style={styles.momentBody}>{moment.body}</ThemedText>
      {moment.images.length > 0 ? (
        <MomentImageGrid images={moment.images} />
      ) : null}
      {moment.attachments.map((attachment) => (
        <MomentAttachmentCard attachment={attachment} key={attachment.refId} />
      ))}

      {moment.likeCount > 0 || moment.commentCount > 0 ? (
        <View style={[styles.summaryRow, { backgroundColor: colors.surfaceMuted }]}>
          {moment.likeCount > 0 ? (
            <View style={styles.summaryItem}>
              <MaterialCommunityIcons name="heart" size={12} color="#ff6b8f" />
              <ThemedText numberOfLines={1} style={styles.summaryText}>
                {formatLikers(moment)}
              </ThemedText>
            </View>
          ) : null}
          {moment.commentCount > 0 ? (
            <ThemedText numberOfLines={1} style={styles.summaryText}>
              {moment.recentComments[0]?.body
                ? `${moment.recentComments[0].author.displayName}：${moment.recentComments[0].body}`
                : `${moment.commentCount} 条评论`}
            </ThemedText>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.momentActions, { borderTopColor: colors.line }]}>
        <Pressable
          accessibilityLabel={moment.likedByMe ? '取消点赞' : '点赞'}
          accessibilityRole="button"
          onPress={onLikePress}
          style={({ pressed }) => [styles.momentAction, pressed && styles.pressed]}>
          <MaterialCommunityIcons
            name={moment.likedByMe ? 'heart' : 'heart-outline'}
            size={17}
            color={moment.likedByMe ? '#ff6b8f' : colors.mutedText}
          />
          <ThemedText
            style={[
              styles.momentActionText,
              { color: moment.likedByMe ? '#ff6b8f' : colors.mutedText },
            ]}>
            {moment.likedByMe ? '已赞' : '赞'}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityLabel="评论"
          accessibilityRole="button"
          onPress={onCommentPress}
          style={({ pressed }) => [styles.momentAction, pressed && styles.pressed]}>
          <MaterialCommunityIcons
            name="message-text-outline"
            size={16}
            color={colors.mutedText}
          />
          <ThemedText style={[styles.momentActionText, { color: colors.mutedText }]}>
            评论 {moment.commentCount > 0 ? moment.commentCount : ''}
          </ThemedText>
        </Pressable>
      </View>
    </Pressable>
  );
}

export function MomentImageGrid({ images }: { images: MomentImage[] }) {
  if (images.length === 0) return null;
  const isSingle = images.length === 1;
  return (
    <View style={[styles.imageGrid, isSingle && styles.imageGridSingle]}>
      {images.slice(0, 9).map((image) => (
        <Image
          contentFit="cover"
          key={image.url}
          source={{ uri: image.url }}
          style={[styles.momentImage, isSingle && styles.momentImageSingle]}
        />
      ))}
    </View>
  );
}

export function MomentAttachmentCard({ attachment }: { attachment: MomentAttachment }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.attachmentCard, { backgroundColor: colors.primarySoft }]}>
      <View style={styles.attachmentIcon}>
        <MaterialCommunityIcons name="trophy-outline" size={18} color="#4b6bff" />
      </View>
      <View style={styles.attachmentCopy}>
        <ThemedText numberOfLines={1} style={styles.attachmentTitle}>
          {attachment.title || '真实战绩'}
        </ThemedText>
        <ThemedText style={[styles.attachmentResult, { color: colors.mutedText }]}>
          {attachment.result || `${attachment.score ?? 0} 分`}
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="check-decagram" size={16} color="#24b36b" />
    </View>
  );
}

export function MomentsEmptyState({
  action,
  description,
  icon = 'image-text',
  title,
}: {
  action?: React.ReactNode;
  description: string;
  icon?: ComponentProps<typeof MaterialCommunityIcons>['name'];
  title: string;
}) {
  return (
    <SocialEmptyState action={action} description={description} icon={icon} title={title} />
  );
}

export function formatMomentTime(value: string) {
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

function formatLikers(moment: Moment) {
  const names = moment.recentLikers.map((user) => user.displayName).join('、');
  const extra = moment.likeCount > moment.recentLikers.length
    ? ` 等 ${moment.likeCount} 人赞过`
    : '赞过';
  return `${names}${extra}`;
}

function isPublicRole(role?: string): role is 'vip' | 'svip' {
  return role === 'vip' || role === 'svip';
}

const styles = StyleSheet.create({
  attachmentCard: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
    padding: 10,
  },
  attachmentCopy: {
    flex: 1,
    minWidth: 0,
  },
  attachmentIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(75,107,255,0.14)',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  attachmentResult: {
    fontSize: 10.5,
    marginTop: 2,
  },
  attachmentTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  imageGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 10,
  },
  imageGridSingle: {
    gap: 0,
  },
  momentAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 34,
  },
  momentActionText: {
    fontSize: 11.5,
    fontWeight: '700',
  },
  momentActions: {
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    paddingTop: 8,
  },
  momentAuthorCopy: {
    flex: 1,
    minWidth: 0,
  },
  momentBody: {
    fontSize: 13,
    lineHeight: 21,
    marginTop: 10,
  },
  momentCard: {
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 12,
    padding: 12,
  },
  momentHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  momentImage: {
    aspectRatio: 1,
    borderRadius: 8,
    flexBasis: '31%',
    flexGrow: 1,
  },
  momentImageSingle: {
    aspectRatio: 16 / 9,
    flexBasis: '100%',
    maxWidth: '100%',
  },
  momentName: {
    flexShrink: 1,
    fontSize: 13.5,
    fontWeight: '800',
  },
  momentNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minWidth: 0,
  },
  momentTime: {
    fontSize: 10,
    marginTop: 3,
  },
  moreButton: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  pressed: {
    opacity: 0.7,
  },
  summaryItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minWidth: 0,
  },
  summaryRow: {
    borderRadius: 8,
    gap: 10,
    marginTop: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  summaryText: {
    color: '#4d5870',
    flexShrink: 1,
    fontSize: 10.5,
  },
});
