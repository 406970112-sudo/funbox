import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useBlog } from '@/features/blog/blog-provider';
import { SocialAvatar } from '@/features/social/social-ui';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { BlogNotification } from '@/types/blog';

import { formatBlogTime } from './blog-ui';

const NOTICE_TEXT: Record<BlogNotification['type'], (name: string) => string> = {
  'post.comment': (name) => `${name} 评论了你的文章`,
  'post.like': (name) => `${name} 赞了你的文章`,
  'post.mention': (name) => `${name} @了你`,
  'post.reply': (name) => `${name} 回复了你`,
};

export function BlogNotificationsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { markRead, notifications, refreshNotifications } = useBlog();

  useFocusEffect(
    useCallback(() => {
      void refreshNotifications();
    }, [refreshNotifications]),
  );

  async function open(item: BlogNotification) {
    if (item.postId) {
      await markRead(item.postId).catch(() => {});
      router.push(`/blog/${item.postId}` as Href);
    }
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
        <ThemedText style={styles.pageTitle}>博客互动</ThemedText>
        <Pressable
          accessibilityLabel="全部已读"
          accessibilityRole="button"
          onPress={() => void markRead().catch(() => {})}
          style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="check-all" size={19} color={colors.text} />
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={notifications}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <MaterialCommunityIcons name="bell-outline" size={26} color={colors.mutedText} />
            <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
              还没有互动通知
            </ThemedText>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() => void open(item)}
            style={[
              styles.noticeItem,
              {
                backgroundColor: item.read ? colors.surface : '#f7f9ff',
                borderColor: item.read ? colors.line : '#c9d5ff',
              },
            ]}>
            <SocialAvatar size={40} user={item.actor} />
            <View style={styles.noticeCopy}>
              <ThemedText style={styles.noticeTitle}>{NOTICE_TEXT[item.type](item.actor.displayName)}</ThemedText>
              <ThemedText numberOfLines={1} style={[styles.noticePreview, { color: colors.mutedText }]}>
                {item.preview}
              </ThemedText>
              <ThemedText style={[styles.noticeTime, { color: colors.mutedText }]}>
                {formatBlogTime(item.createdAt)}
              </ThemedText>
            </View>
            {!item.read ? <View style={styles.unreadDot} /> : null}
          </Pressable>
        )}
        showsVerticalScrollIndicator={false}
      />
    </MobileScreen>
  );
}

const styles = StyleSheet.create({
  emptyState: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 90,
  },
  emptyText: {
    fontSize: 13,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  listContent: {
    paddingBottom: 24,
  },
  noticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  noticeItem: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 12,
    position: 'relative',
  },
  noticePreview: {
    fontSize: 10.5,
    marginTop: 3,
  },
  noticeTime: {
    fontSize: 9.5,
    marginTop: 3,
  },
  noticeTitle: {
    fontSize: 12,
    fontWeight: '700',
  },
  page: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingTop: 6,
  },
  unreadDot: {
    backgroundColor: '#ff6b8f',
    borderRadius: 4,
    height: 8,
    position: 'absolute',
    right: 12,
    top: 12,
    width: 8,
  },
});
