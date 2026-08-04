import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Redirect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getFeedbackErrorMessage,
  listAdminFeedback,
} from '@/lib/feedback-api';
import {
  feedbackLayoutForWidth,
  feedbackStatusLabel,
  mergeFeedbackPages,
  resolveFeedbackSelection,
} from '@/lib/feedback-model';
import { AppLoadingScreen } from '@/shared/ui/app-loading-screen';
import { AdminFeedbackDetail } from '@/features/feedback/admin-feedback-detail';
import type { FeedbackSubmission } from '@/types/feedback';

export function AdminFeedbackScreen() {
  const { colors } = useAppTheme();
  const { accessToken, status, user } = useAuth();
  const { width } = useWindowDimensions();
  const adminToken =
    status === 'authenticated' && user?.role === 'admin' && accessToken ? accessToken : null;
  const [error, setError] = useState('');
  const [items, setItems] = useState<FeedbackSubmission[]>([]);
  const [kindFilter, setKindFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedID, setSelectedID] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [total, setTotal] = useState(0);

  const loadFirstPage = useCallback(async () => {
    if (!adminToken) return;
    setLoading(true);
    setError('');
    try {
      const page = await listAdminFeedback(adminToken, {
        kind: kindFilter,
        limit: 30,
        offset: 0,
        q: query,
        status: statusFilter,
      });
      setItems(page.items);
      setTotal(page.total);
      setSelectedID((current) =>
        current && page.items.some((item) => item.id === current)
          ? current
          : (page.items[0]?.id ?? null),
      );
    } catch (loadError) {
      setError(getFeedbackErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [adminToken, kindFilter, query, statusFilter]);

  useEffect(() => {
    void loadFirstPage();
  }, [loadFirstPage]);

  async function loadMore() {
    if (!adminToken || loadingMore || items.length >= total) return;
    setLoadingMore(true);
    setError('');
    try {
      const page = await listAdminFeedback(adminToken, {
        kind: kindFilter,
        limit: 30,
        offset: items.length,
        q: query,
        status: statusFilter,
      });
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
  if (status !== 'authenticated' || user.role !== 'admin' || !adminToken) {
    return <Redirect href="/profile" />;
  }

  const layout = feedbackLayoutForWidth(width);
  const effectiveSelectedID = resolveFeedbackSelection(items, selectedID);
  const selectedItem =
    items.find((item) => item.id === effectiveSelectedID) ?? null;

  return (
    <View style={[styles.safeArea, { backgroundColor: colors.background }]}>
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
      ) : layout === 'desktop' ? (
        <View style={styles.desktopBody}>
          <View style={[styles.desktopList, { borderRightColor: colors.line }]}>
            <FeedbackListPanel
              items={items}
              kindFilter={kindFilter}
              loadingMore={loadingMore}
              onLoadMore={() => void loadMore()}
              onKindFilterChange={(value) => {
                setKindFilter(value);
                setItems([]);
                setSelectedID(null);
              }}
              onQueryChange={(value) => setQuery(value)}
              onQuerySubmit={() => void loadFirstPage()}
              onSelect={setSelectedID}
              onStatusFilterChange={(value) => {
                setStatusFilter(value);
                setItems([]);
                setSelectedID(null);
              }}
              selectedID={effectiveSelectedID}
              statusFilter={statusFilter}
              total={total}
              query={query}
            />
          </View>
          <View style={styles.desktopDetail}>
            {selectedItem ? (
              <AdminFeedbackDetail adminToken={adminToken} item={selectedItem} />
            ) : (
              <View style={styles.centerState}>
                <MaterialCommunityIcons name="message-alert-outline" size={30} color={colors.mutedText} />
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                  暂无反馈内容
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      ) : selectedItem ? (
        <AdminFeedbackDetail
          adminToken={adminToken}
          item={selectedItem}
          onBack={() => setSelectedID(null)}
        />
      ) : (
        <FeedbackListPanel
          items={items}
          kindFilter={kindFilter}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          onKindFilterChange={(value) => {
            setKindFilter(value);
            setItems([]);
            setSelectedID(null);
          }}
          onQueryChange={(value) => setQuery(value)}
          onQuerySubmit={() => void loadFirstPage()}
          onSelect={setSelectedID}
          onStatusFilterChange={(value) => {
            setStatusFilter(value);
            setItems([]);
            setSelectedID(null);
          }}
          selectedID={null}
          statusFilter={statusFilter}
          total={total}
          query={query}
        />
      )}
    </View>
  );
}

type FeedbackListPanelProps = {
  items: FeedbackSubmission[];
  kindFilter: string;
  loadingMore: boolean;
  onLoadMore: () => void;
  onKindFilterChange: (value: string) => void;
  onQueryChange: (value: string) => void;
  onQuerySubmit: () => void;
  onSelect: (id: string) => void;
  onStatusFilterChange: (value: string) => void;
  selectedID: string | null;
  statusFilter: string;
  total: number;
  query: string;
};

function FeedbackListPanel({
  items,
  kindFilter,
  loadingMore,
  onLoadMore,
  onKindFilterChange,
  onQueryChange,
  onQuerySubmit,
  onSelect,
  onStatusFilterChange,
  selectedID,
  statusFilter,
  total,
  query,
}: FeedbackListPanelProps) {
  const { colors } = useAppTheme();

  if (items.length === 0) {
    return (
      <View style={styles.emptyState}>
        <View style={[styles.emptyIcon, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="message-alert-outline" size={30} color={colors.mutedText} />
        </View>
        <ThemedText style={[styles.emptyTitle, { color: colors.mutedText }]}>暂无反馈</ThemedText>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      style={styles.listScroll}>
      <View style={styles.filterRow}>
        <FilterChip
          active={kindFilter === ''}
          label="全部"
          onPress={() => onKindFilterChange('')}
        />
        <FilterChip
          active={kindFilter === 'problem'}
          label="问题"
          onPress={() => onKindFilterChange('problem')}
        />
        <FilterChip
          active={kindFilter === 'feature_request'}
          label="功能建议"
          onPress={() => onKindFilterChange('feature_request')}
        />
        <FilterChip
          active={statusFilter === 'pending'}
          label="待处理"
          onPress={() => onStatusFilterChange('pending')}
        />
        <FilterChip
          active={statusFilter === 'processing'}
          label="处理中"
          onPress={() => onStatusFilterChange('processing')}
        />
        <FilterChip
          active={statusFilter === 'resolved'}
          label="已处理"
          onPress={() => onStatusFilterChange('resolved')}
        />
      </View>
      <View style={[styles.searchBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="搜索反馈"
          onChangeText={onQueryChange}
          onSubmitEditing={onQuerySubmit}
          placeholder="搜索标题、描述或用户"
          placeholderTextColor={colors.mutedText}
          returnKeyType="search"
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
        />
      </View>
      {items.map((item) => {
        const selected = item.id === selectedID;
        return (
          <Pressable
            accessibilityRole="button"
            key={item.id}
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [
              styles.feedbackCard,
              {
                backgroundColor: selected ? colors.primarySoft : colors.surface,
                borderColor: selected ? colors.primary : colors.line,
                opacity: pressed ? 0.78 : 1,
              },
            ]}>
            <View style={styles.cardHeader}>
              <View style={styles.cardUser}>
                <View style={[styles.cardAvatar, { backgroundColor: colors.surfaceMuted }]}>
                  <MaterialCommunityIcons name="account" size={18} color={colors.mutedText} />
                </View>
                <View style={styles.cardUserCopy}>
                  <ThemedText numberOfLines={1} style={styles.cardName}>
                    {item.user.displayName}
                  </ThemedText>
                  <ThemedText numberOfLines={1} style={[styles.cardMeta, { color: colors.mutedText }]}>
                    @{item.user.username} · {formatFeedbackTime(item.createdAt)}
                  </ThemedText>
                </View>
              </View>
              {item.images.length > 0 ? (
                <View style={styles.imageCountBadge}>
                  <MaterialCommunityIcons name="image-outline" size={13} color={colors.primary} />
                  <ThemedText style={[styles.imageCountText, { color: colors.primary }]}>
                    {item.images.length}
                  </ThemedText>
                </View>
              ) : null}
            </View>
            <View style={styles.cardBadges}>
              <Badge
                color={item.kind === 'feature_request' ? '#6b5adb' : '#d86f5b'}
                label={item.kind === 'feature_request' ? '功能建议' : '问题反馈'}
              />
              <Badge
                color={
                  item.status === 'resolved'
                    ? '#1db991'
                    : item.status === 'processing'
                      ? colors.primary
                      : '#c76a2a'
                }
                label={feedbackStatusLabel(item.status)}
              />
            </View>
            <ThemedText numberOfLines={3} style={styles.cardDescription}>
              {item.kind === 'feature_request' && item.title ? `${item.title} · ${item.description}` : item.description}
            </ThemedText>
          </Pressable>
        );
      })}
      {items.length < total ? (
        <Pressable
          accessibilityRole="button"
          disabled={loadingMore}
          onPress={onLoadMore}
          style={({ pressed }) => [
            styles.loadMoreButton,
            {
              backgroundColor: colors.surface,
              borderColor: colors.line,
              opacity: loadingMore || pressed ? 0.72 : 1,
            },
          ]}>
          {loadingMore ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <MaterialCommunityIcons name="chevron-down" size={18} color={colors.primary} />
          )}
          <ThemedText style={[styles.loadMoreText, { color: colors.primary }]}>
            {loadingMore ? '正在加载' : '加载更多'}
          </ThemedText>
        </Pressable>
      ) : null}
    </ScrollView>
  );
}

function FilterChip({
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
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.filterChip,
        {
          backgroundColor: active ? colors.primary : colors.surface,
          borderColor: active ? colors.primary : colors.line,
        },
        pressed && styles.pressed,
      ]}>
      <ThemedText
        style={[styles.filterChipText, { color: active ? '#ffffff' : colors.mutedText }]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

function Badge({ color, label }: { color: string; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.cardBadge, { backgroundColor: `${color}18` }]}>
      <ThemedText style={[styles.cardBadgeText, { color }]}>{label}</ThemedText>
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
  safeArea: {
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topBarCopy: {
    flex: 1,
    marginLeft: 10,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  pageSubtitle: {
    fontSize: 12,
    marginTop: 3,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 16,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  adminMark: {
    alignItems: 'center',
    borderRadius: 15,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  centerState: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
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
  desktopBody: {
    alignSelf: 'center',
    flex: 1,
    flexDirection: 'row',
    maxWidth: 1440,
    width: '100%',
  },
  desktopList: {
    borderRightWidth: 1,
    width: 380,
  },
  desktopDetail: {
    flex: 1,
  },
  listScroll: {
    flex: 1,
  },
  listContent: {
    gap: 10,
    padding: 16,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  filterChipText: {
    fontSize: 11,
    fontWeight: '800',
  },
  searchBox: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    height: 38,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    minWidth: 0,
    paddingVertical: 8,
  },
  feedbackCard: {
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    padding: 13,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  cardUser: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 9,
    minWidth: 0,
  },
  cardAvatar: {
    alignItems: 'center',
    borderRadius: 13,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  cardUserCopy: {
    flex: 1,
    minWidth: 0,
  },
  cardName: {
    fontSize: 13,
    fontWeight: '800',
  },
  cardMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  cardBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  cardBadge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  cardBadgeText: {
    fontSize: 10,
    fontWeight: '800',
  },
  imageCountBadge: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  imageCountText: {
    fontSize: 11,
    fontWeight: '800',
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 20,
  },
  loadMoreButton: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
  },
  loadMoreText: {
    fontSize: 13,
    fontWeight: '800',
  },
  emptyState: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 24,
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
  pressed: {
    opacity: 0.72,
  },
});
