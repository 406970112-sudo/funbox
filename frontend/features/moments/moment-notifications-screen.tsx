import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useMoments } from '@/features/moments/moments-provider';
import { SocialAvatar, SocialEmptyState } from '@/features/social/social-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { MomentNotification } from '@/types/moments';

export function MomentNotificationsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { status } = useAuth();
  const { error, loading, markRead, notifications, refreshNotifications, unreadCount } =
    useMoments();

  useFocusEffect(
    useCallback(() => {
      void refreshNotifications();
    }, [refreshNotifications]),
  );

  if (status !== 'authenticated') {
    return (
      <MobileScreen contentContainerStyle={styles.center}>
        <SocialEmptyState
          description="登录后即可查看好友的点赞、评论与回复。"
          icon="bell-outline"
          title="登录后查看互动通知"
        />
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
        <ThemedText style={styles.pageTitle}>互动通知</ThemedText>
        <Pressable
          accessibilityLabel="全部已读"
          accessibilityRole="button"
          disabled={unreadCount === 0}
          onPress={() => void markRead()}
          style={[styles.readAllButton, unreadCount === 0 && styles.pressed]}>
          <MaterialCommunityIcons name="check-all" size={16} color={colors.primary} />
          <ThemedText style={styles.readAllText}>全部已读</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.unreadSummary, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.unreadBadge}>
          <ThemedText style={styles.unreadBadgeText}>{unreadCount}</ThemedText>
        </View>
        <ThemedText style={[styles.unreadSummaryText, { color: colors.mutedText }]}>
          条未读，来自真实好友的点赞与评论
        </ThemedText>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={notifications}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <SocialEmptyState
              description="好友赞了你的动态、评论或回复你时，会显示在这里。"
              icon="bell-off-outline"
              title="还没有互动通知"
            />
          )
        }
        renderItem={({ item }) => (
          <NotificationRow
            item={item}
            onPress={() => {
              void markRead(item.momentId);
              if (item.momentId) {
                router.push({
                  pathname: '/moments/[momentId]',
                  params: { momentId: item.momentId },
                });
              }
            }}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </MobileScreen>
  );
}

function NotificationRow({
  item,
  onPress,
}: {
  item: MomentNotification;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const title = notificationTitle(item);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.noticeRow,
        item.read && styles.noticeRead,
        {
          backgroundColor: item.read ? colors.surface : '#f7f9ff',
          borderColor: item.read ? colors.line : '#c9d5ff',
          opacity: pressed ? 0.7 : 1,
        },
      ]}>
      <SocialAvatar size={40} user={item.actor} />
      <View style={styles.noticeCopy}>
        <ThemedText style={styles.noticeTitle}>{title}</ThemedText>
        {item.preview ? (
          <ThemedText numberOfLines={1} style={[styles.noticePreview, { color: colors.mutedText }]}>
            {item.preview}
          </ThemedText>
        ) : null}
      </View>
      <View style={styles.noticeSide}>
        <ThemedText style={[styles.noticeTime, { color: colors.mutedText }]}>
          {formatNoticeTime(item.createdAt)}
        </ThemedText>
        {!item.read ? <View style={styles.unreadDot} /> : null}
      </View>
    </Pressable>
  );
}

function notificationTitle(item: MomentNotification) {
  switch (item.type) {
    case 'like':
      return `${item.actor.displayName} 赞了你的动态`;
    case 'comment':
      return `${item.actor.displayName} 评论了你的动态`;
    case 'reply':
      return `${item.actor.displayName} 回复了你`;
    case 'mention':
      return `${item.actor.displayName} 在动态中提到了你`;
    default:
      return `${item.actor.displayName} 与你互动`;
  }
}

function formatNoticeTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时前`;
  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 12,
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
  listContent: {
    paddingTop: 12,
  },
  loadingState: {
    alignItems: 'center',
    paddingTop: 80,
  },
  noticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  noticePreview: {
    fontSize: 10.5,
    marginTop: 3,
  },
  noticeRead: {
    opacity: 0.72,
  },
  noticeRow: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 11,
  },
  noticeSide: {
    alignItems: 'flex-end',
    gap: 6,
  },
  noticeTime: {
    fontSize: 9.5,
  },
  noticeTitle: {
    fontSize: 12.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  page: {
    paddingTop: 14,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.5,
  },
  readAllButton: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 5,
    minHeight: 40,
  },
  readAllText: {
    color: '#4b6bff',
    fontSize: 12,
    fontWeight: '800',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#ff6b8f',
    borderRadius: 11,
    height: 22,
    justifyContent: 'center',
    minWidth: 22,
    paddingHorizontal: 6,
  },
  unreadBadgeText: {
    color: '#ffffff',
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '800',
  },
  unreadDot: {
    backgroundColor: '#ff6b8f',
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  unreadSummary: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    marginTop: 14,
    padding: 11,
  },
  unreadSummaryText: {
    fontSize: 11.5,
  },
});
