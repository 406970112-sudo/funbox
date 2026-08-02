import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { SocialAvatar } from '@/features/social/social-ui';
import { adminHideBlogPost, adminListBlogPosts } from '@/lib/blog-api';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { AdminBlogPost } from '@/types/blog';

import { BlogCoverArt } from './blog-ui';

export function AdminBlogScreen() {
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const [posts, setPosts] = useState<AdminBlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const page = await adminListBlogPosts(accessToken);
      setPosts(page.posts);
      setError('');
    } catch {
      setError('博客内容暂时无法加载。');
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function hide(postId: string) {
    if (!accessToken) return;
    try {
      await adminHideBlogPost(accessToken, postId);
      setPosts((items) => items.filter((item) => item.id !== postId));
    } catch {
      setError('下架失败，请稍后重试。');
    }
  }

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.pageTitle}>博客管理</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>
            真实文章与报告记录
          </ThemedText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => void load()}
          style={[styles.refreshButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="refresh" size={18} color={colors.text} />
          <ThemedText style={styles.refreshText}>刷新</ThemedText>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={styles.listContent}
        data={posts}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={
          loading ? (
            <View style={styles.loadingState}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="book-open-page-variant-outline" size={26} color={colors.mutedText} />
              <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
                暂无待管理文章
              </ThemedText>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={[styles.postRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <BlogCoverArt post={item} size={44} />
            <View style={styles.postCopy}>
              <ThemedText numberOfLines={1} style={styles.postTitle}>
                {item.title}
              </ThemedText>
              <View style={styles.postMetaRow}>
                <SocialAvatar size={18} user={item.author} />
                <ThemedText numberOfLines={1} style={[styles.postAuthor, { color: colors.mutedText }]}>
                  {item.author.displayName} · {item.wordCount} 字
                </ThemedText>
              </View>
              {item.reportCount > 0 ? (
                <View style={styles.reportBadge}>
                  <ThemedText style={styles.reportBadgeText}>{item.reportCount} 报告</ThemedText>
                </View>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => void hide(item.id)}
              style={styles.hideButton}>
              <ThemedText style={styles.hideButtonText}>下架</ThemedText>
            </Pressable>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
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
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 12,
    textAlign: 'center',
  },
  hideButton: {
    backgroundColor: '#ffe9ef',
    borderRadius: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  hideButtonText: {
    color: '#c9364a',
    fontSize: 11,
    fontWeight: '800',
  },
  listContent: {
    paddingBottom: 24,
  },
  loadingState: {
    alignItems: 'center',
    paddingTop: 90,
  },
  page: {
    flex: 1,
  },
  pageMeta: {
    fontSize: 11,
    marginTop: 3,
  },
  pageTitle: {
    fontSize: 22,
    fontWeight: '900',
  },
  postAuthor: {
    flex: 1,
    fontSize: 10,
  },
  postCopy: {
    flex: 1,
    minWidth: 0,
  },
  postMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 6,
  },
  postRow: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    padding: 11,
  },
  postTitle: {
    fontSize: 12.5,
    fontWeight: '800',
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  refreshText: {
    fontSize: 11,
    fontWeight: '700',
  },
  reportBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff0f4',
    borderRadius: 999,
    marginTop: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  reportBadgeText: {
    color: '#c9364a',
    fontSize: 9,
    fontWeight: '800',
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingTop: 6,
  },
});
