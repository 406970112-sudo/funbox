import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getFeedbackErrorMessage, listMyFeedback } from '@/lib/feedback-api';
import {
  feedbackCategoryLabel,
  feedbackKindLabel,
  feedbackStatusLabel,
  mergeFeedbackPages,
} from '@/lib/feedback-model';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import type { FeedbackSubmission } from '@/types/feedback';

export function MyFeedbackScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status, user } = useAuth();
  const [error, setError] = useState('');
  const [items, setItems] = useState<FeedbackSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);

  const loadFirstPage = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError('');
    try {
      const page = await listMyFeedback(accessToken, 30, 0);
      setItems(page.items);
      setTotal(page.total);
    } catch (loadError) {
      setError(getFeedbackErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!accessToken || loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await listMyFeedback(accessToken, 30, items.length);
      setItems((current) => mergeFeedbackPages(current, page.items));
      setTotal(page.total);
    } catch (loadError) {
      setError(getFeedbackErrorMessage(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  if (status === 'loading' || !user) {
    return <AppLoadingScreen />;
  }
  if (status !== 'authenticated' || !accessToken) {
    return <Redirect href="/auth" />;
  }

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <View style={styles.topBar}>
        <Pressable
          accessibilityLabel="返回"
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.iconButton, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="arrow-left" size={21} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.topBarTitle}>我的反馈</ThemedText>
        <View style={styles.iconButtonSpacer} />
      </View>

      {loading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>正在加载反馈</ThemedText>
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.centerState}>
          <MaterialCommunityIcons name="alert-circle-outline" size={30} color="#d86f5b" />
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>{error}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadFirstPage()}
            style={[styles.retryButton, { backgroundColor: colors.hero }]}>
            <ThemedText style={styles.retryButtonText}>重新加载</ThemedText>
          </Pressable>
        </View>
      ) : items.length === 0 ? (
        <View style={styles.centerState}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="message-alert-outline" size={30} color={colors.mutedText} />
          </View>
          <ThemedText style={styles.emptyTitle}>还没有提交过反馈</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/profile/feedback')}
            style={[styles.primaryButton, { backgroundColor: colors.hero }]}>
            <ThemedText style={styles.primaryButtonText}>去反馈</ThemedText>
          </Pressable>
        </View>
      ) : (
        <View style={styles.list}>
          {items.map((item) => (
            <Pressable
              accessibilityRole="button"
              key={item.id}
              onPress={() =>
                router.push({
                  pathname: '/profile/feedback/result/[id]',
                  params: { id: item.id },
                } as unknown as Href)
              }
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: colors.surface, borderColor: colors.line },
                pressed && styles.pressed,
              ]}>
              <View style={styles.cardHead}>
                <View style={styles.cardCopy}>
                  <ThemedText style={styles.cardTitle}>
                    {item.kind === 'feature_request' ? item.title || '功能建议' : item.description.slice(0, 18)}
                  </ThemedText>
                  <ThemedText numberOfLines={2} style={[styles.cardDescription, { color: colors.mutedText }]}>
                    {item.description}
                  </ThemedText>
                </View>
                {!item.read && item.status === 'resolved' ? <View style={styles.unreadDot} /> : null}
              </View>
              <View style={styles.cardFooter}>
                <FeedbackBadge kind={item.kind} />
                <FeedbackBadge status={item.status} />
                {item.kind === 'feature_request' && item.category ? (
                  <ThemedText style={[styles.cardMeta, { color: colors.mutedText }]}>
                    {feedbackCategoryLabel(item.category)}
                  </ThemedText>
                ) : null}
                <ThemedText style={[styles.cardMeta, { color: colors.mutedText }]}>
                  {formatFeedbackTime(item.createdAt)}
                </ThemedText>
              </View>
            </Pressable>
          ))}
          {items.length < total ? (
            <Pressable
              accessibilityRole="button"
              disabled={loadingMore}
              onPress={() => void loadMore()}
              style={[styles.loadMoreButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {loadingMore ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <ThemedText style={[styles.loadMoreText, { color: colors.primary }]}>加载更多</ThemedText>
              )}
            </Pressable>
          ) : null}
        </View>
      )}
    </MobileScreen>
  );
}

function FeedbackBadge({ kind, status }: { kind?: string; status?: string }) {
  const { colors } = useAppTheme();
  const label = kind ? feedbackKindLabel(kind) : feedbackStatusLabel(status || '');
  const tone =
    status === 'resolved'
      ? '#1db991'
      : status === 'processing'
        ? colors.primary
        : kind === 'feature_request'
          ? '#6b5adb'
          : '#d86f5b';

  return (
    <View style={[styles.badge, { backgroundColor: `${tone}18` }]}>
      <ThemedText style={[styles.badgeText, { color: tone }]}>{label}</ThemedText>
    </View>
  );
}

function formatFeedbackTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 20,
    paddingTop: 14,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  iconButtonSpacer: {
    height: 42,
    width: 42,
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingVertical: 64,
  },
  stateText: {
    fontSize: 13,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 42,
    paddingHorizontal: 18,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  emptyIcon: {
    alignItems: 'center',
    borderRadius: 22,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 20,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
  },
  list: {
    gap: 10,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    gap: 10,
    padding: 14,
  },
  cardHead: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardCopy: {
    flex: 1,
    gap: 5,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  cardDescription: {
    fontSize: 12,
    lineHeight: 18,
  },
  cardFooter: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardMeta: {
    fontSize: 11,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  unreadDot: {
    backgroundColor: '#ff6b8f',
    borderRadius: 4,
    height: 8,
    marginTop: 4,
    width: 8,
  },
  loadMoreButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 44,
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.72,
  },
});
