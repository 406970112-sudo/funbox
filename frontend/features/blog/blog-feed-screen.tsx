import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import {
  getBlogErrorMessage,
  likeBlogPost,
  listBlogFeed,
  listPublicBlogFeed,
  unlikeBlogPost,
} from '@/lib/blog-api';
import { applyBlogLike } from '@/lib/blog-model';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { BlogPost } from '@/types/blog';

import { BlogEmptyState, BlogPostCard } from './blog-ui';

export function BlogFeedScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status } = useAuth();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [nextCursor, setNextCursor] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<'friends' | 'public'>('public');

  const loadFeed = useCallback(
    async (mode: 'friends' | 'public', next: string, replace: boolean) => {
      try {
        const page =
          mode === 'friends' && accessToken
            ? await listBlogFeed(accessToken, { cursor: next, tab: 'friends' })
            : await listPublicBlogFeed({ cursor: next });
        setPosts((items) => (replace ? page.posts : [...items, ...page.posts]));
        setNextCursor(page.nextCursor);
        setError('');
        return true;
      } catch (caught) {
        setError(getBlogErrorMessage(caught));
        return false;
      }
    },
    [accessToken],
  );

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void loadFeed(tab, '', true).finally(() => setLoading(false));
    }, [loadFeed, tab]),
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await loadFeed(tab, '', true);
    setRefreshing(false);
  }, [loadFeed, tab]);

  const loadMore = useCallback(async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    await loadFeed(tab, nextCursor, false);
    setLoadingMore(false);
  }, [loadFeed, loadingMore, nextCursor, tab]);

  const toggleLike = useCallback(
    async (post: BlogPost) => {
      if (!accessToken) {
        router.push('/auth');
        return;
      }
      const next = !post.likedByMe;
      setPosts((items) =>
        items.map((item) => (item.id === post.id ? applyBlogLike(item, next) : item)),
      );
      try {
        if (next) {
          await likeBlogPost(accessToken, post.id);
        } else {
          await unlikeBlogPost(accessToken, post.id);
        }
      } catch {
        await refresh();
      }
    },
    [accessToken, refresh, router],
  );

  return (
    <MobileScreen contentContainerStyle={styles.page}>
      <View style={styles.topBar}>
        <View>
          <ThemedText style={styles.pageTitle}>博客</ThemedText>
          <ThemedText style={[styles.pageMeta, { color: colors.mutedText }]}>
            真实长文 · 公开与好友流
          </ThemedText>
        </View>
        <View style={styles.topActions}>
          <Pressable
            accessibilityLabel="互动通知"
            accessibilityRole="button"
            onPress={() => router.push('/blog/notifications')}
            style={[styles.iconButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="bell-outline" size={20} color={colors.text} />
          </Pressable>
          <Pressable
            accessibilityLabel="写文章"
            accessibilityRole="button"
            onPress={() => {
              if (status !== 'authenticated') {
                router.push('/auth');
                return;
              }
              router.push('/blog/create');
            }}
            style={styles.addButton}>
            <MaterialCommunityIcons name="square-edit-outline" size={20} color="#c9f36a" />
          </Pressable>
        </View>
      </View>

      <View style={[styles.tabs, { backgroundColor: colors.surfaceMuted }]}>
        <TabButton active={tab === 'public'} label="公开" onPress={() => setTab('public')} />
        <TabButton
          active={tab === 'friends'}
          label="好友"
          onPress={() => {
            if (status !== 'authenticated') {
              router.push('/auth');
              return;
            }
            setTab('friends');
          }}
        />
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
            <BlogEmptyState
              action={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    if (status !== 'authenticated') {
                      router.push('/auth');
                      return;
                    }
                    router.push('/blog/create');
                  }}
                  style={styles.primaryButton}>
                  <ThemedText style={styles.primaryButtonText}>
                    {status === 'authenticated' ? '发布第一篇文章' : '登录 / 注册'}
                  </ThemedText>
                  <MaterialCommunityIcons name="arrow-right" size={17} color="#151b3b" />
                </Pressable>
              }
              description={
                tab === 'friends'
                  ? '好友可见内容仅对真实好友展示，也可以发布自己的文章。'
                  : '还没有公开博客，用户发布第一篇后公开内容会出现在这里。'
              }
              icon={tab === 'friends' ? 'account-group-outline' : 'book-open-page-variant-outline'}
              title={tab === 'friends' ? '添加好友后能看到好友博客' : '还没有公开博客'}
            />
          )
        }
        onRefresh={refresh}
        refreshing={refreshing}
        renderItem={({ item }) => (
          <BlogPostCard
            onCommentPress={() => router.push(`/blog/${item.id}` as Href)}
            onLikePress={() => void toggleLike(item)}
            onOpen={() => router.push(`/blog/${item.id}` as Href)}
            post={item}
          />
        )}
        showsVerticalScrollIndicator={false}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.primary} style={styles.footerLoader} />
          ) : null
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}
    </MobileScreen>
  );
}

function TabButton({
  active,
  label,
  onPress,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.tabButton, active && styles.tabButtonActive]}>
      <ThemedText style={[styles.tabText, { color: active ? colors.text : colors.mutedText }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignItems: 'center',
    backgroundColor: '#4b6bff',
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  errorText: {
    color: '#d86f5b',
    fontSize: 11,
    paddingVertical: 12,
    textAlign: 'center',
  },
  footerLoader: {
    paddingVertical: 14,
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
    paddingBottom: 18,
    paddingTop: 4,
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
  primaryButton: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 11,
  },
  primaryButtonText: {
    color: '#151b3b',
    fontSize: 13,
    fontWeight: '800',
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    height: 32,
    justifyContent: 'center',
  },
  tabButtonActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#4b6bff',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '800',
  },
  tabs: {
    borderRadius: 10,
    flexDirection: 'row',
    gap: 4,
    marginBottom: 12,
    padding: 4,
  },
  topActions: {
    flexDirection: 'row',
    gap: 9,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingTop: 6,
  },
});
