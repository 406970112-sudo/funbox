import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { type Href, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import {
  deleteBlogPost,
  getBlogErrorMessage,
  listMyBlogPosts,
  updateBlogPost,
} from '@/lib/blog-api';
import { replaceBlogPostById, removeBlogPostById } from '@/lib/blog-model';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { BlogPost, BlogVisibility } from '@/types/blog';

import { BlogEmptyState, BlogPostCard, BlogVisibilitySegmented } from './blog-ui';

export function BlogMyScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken } = useAuth();
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [menuPost, setMenuPost] = useState<BlogPost | null>(null);

  const load = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    try {
      const page = await listMyBlogPosts(accessToken);
      setPosts(page.posts);
      setError('');
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function remove(post: BlogPost) {
    if (!accessToken) return;
    setMenuPost(null);
    try {
      await deleteBlogPost(accessToken, post.id);
      setPosts((items) => removeBlogPostById(items, post.id));
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
    }
  }

  async function changeVisibility(visibility: BlogVisibility) {
    if (!accessToken || !menuPost) return;
    try {
      const updated = await updateBlogPost(accessToken, menuPost.id, {
        body: menuPost.body,
        summary: menuPost.summary,
        title: menuPost.title,
        visibility,
      });
      setPosts((items) => replaceBlogPostById(items, updated));
      setMenuPost(null);
    } catch (caught) {
      setError(getBlogErrorMessage(caught));
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
        <ThemedText style={styles.pageTitle}>我的博客</ThemedText>
        <Pressable
          accessibilityLabel="写文章"
          accessibilityRole="button"
          onPress={() => router.push('/blog/create')}
          style={styles.addButton}>
          <MaterialCommunityIcons name="square-edit-outline" size={20} color="#c9f36a" />
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
            <BlogEmptyState
              action={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/blog/create')}
                  style={styles.primaryButton}>
                  <ThemedText style={styles.primaryButtonText}>发布第一篇文章</ThemedText>
                  <MaterialCommunityIcons name="arrow-right" size={17} color="#151b3b" />
                </Pressable>
              }
              description="你发布的文章会出现在这里，包括仅自己可见的内容。"
              icon="notebook-edit-outline"
              title="还没有文章"
            />
          )
        }
        onRefresh={() => void load()}
        refreshing={loading}
        renderItem={({ item }) => (
          <View>
            <BlogPostCard
              onCommentPress={() => router.push(`/blog/${item.id}` as Href)}
              onLikePress={() => router.push(`/blog/${item.id}` as Href)}
              onOpen={() => router.push(`/blog/${item.id}` as Href)}
              post={item}
            />
            <View style={styles.manageRow}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/blog/create?postId=${item.id}` as Href)}
                style={[styles.manageButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="square-edit-outline" size={15} color={colors.primary} />
                <ThemedText style={[styles.manageText, { color: colors.primary }]}>编辑</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMenuPost(item)}
                style={[styles.manageButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <MaterialCommunityIcons name="eye-settings-outline" size={15} color={colors.text} />
                <ThemedText style={[styles.manageText, { color: colors.text }]}>可见范围</ThemedText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void remove(item)}
                style={[styles.manageButton, styles.deleteButton]}>
                <MaterialCommunityIcons name="trash-can-outline" size={15} color="#d86f5b" />
                <ThemedText style={[styles.manageText, { color: '#d86f5b' }]}>删除</ThemedText>
              </Pressable>
            </View>
          </View>
        )}
        showsVerticalScrollIndicator={false}
      />
      {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

      <Modal
        animationType="fade"
        onRequestClose={() => setMenuPost(null)}
        transparent
        visible={Boolean(menuPost)}>
        <Pressable onPress={() => setMenuPost(null)} style={styles.modalBackdrop}>
          <Pressable
            onPress={(event) => event.stopPropagation()}
            style={[styles.modalCard, { backgroundColor: colors.surface }]}>
            <View style={styles.modalTitleRow}>
              <MaterialCommunityIcons name="eye-outline" size={17} color={colors.primary} />
              <ThemedText style={styles.modalTitle}>修改可见范围</ThemedText>
            </View>
            <ThemedText numberOfLines={1} style={[styles.modalPostTitle, { color: colors.mutedText }]}>
              {menuPost?.title}
            </ThemedText>
            {menuPost ? (
              <BlogVisibilitySegmented
                onChange={(value) => void changeVisibility(value)}
                value={menuPost.visibility}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() => setMenuPost(null)}
              style={styles.modalClose}>
              <ThemedText style={styles.modalCloseText}>关闭</ThemedText>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </MobileScreen>
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
  deleteButton: {
    borderColor: '#f6c9d3',
    backgroundColor: '#fff4f6',
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
  listContent: {
    paddingBottom: 24,
    paddingTop: 4,
  },
  loadingState: {
    alignItems: 'center',
    paddingTop: 90,
  },
  manageButton: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    height: 32,
    justifyContent: 'center',
  },
  manageRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    marginTop: -4,
  },
  manageText: {
    fontSize: 10,
    fontWeight: '700',
  },
  modalBackdrop: {
    alignItems: 'center',
    backgroundColor: 'rgba(21, 27, 59, 0.42)',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    borderRadius: 16,
    maxWidth: 360,
    padding: 16,
    width: '100%',
  },
  modalClose: {
    alignItems: 'center',
    marginTop: 14,
    paddingVertical: 8,
  },
  modalCloseText: {
    color: '#7483a2',
    fontSize: 12,
    fontWeight: '700',
  },
  modalPostTitle: {
    fontSize: 11,
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 13,
    fontWeight: '800',
  },
  modalTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    marginBottom: 8,
  },
  page: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 17,
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
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingBottom: 14,
    paddingTop: 6,
  },
});
