import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type RefObject } from 'react';
import {
  ActivityIndicator,
  Image,
  ImageBackground,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { captureRef } from 'react-native-view-shot';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  fetchDnfActivities,
  fetchDnfActivity,
  fetchDnfActivityCalendar,
  fetchDnfActivityOverview,
  fetchDnfActivityShare,
  getDnfActivityErrorMessage,
} from '@/lib/dnf-activity-api';
import {
  canAddDnfActivityFavorite,
  loadDnfActivityFavoriteIds,
  saveDnfActivityFavoriteIds,
} from '@/lib/dnf-activity-favorites-storage';
import {
  DNF_STATUS_TABS,
  filterDnfActivities,
  formatDnfActivityDateRange,
  getDnfActivityDaysLabel,
  getDnfActivityStatusLabel,
  getDnfCalendarGrid,
  isLongRunning,
  isToday,
  sortDnfActivities,
} from '@/lib/dnf-activity-model';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import type {
  DnfActivity,
  DnfActivityList,
  DnfActivityOverview,
  DnfActivitySortKey,
  DnfActivityStatus,
  DnfCalendarMonth,
  DnfShareInfo,
} from '@/types/dnf-activity';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];
type ViewId = 'overview' | 'list' | 'calendar' | 'favorites';

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff5d6c';
const GREEN = '#24b36b';
const AMBER = '#f1a33b';

const VIEW_TABS: { id: ViewId; label: string; icon: IconName }[] = [
  { id: 'overview', label: '总览', icon: 'home-outline' },
  { id: 'list', label: '列表', icon: 'format-list-bulleted' },
  { id: 'calendar', label: '日历', icon: 'calendar-month-outline' },
  { id: 'favorites', label: '关注', icon: 'heart-outline' },
];

const SORT_OPTIONS: { id: DnfActivitySortKey; label: string }[] = [
  { id: 'ending', label: '结束日期' },
  { id: 'start', label: '开始日期' },
  { id: 'fetched', label: '官网更新' },
];

export function DnfMobileActivityScreen() {
  const { colorScheme, colors } = useAppTheme();
  const [view, setView] = useState<ViewId>('overview');
  const [overview, setOverview] = useState<DnfActivityOverview | null>(null);
  const [activities, setActivities] = useState<DnfActivity[]>([]);
  const [allActivities, setAllActivities] = useState<DnfActivity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<DnfActivityStatus | ''>('');
  const [sortKey, setSortKey] = useState<DnfActivitySortKey>('ending');
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DnfActivity | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<{ year: number; month: number }>(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const [calendar, setCalendar] = useState<DnfCalendarMonth | null>(null);
  const [calendarSelectedDate, setCalendarSelectedDate] = useState<string>(() =>
    localDateString(new Date()),
  );
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [favoriteNotice, setFavoriteNotice] = useState<string | null>(null);
  const [shareInfo, setShareInfo] = useState<DnfShareInfo | null>(null);
  const [isShareLoading, setIsShareLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const posterCaptureRef = useRef<View | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
    if (typeof window !== 'undefined') window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [view, selectedActivityId, calendarMonth]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [nextOverview, nextList, nextFavorites] = await Promise.all([
          fetchDnfActivityOverview(controller.signal),
          fetchDnfActivities({ page: 1, pageSize: 200, signal: controller.signal }),
          loadDnfActivityFavoriteIds(),
        ]);
        setOverview(nextOverview);
        setActivities(nextList.items);
        setAllActivities(nextList.items);
        setFavoriteIds(nextFavorites);
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(getDnfActivityErrorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (view !== 'calendar') return;
    const controller = new AbortController();
    setCalendar(null);
    fetchDnfActivityCalendar(calendarMonth.year, calendarMonth.month, controller.signal)
      .then(setCalendar)
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(getDnfActivityErrorMessage(loadError));
      });
    return () => controller.abort();
  }, [view, calendarMonth]);

  useEffect(() => {
    if (!selectedActivityId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    const cached = activities.find((item) => item.id === selectedActivityId);
    setDetail(cached ?? null);
    fetchDnfActivity(selectedActivityId, controller.signal)
      .then(setDetail)
      .catch((loadError) => {
        if (!controller.signal.aborted && !cached) {
          setError(getDnfActivityErrorMessage(loadError));
        }
      });
    return () => controller.abort();
  }, [selectedActivityId, activities]);

  const filteredActivities = useMemo(
    () => sortDnfActivities(filterDnfActivities(activities, statusFilter, query), sortKey),
    [activities, statusFilter, query, sortKey],
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextOverview, nextList] = await Promise.all([
        fetchDnfActivityOverview(),
        fetchDnfActivities({ page: 1, pageSize: 200 }),
      ]);
      setOverview(nextOverview);
      setActivities(nextList.items);
      setAllActivities(nextList.items);
    } catch (refreshError) {
      setError(getDnfActivityErrorMessage(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }

  function retry() {
    setIsLoading(true);
    setError(null);
    Promise.all([
      fetchDnfActivityOverview(),
      fetchDnfActivities({ page: 1, pageSize: 200 }),
    ])
      .then(([nextOverview, nextList]) => {
        setOverview(nextOverview);
        setActivities(nextList.items);
        setAllActivities(nextList.items);
      })
      .catch((loadError) => setError(getDnfActivityErrorMessage(loadError)))
      .finally(() => setIsLoading(false));
  }

  function openActivity(activity: DnfActivity) {
    setSelectedActivityId(activity.id);
  }

  async function toggleFavorite(activity: DnfActivity) {
    const already = favoriteIds.includes(activity.id);
    if (!already && !canAddDnfActivityFavorite(favoriteIds.length)) {
      setFavoriteNotice('关注数量已达上限 30 条，请先移除其他关注。');
      return;
    }
    const next = already
      ? favoriteIds.filter((id) => id !== activity.id)
      : [...favoriteIds, activity.id];
    setFavoriteIds(next);
    await saveDnfActivityFavoriteIds(next);
    setFavoriteNotice(
      already
        ? `已取消关注「${activity.title}」。`
        : `已关注「${activity.title}」，状态变化时会提示。`,
    );
  }

  async function openShare(activity: DnfActivity) {
    setIsShareLoading(true);
    setShareMessage(null);
    try {
      const info = await fetchDnfActivityShare(activity.id);
      setShareInfo(info);
    } catch (shareError) {
      setError(getDnfActivityErrorMessage(shareError));
    } finally {
      setIsShareLoading(false);
    }
  }

  async function copyShareLink() {
    if (!shareInfo?.url) return;
    await Clipboard.setStringAsync(shareInfo.url);
    setShareMessage('官方链接已复制，可粘贴发送给好友。');
  }

  function notifyMiniProgramShare(info: DnfShareInfo) {
    const wx = (globalThis as { wx?: { miniProgram?: { postMessage?: (message: { data: unknown }) => void } } }).wx;
    wx?.miniProgram?.postMessage?.({
      data: {
        type: 'dnf-activity-share',
        payload: {
          title: info.title,
          url: info.url,
          imageUrl: info.imageUrl,
        },
      },
    });
  }

  async function handleWechatShare() {
    if (!shareInfo) return;
    notifyMiniProgramShare(shareInfo);
    if (Platform.OS !== 'web') {
      setShareMessage('已唤起微信分享，请点击右上角菜单分享给好友。');
    } else {
      setShareMessage('小程序内已开启分享菜单，请点击右上角分享。');
    }
  }

  async function handleSavePoster() {
    if (!shareInfo || Platform.OS === 'web') return;
    try {
      const uri = await captureRef(posterCaptureRef, { format: 'png', quality: 0.92 });
      const permission = await MediaLibrary.requestPermissionsAsync();
      if (!permission.granted) {
        setShareMessage('需要相册权限才能保存海报。');
        return;
      }
      await MediaLibrary.saveToLibraryAsync(uri);
      setShareMessage('海报已保存到相册。');
    } catch {
      setShareMessage('海报保存失败，请稍后重试。');
    }
  }

  function openOfficialPage(activity: DnfActivity) {
    const target = normalizeUrl(activity.mobileUrl || activity.pcUrl);
    if (!target) {
      setError('该活动暂无官网入口。');
      return;
    }
    Linking.openURL(target).catch(() => setError('无法打开官方活动页，请检查网络。'));
  }

  if (isLoading && !overview) {
    return <PageLoadingFrame stateLabel="正在同步官网活动" title="DNF手游活动助手" variant="panel" />;
  }

  if (!overview && error) {
    return (
      <PageErrorRetry
        colors={colors}
        message={error}
        onRetry={retry}
        title="DNF手游活动助手"
      />
    );
  }

  const isDark = colorScheme === 'dark';
  const pageSurface = isDark ? colors.surface : '#f8faff';
  const sourceLine = `${overview?.source ?? ''} · ${
    overview?.fetchedAt ? formatFetchedAt(overview.fetchedAt) : ''
  }${overview?.stale ? ' · 数据可能滞后' : ''}`;

  if (selectedActivityId) {
    const selected = detail ?? activities.find((item) => item.id === selectedActivityId) ?? null;
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
          <DetailHeader
            colors={colors}
            onBack={() => setSelectedActivityId(null)}
            onShare={selected ? () => openShare(selected) : undefined}
            title="活动详情"
          />
          <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
            {error ? (
              <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={15} color={CORAL} />
                <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>{error}</ThemedText>
              </View>
            ) : null}
            {selected ? (
              <>
                <ActivityDetailHero activity={selected} isDark={isDark} colors={colors} />
                <View style={styles.detailActions}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openOfficialPage(selected)}
                    style={({ pressed }) => [styles.detailActionPrimary, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="open-in-new" size={16} color="#fff" />
                    <ThemedText style={styles.detailActionPrimaryText}>打开官方活动页</ThemedText>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openShare(selected)}
                    style={({ pressed }) => [
                      styles.detailActionGhost,
                      { borderColor: colors.line },
                      pressed && styles.pressed,
                    ]}>
                    <MaterialCommunityIcons name="share-variant-outline" size={16} color={colors.text} />
                    <ThemedText>分享活动</ThemedText>
                  </Pressable>
                </View>
                <View style={[styles.dataCard, { backgroundColor: isDark ? '#1c2440' : '#f3f6fb' }]}>
                  <MaterialCommunityIcons name="database-clock-outline" size={15} color={colors.mutedText} />
                  <ThemedText style={[styles.dataText, { color: colors.mutedText }]}>
                    来源：{overview?.source ?? '地下城与勇士：起源 官方网站'}。标题、时间、链接与配图均来自官网活动中心数据，状态按官网日期判定。
                  </ThemedText>
                </View>
              </>
            ) : (
              <View style={[styles.loadingBox, { borderColor: colors.line }]}>
                <ActivityIndicator color={BLUE} />
                <ThemedText style={[styles.loadingText, { color: colors.mutedText }]}>正在加载活动详情</ThemedText>
              </View>
            )}
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
        <View style={styles.overviewHeader}>
          <View style={styles.overviewTitleBlock}>
            <ThemedText style={styles.overviewTitle}>DNF手游活动助手</ThemedText>
            <ThemedText style={[styles.headerCaption, { color: colors.mutedText }]}>
              {isRefreshing ? '正在刷新' : '地下城与勇士：起源 · 官方数据'}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新活动"
            accessibilityRole="button"
            onPress={handleRefresh}
            style={({ pressed }) => [
              styles.refreshButton,
              { backgroundColor: colors.surface, borderColor: colors.line },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons name="refresh" size={20} color={BLUE} />
          </Pressable>
        </View>

        <ViewTabs activeView={view} colors={colors} onChange={setView} />

        <ScrollView
          contentContainerStyle={styles.overviewContent}
          key={`dnf-activity-${view}`}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={15} color={CORAL} />
              <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>{error}</ThemedText>
            </View>
          ) : null}
          {favoriteNotice ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setFavoriteNotice(null)}
              style={[styles.noticeBanner, { backgroundColor: isDark ? '#29301b' : '#f1f9e3' }]}>
              <MaterialCommunityIcons name="heart-outline" size={15} color={GREEN} />
              <ThemedText style={[styles.noticeText, { color: colors.mutedText }]}>{favoriteNotice}</ThemedText>
            </Pressable>
          ) : null}

          {view === 'overview' && overview ? (
            <OverviewView
              colors={colors}
              favoriteIds={favoriteIds}
              isDark={isDark}
              onOpen={openActivity}
              onOpenList={() => setView('list')}
              onSearch={(value) => {
                setQuery(value);
                setView('list');
              }}
              onShare={openShare}
              onToggleFavorite={toggleFavorite}
              overview={overview}
              sourceLine={sourceLine}
            />
          ) : null}

          {view === 'list' ? (
            <ListView
              colors={colors}
              favoriteIds={favoriteIds}
              isDark={isDark}
              items={filteredActivities}
              counts={{
                ongoing: overview?.ongoing ?? 0,
                upcoming: overview?.upcoming ?? 0,
                ended: overview?.ended ?? 0,
                unknown: overview?.unknown ?? 0,
              }}
              onChangeQuery={setQuery}
              onChangeSort={setSortKey}
              onChangeStatus={setStatusFilter}
              onOpen={openActivity}
              onShare={openShare}
              onToggleFavorite={toggleFavorite}
              query={query}
              sortKey={sortKey}
              statusFilter={statusFilter}
              total={allActivities.length}
              sourceLine={sourceLine}
            />
          ) : null}

          {view === 'calendar' ? (
            <CalendarView
              allActivities={allActivities}
              calendar={calendar}
              calendarMonth={calendarMonth}
              colors={colors}
              favoriteIds={favoriteIds}
              isDark={isDark}
              onChangeMonth={(year, month) => setCalendarMonth({ year, month })}
              onOpen={openActivity}
              onSelectDate={setCalendarSelectedDate}
              onShare={openShare}
              onToggleFavorite={toggleFavorite}
              selectedDate={calendarSelectedDate}
            />
          ) : null}

          {view === 'favorites' ? (
            <FavoritesView
              activities={allActivities}
              colors={colors}
              favoriteIds={favoriteIds}
              isDark={isDark}
              onOpen={openActivity}
              onOpenList={() => setView('list')}
              onShare={openShare}
              onToggleFavorite={toggleFavorite}
              sourceLine={sourceLine}
            />
          ) : null}

          <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
            活动信息来自官网，具体以官方活动页面为准
          </ThemedText>
        </ScrollView>
      </View>

      <ShareModal
        colors={colors}
        isDark={isDark}
        isSaving={isShareLoading}
        message={shareMessage}
        onClose={() => {
          setShareInfo(null);
          setShareMessage(null);
        }}
        onCopyLink={copyShareLink}
        onSavePoster={handleSavePoster}
        onWechatShare={handleWechatShare}
        posterRef={posterCaptureRef}
        shareInfo={shareInfo}
      />
    </SafeAreaView>
  );
}

function OverviewView({
  colors,
  favoriteIds,
  isDark,
  onOpen,
  onOpenList,
  onSearch,
  onShare,
  onToggleFavorite,
  overview,
  sourceLine,
}: {
  colors: ThemeColors;
  favoriteIds: readonly string[];
  isDark: boolean;
  onOpen: (activity: DnfActivity) => void;
  onOpenList: () => void;
  onSearch: (value: string) => void;
  onShare: (activity: DnfActivity) => void;
  onToggleFavorite: (activity: DnfActivity) => void;
  overview: DnfActivityOverview;
  sourceLine: string;
}) {
  const [query, setQuery] = useState('');
  return (
    <>
      <View style={styles.hero}>
        <ThemedText style={styles.heroEyebrow}>官网同步 · 实时状态</ThemedText>
        <View style={styles.heroStats}>
          <ThemedText style={styles.heroNumber}>{overview.ongoing}</ThemedText>
          <ThemedText style={styles.heroCopy}>个活动正在生效，今天还能参加</ThemedText>
        </View>
        <ThemedText style={styles.heroMeta}>{sourceLine}</ThemedText>
      </View>

      <View style={styles.searchBox}>
        <MaterialCommunityIcons name="magnify" size={18} color="#8a93a7" />
        <TextInput
          placeholder="搜索活动名称，如 摸金秘境"
          placeholderTextColor="#9aa3b7"
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => onSearch(query)}
          returnKeyType="search"
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => onSearch(query)}
          style={styles.searchButton}>
          <ThemedText style={styles.searchButtonText}>搜索</ThemedText>
        </Pressable>
      </View>

      <View style={styles.statsGrid}>
        <View style={[styles.statCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.statNumber, { color: CORAL }]}>{overview.ongoing}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>进行中</ThemedText>
        </View>
        <View style={[styles.statCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={styles.statNumber}>{overview.upcoming}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>未开始</ThemedText>
        </View>
        <View style={[styles.statCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.statNumber, { color: GREEN }]}>{overview.ended}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>已结束</ThemedText>
        </View>
        <View style={[styles.statCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.statNumber, { color: AMBER }]}>{overview.unknown}</ThemedText>
          <ThemedText style={[styles.statLabel, { color: colors.mutedText }]}>待确认</ThemedText>
        </View>
      </View>

      <SectionHead title="进行中活动" action="按结束日期排序" onAction={onOpenList} />
      {overview.ongoingActivities.length > 0 ? (
        overview.ongoingActivities.map((activity) => (
          <ActivityCard
            activity={activity}
            colors={colors}
            favorite={favoriteIds.includes(activity.id)}
            isDark={isDark}
            key={activity.id}
            onOpen={() => onOpen(activity)}
            onShare={() => onShare(activity)}
            onToggleFavorite={() => onToggleFavorite(activity)}
          />
        ))
      ) : (
        <EmptyBox
          colors={colors}
          description="当前官网暂无进行中活动。"
          icon="calendar-check-outline"
          title="暂无进行中活动"
        />
      )}

      <SectionHead title="即将结束" action="剩余时间最少优先" onAction={onOpenList} />
      {overview.endingSoon.length > 0 ? (
        overview.endingSoon.map((activity) => (
          <ActivityRow
            activity={activity}
            colors={colors}
            favorite={favoriteIds.includes(activity.id)}
            key={activity.id}
            onOpen={() => onOpen(activity)}
            onShare={() => onShare(activity)}
            onToggleFavorite={() => onToggleFavorite(activity)}
          />
        ))
      ) : null}
    </>
  );
}

function ListView({
  colors,
  favoriteIds,
  isDark,
  items,
  counts,
  onChangeQuery,
  onChangeSort,
  onChangeStatus,
  onOpen,
  onShare,
  onToggleFavorite,
  query,
  sortKey,
  statusFilter,
  total,
  sourceLine,
}: {
  colors: ThemeColors;
  favoriteIds: readonly string[];
  isDark: boolean;
  items: readonly DnfActivity[];
  counts: { ongoing: number; upcoming: number; ended: number; unknown: number };
  onChangeQuery: (value: string) => void;
  onChangeSort: (value: DnfActivitySortKey) => void;
  onChangeStatus: (value: DnfActivityStatus | '') => void;
  onOpen: (activity: DnfActivity) => void;
  onShare: (activity: DnfActivity) => void;
  onToggleFavorite: (activity: DnfActivity) => void;
  query: string;
  sortKey: DnfActivitySortKey;
  statusFilter: DnfActivityStatus | '';
  total: number;
  sourceLine: string;
}) {
  return (
    <>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.statusTabs}>
        {DNF_STATUS_TABS.map((tab) => {
          const count =
            tab.id === 'ongoing'
              ? counts.ongoing
              : tab.id === 'upcoming'
                ? counts.upcoming
                : tab.id === 'ended'
                  ? counts.ended
                  : counts.unknown;
          return (
            <Pressable
              accessibilityRole="button"
              key={tab.id || 'all'}
              onPress={() => onChangeStatus(tab.id)}
              style={[styles.statusTab, statusFilter === tab.id && styles.statusTabActive]}>
              <ThemedText
                style={[
                  styles.statusTabText,
                  { color: statusFilter === tab.id ? colors.surface : colors.mutedText },
                ]}>
                {tab.label}
              </ThemedText>
              {tab.id ? <View style={[styles.statusCount, statusFilter === tab.id && styles.statusCountActive]}><ThemedText style={styles.statusCountText}>{count}</ThemedText></View> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.searchBox}>
        <MaterialCommunityIcons name="magnify" size={18} color="#8a93a7" />
        <TextInput
          placeholder="搜索活动名称"
          placeholderTextColor="#9aa3b7"
          style={[styles.searchInput, { color: colors.text }]}
          value={query}
          onChangeText={onChangeQuery}
          returnKeyType="search"
        />
        {query ? (
          <Pressable accessibilityRole="button" onPress={() => onChangeQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={17} color="#9aa3b7" />
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.listToolbar, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={[styles.toolbarHint, { color: colors.mutedText }]}>
          {items.length > 0 ? `共 ${items.length} 条真实活动` : '暂无匹配活动'}
        </ThemedText>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {SORT_OPTIONS.map((option) => (
            <Pressable
              accessibilityRole="button"
              key={option.id}
              onPress={() => onChangeSort(option.id)}
              style={[styles.sortChip, sortKey === option.id && { backgroundColor: colors.primarySoft }]}>
              <ThemedText
                style={[
                  styles.sortChipText,
                  { color: sortKey === option.id ? colors.primary : colors.mutedText },
                ]}>
                {option.label}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {items.length > 0 ? (
        <View style={[styles.listBox, { borderColor: colors.line }]}>
          {items.map((activity) => (
            <ActivityRow
              activity={activity}
              colors={colors}
              favorite={favoriteIds.includes(activity.id)}
              isDark={isDark}
              key={activity.id}
              onOpen={() => onOpen(activity)}
              onShare={() => onShare(activity)}
              onToggleFavorite={() => onToggleFavorite(activity)}
            />
          ))}
        </View>
      ) : (
        <EmptyBox
          colors={colors}
          description={
            statusFilter === 'upcoming'
              ? '当前官网暂无未开始活动。'
              : '没有找到匹配的活动，试试其他关键词。'
          }
          icon={statusFilter === 'upcoming' ? 'calendar-clock-outline' : 'magnify-close'}
          title={statusFilter === 'upcoming' ? '当前官网暂无未开始活动' : '暂无匹配活动'}
        />
      )}

      <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>{sourceLine}</ThemedText>
    </>
  );
}

function CalendarView({
  allActivities,
  calendar,
  calendarMonth,
  colors,
  favoriteIds,
  isDark,
  onChangeMonth,
  onOpen,
  onSelectDate,
  onShare,
  onToggleFavorite,
  selectedDate,
}: {
  allActivities: readonly DnfActivity[];
  calendar: DnfCalendarMonth | null;
  calendarMonth: { year: number; month: number };
  colors: ThemeColors;
  favoriteIds: readonly string[];
  isDark: boolean;
  onChangeMonth: (year: number, month: number) => void;
  onOpen: (activity: DnfActivity) => void;
  onSelectDate: (date: string) => void;
  onShare: (activity: DnfActivity) => void;
  onToggleFavorite: (activity: DnfActivity) => void;
  selectedDate: string;
}) {
  const activityIdsByDate = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const day of calendar?.days ?? []) {
      result[day.date] = day.activityIds;
    }
    return result;
  }, [calendar]);
  const grid = useMemo(
    () => getDnfCalendarGrid(calendarMonth.year, calendarMonth.month, activityIdsByDate),
    [calendarMonth, activityIdsByDate],
  );
  const selectedActivities = useMemo(() => {
    const ids = activityIdsByDate[selectedDate] ?? [];
    const map = new Map(allActivities.map((activity) => [activity.id, activity]));
    return ids.map((id) => map.get(id)).filter((item): item is DnfActivity => Boolean(item));
  }, [activityIdsByDate, selectedDate, allActivities]);
  const weekLabels = ['一', '二', '三', '四', '五', '六', '日'];

  function shiftMonth(delta: number) {
    const next = new Date(calendarMonth.year, calendarMonth.month - 1 + delta, 1);
    onChangeMonth(next.getFullYear(), next.getMonth() + 1);
  }

  return (
    <>
      <View style={[styles.calendarCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.calendarHead}>
          <ThemedText style={styles.calendarTitle}>
            {calendarMonth.year} 年 {calendarMonth.month} 月
          </ThemedText>
          <View style={styles.calendarNav}>
            <Pressable accessibilityRole="button" onPress={() => shiftMonth(-1)} style={styles.calendarNavButton}>
              <MaterialCommunityIcons name="chevron-left" size={18} color={colors.mutedText} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => shiftMonth(1)} style={styles.calendarNavButton}>
              <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
            </Pressable>
          </View>
        </View>
        <View style={styles.weekRow}>
          {weekLabels.map((label) => (
            <ThemedText key={label} style={[styles.weekLabel, { color: colors.mutedText }]}>
              {label}
            </ThemedText>
          ))}
        </View>
        <View style={styles.daysGrid}>
          {grid.map((cell, index) => {
            if (!cell.inMonth) {
              return <View key={`empty-${index}`} style={styles.dayCell} />;
            }
            const active = selectedDate === cell.date;
            const today = isToday(cell.date);
            return (
              <Pressable
                accessibilityRole="button"
                key={cell.date}
                onPress={() => onSelectDate(cell.date)}
                style={[
                  styles.dayCell,
                  today && styles.dayToday,
                  active && { backgroundColor: colors.primary },
                ]}>
                <ThemedText
                  style={[
                    styles.dayText,
                    { color: today || active ? '#ffffff' : colors.text },
                    cell.has && !active && !today && { color: colors.primary, fontWeight: '900' },
                  ]}>
                  {cell.day}
                </ThemedText>
                {cell.has ? <View style={[styles.dayDot, { backgroundColor: active || today ? LIME : colors.primary }]} /> : null}
              </Pressable>
            );
          })}
        </View>
        <ThemedText style={[styles.calendarLegend, { color: colors.mutedText }]}>
          圆点表示当天有真实活动生效，跨月/跨年活动连续标记
        </ThemedText>
      </View>

      <View style={styles.dayListHead}>
        <ThemedText style={styles.dayListTitle}>{formatDateDisplay(selectedDate)}</ThemedText>
        <ThemedText style={[styles.dayListCount, { color: colors.mutedText }]}>
          当天生效 {selectedActivities.length} 个活动
        </ThemedText>
      </View>
      {selectedActivities.length > 0 ? (
        <View style={[styles.listBox, { borderColor: colors.line }]}>
          {selectedActivities.map((activity) => (
            <ActivityRow
              activity={activity}
              colors={colors}
              favorite={favoriteIds.includes(activity.id)}
              isDark={isDark}
              key={activity.id}
              onOpen={() => onOpen(activity)}
              onShare={() => onShare(activity)}
              onToggleFavorite={() => onToggleFavorite(activity)}
            />
          ))}
        </View>
      ) : (
        <EmptyBox
          colors={colors}
          description="这一天官网没有标注生效活动。"
          icon="calendar-blank-outline"
          title="当天暂无活动"
        />
      )}
    </>
  );
}

function FavoritesView({
  activities,
  colors,
  favoriteIds,
  isDark,
  onOpen,
  onOpenList,
  onShare,
  onToggleFavorite,
  sourceLine,
}: {
  activities: readonly DnfActivity[];
  colors: ThemeColors;
  favoriteIds: readonly string[];
  isDark: boolean;
  onOpen: (activity: DnfActivity) => void;
  onOpenList: () => void;
  onShare: (activity: DnfActivity) => void;
  onToggleFavorite: (activity: DnfActivity) => void;
  sourceLine: string;
}) {
  const favorites = useMemo(() => {
    const map = new Map(activities.map((activity) => [activity.id, activity]));
    return favoriteIds
      .map((id) => map.get(id))
      .filter((item): item is DnfActivity => Boolean(item))
      .filter((activity) => activity.status !== 'ended');
  }, [activities, favoriteIds]);
  const ended = favoriteIds
    .map((id) => new Map(activities.map((activity) => [activity.id, activity])).get(id))
    .filter((item): item is DnfActivity => Boolean(item) && item!.status === 'ended');

  return (
    <>
      <View style={[styles.noticeBanner, { backgroundColor: isDark ? '#29301b' : '#f1f9e3' }]}>
        <MaterialCommunityIcons name="clock-outline" size={15} color={GREEN} />
        <ThemedText style={[styles.noticeText, { color: colors.mutedText }]}>
          关注 {favoriteIds.length} / 30 条，进入页面时按官网日期重算状态并提示变化。
        </ThemedText>
      </View>
      {favorites.length > 0 ? (
        <View style={[styles.listBox, { borderColor: colors.line }]}>
          {favorites.map((activity) => (
            <ActivityRow
              activity={activity}
              colors={colors}
              favorite
              isDark={isDark}
              key={activity.id}
              onOpen={() => onOpen(activity)}
              onShare={() => onShare(activity)}
              onToggleFavorite={() => onToggleFavorite(activity)}
            />
          ))}
        </View>
      ) : (
        <EmptyBox
          colors={colors}
          action={
            <Pressable
              accessibilityRole="button"
              onPress={onOpenList}
              style={[styles.emptyAction, { backgroundColor: colors.primary }]}>
              <MaterialCommunityIcons name="format-list-bulleted" size={16} color="#fff" />
              <ThemedText style={styles.emptyActionText}>去浏览活动</ThemedText>
            </Pressable>
          }
          description="从活动详情或列表中点击爱心，即可关注活动。"
          icon="heart-outline"
          title="还没有关注活动"
        />
      )}
      {ended.length > 0 ? (
        <>
          <SectionHead title="已结束的关注" action="状态自动变更" />
          <View style={[styles.listBox, { borderColor: colors.line }]}>
            {ended.map((activity) => (
              <ActivityRow
                activity={activity}
                colors={colors}
                favorite
                isDark={isDark}
                key={activity.id}
                onOpen={() => onOpen(activity)}
                onShare={() => onShare(activity)}
                onToggleFavorite={() => onToggleFavorite(activity)}
              />
            ))}
          </View>
        </>
      ) : null}
      <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>{sourceLine}</ThemedText>
    </>
  );
}

function ActivityCard({
  activity,
  colors,
  favorite,
  isDark,
  onOpen,
  onShare,
  onToggleFavorite,
}: {
  activity: DnfActivity;
  colors: ThemeColors;
  favorite: boolean;
  isDark: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.activityCard,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <ImageBackground
        imageStyle={styles.activityCoverImage}
        source={activityImageSource(activity)}
        style={styles.activityCover}>
        <View style={styles.coverShade} />
        {getDnfActivityDaysLabel(activity) ? (
          <ThemedText style={styles.coverDays}>{getDnfActivityDaysLabel(activity)}</ThemedText>
        ) : (
          <ThemedText style={styles.coverDays}>{isLongRunning(activity) ? '长期进行' : getDnfActivityStatusLabel(activity.status)}</ThemedText>
        )}
      </ImageBackground>
      <View style={styles.activityBody}>
        <ThemedText numberOfLines={2} style={styles.activityTitle}>
          {activity.title}
        </ThemedText>
        <ThemedText style={[styles.activityTime, { color: colors.mutedText }]}>
          {formatDnfActivityDateRange(activity)}
        </ThemedText>
        <View style={styles.activityRowActions}>
          <View style={[styles.activityLink, { backgroundColor: HERO }]}>
            <MaterialCommunityIcons name="open-in-new" size={12} color={LIME} />
            <ThemedText style={styles.activityLinkText}>打开官方页</ThemedText>
          </View>
          <Pressable
            accessibilityLabel="分享活动"
            onPress={onShare}
            style={[styles.activityIconButton, { backgroundColor: isDark ? '#1d2730' : '#f3f6fb', borderColor: colors.line }]}>
            <MaterialCommunityIcons name="share-variant-outline" size={14} color={colors.mutedText} />
          </Pressable>
          <Pressable
            accessibilityLabel={favorite ? '取消关注' : '关注活动'}
            onPress={onToggleFavorite}
            style={[
              styles.activityIconButton,
              { backgroundColor: favorite ? '#fdeef1' : (isDark ? '#1d2730' : '#f3f6fb'), borderColor: colors.line },
            ]}>
            <MaterialCommunityIcons name={favorite ? 'heart' : 'heart-outline'} size={14} color={favorite ? CORAL : colors.mutedText} />
          </Pressable>
        </View>
      </View>
    </Pressable>
  );
}

function ActivityRow({
  activity,
  colors,
  favorite,
  isDark,
  onOpen,
  onShare,
  onToggleFavorite,
}: {
  activity: DnfActivity;
  colors: ThemeColors;
  favorite: boolean;
  isDark?: boolean;
  onOpen: () => void;
  onShare: () => void;
  onToggleFavorite: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [
        styles.activityRow,
        { borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <Image source={activityImageSource(activity)} style={styles.activityThumb} />
      <View style={styles.activityRowBody}>
        <ThemedText numberOfLines={1} style={styles.activityRowTitle}>
          {activity.title}
        </ThemedText>
        <ThemedText numberOfLines={1} style={[styles.activityRowDate, { color: colors.mutedText }]}>
          {formatDnfActivityDateRange(activity)}
        </ThemedText>
        <View style={styles.activityRowTags}>
          <StatusPill activity={activity} />
        </View>
      </View>
      <View style={styles.activityRowIcons}>
        <Pressable
          accessibilityLabel="分享活动"
          onPress={onShare}
          style={styles.activityRowIcon}>
          <MaterialCommunityIcons name="share-variant-outline" size={15} color={colors.mutedText} />
        </Pressable>
        <Pressable
          accessibilityLabel={favorite ? '取消关注' : '关注活动'}
          onPress={onToggleFavorite}
          style={styles.activityRowIcon}>
          <MaterialCommunityIcons name={favorite ? 'heart' : 'heart-outline'} size={15} color={favorite ? CORAL : colors.mutedText} />
        </Pressable>
      </View>
    </Pressable>
  );
}

function ActivityDetailHero({
  activity,
  colors,
  isDark,
}: {
  activity: DnfActivity;
  colors: ThemeColors;
  isDark: boolean;
}) {
  return (
    <>
      <View style={styles.detailHero}>
        <ImageBackground
          imageStyle={styles.detailHeroImage}
          source={activityImageSource(activity)}
          style={styles.detailHeroBackground}>
          <View style={styles.detailHeroShade} />
          <View style={[styles.detailStateFloat, { backgroundColor: LIME }]}>
            <ThemedText style={styles.detailStateFloatText}>{getDnfActivityStatusLabel(activity.status)}</ThemedText>
          </View>
          <View style={styles.detailDaysFloat}>
            {getDnfActivityDaysLabel(activity) ? (
              <ThemedText style={styles.detailDaysNumber}>{getDnfActivityDaysLabel(activity)}</ThemedText>
            ) : null}
            {activity.endDate ? (
              <ThemedText style={styles.detailDaysCaption}>{activity.endDate} 结束</ThemedText>
            ) : null}
          </View>
        </ImageBackground>
      </View>
      <ThemedText style={styles.detailTitle}>{activity.title}</ThemedText>
      <ThemedText style={[styles.detailTime, { color: colors.mutedText }]}>
        {formatDnfActivityDateRange(activity)} · 官网日期
      </ThemedText>
      <View style={[styles.introCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.introLabel}>
          <MaterialCommunityIcons name="file-document-outline" size={14} color={colors.mutedText} />
          <ThemedText style={[styles.introLabelText, { color: colors.mutedText }]}>官方简介（官网原文）</ThemedText>
        </View>
        <ThemedText style={[styles.introCopy, { color: isDark ? '#c8d2e2' : '#41506b' }]}>
          {activity.description || '官方详情以官网活动页为准。'}
        </ThemedText>
      </View>
    </>
  );
}

function StatusPill({ activity }: { activity: DnfActivity }) {
  const label = getDnfActivityStatusLabel(activity.status);
  const days = getDnfActivityDaysLabel(activity);
  const tone =
    activity.status === 'ongoing'
      ? { backgroundColor: '#e7f6ef', color: '#2e8f62' }
      : activity.status === 'upcoming'
        ? { backgroundColor: '#e7ecff', color: BLUE }
        : activity.status === 'ended'
          ? { backgroundColor: '#eef1f8', color: '#8b97ad' }
          : { backgroundColor: '#fff3e2', color: '#b06d14' };
  return (
    <View style={[styles.statusPill, tone]}>
      <ThemedText style={[styles.statusPillText, { color: tone.color }]}>
        {days ? `${label} · ${days}` : label}
      </ThemedText>
    </View>
  );
}

function SectionHead({
  title,
  action,
  onAction,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.sectionHead}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {action ? (
        <Pressable accessibilityRole="button" onPress={onAction}>
          <ThemedText style={styles.sectionAction}>{action}</ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyBox({
  action,
  colors,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  colors: ThemeColors;
  description: string;
  icon: IconName;
  title: string;
}) {
  return (
    <View style={[styles.emptyBox, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={30} color={colors.primary} />
      <ThemedText style={styles.emptyTitle}>{title}</ThemedText>
      <ThemedText style={[styles.emptyDescription, { color: colors.mutedText }]}>{description}</ThemedText>
      {action}
    </View>
  );
}

function PageErrorRetry({
  colors,
  message,
  onRetry,
  title,
}: {
  colors: ThemeColors;
  message: string;
  onRetry: () => void;
  title: string;
}) {
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style="dark" />
      <View style={styles.errorPage}>
        <View style={[styles.errorIcon, { backgroundColor: '#fff0f4' }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={30} color="#d6455d" />
        </View>
        <ThemedText style={styles.errorTitle}>{title}加载失败</ThemedText>
        <ThemedText style={[styles.errorMessage, { color: colors.mutedText }]}>{message}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.retryButton, { backgroundColor: colors.primary }, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="refresh" size={17} color="#fff" />
          <ThemedText style={styles.retryButtonText}>重试</ThemedText>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function ViewTabs({
  activeView,
  colors,
  onChange,
}: {
  activeView: ViewId;
  colors: ThemeColors;
  onChange: (view: ViewId) => void;
}) {
  return (
    <View style={[styles.viewTabs, { borderColor: colors.line, backgroundColor: colors.surface }]}>
      {VIEW_TABS.map((tab) => (
        <Pressable
          accessibilityRole="button"
          key={tab.id}
          onPress={() => onChange(tab.id)}
          style={[styles.viewTab, activeView === tab.id && { backgroundColor: HERO }]}>
          <MaterialCommunityIcons
            name={tab.icon}
            size={17}
            color={activeView === tab.id ? LIME : colors.mutedText}
          />
          <ThemedText
            style={[
              styles.viewTabText,
              { color: activeView === tab.id ? '#ffffff' : colors.mutedText },
            ]}>
            {tab.label}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

function DetailHeader({
  colors,
  onBack,
  onShare,
  title,
}: {
  colors: ThemeColors;
  onBack: () => void;
  onShare?: () => void;
  title: string;
}) {
  return (
    <View style={[styles.detailHeader, { borderColor: colors.line, backgroundColor: colors.surface }]}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        onPress={onBack}
        style={styles.detailHeaderButton}>
        <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
      </Pressable>
      <ThemedText style={styles.detailHeaderTitle}>{title}</ThemedText>
      {onShare ? (
        <Pressable
          accessibilityLabel="分享"
          accessibilityRole="button"
          onPress={onShare}
          style={[styles.detailHeaderButton, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="share-variant-outline" size={18} color={colors.primary} />
        </Pressable>
      ) : (
        <View style={styles.detailHeaderButton} />
      )}
    </View>
  );
}

function ShareModal({
  colors,
  isDark,
  isSaving,
  message,
  onClose,
  onCopyLink,
  onSavePoster,
  onWechatShare,
  posterRef,
  shareInfo,
}: {
  colors: ThemeColors;
  isDark: boolean;
  isSaving: boolean;
  message: string | null;
  onClose: () => void;
  onCopyLink: () => void;
  onSavePoster: () => void;
  onWechatShare: () => void;
  posterRef: RefObject<View | null>;
  shareInfo: DnfShareInfo | null;
}) {
  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      transparent
      visible={shareInfo !== null}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.shareSheet, { backgroundColor: colors.surface }]}>
          <View style={styles.shareSheetHead}>
            <ThemedText style={styles.shareSheetTitle}>分享活动</ThemedText>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.shareClose}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          {isSaving || !shareInfo ? (
            <View style={styles.shareLoading}>
              <ActivityIndicator color={BLUE} />
              <ThemedText style={[styles.shareLoadingText, { color: colors.mutedText }]}>正在生成分享内容</ThemedText>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.shareOptions}>
                <Pressable
                  accessibilityRole="button"
                  onPress={onCopyLink}
                  style={[styles.shareOption, { borderColor: colors.line }]}>
                  <View style={[styles.shareOptionIcon, { backgroundColor: colors.primarySoft }]}>
                    <MaterialCommunityIcons name="link-variant" size={18} color={colors.primary} />
                  </View>
                  <View style={styles.shareOptionCopy}>
                    <ThemedText style={styles.shareOptionTitle}>复制官方链接</ThemedText>
                    <ThemedText numberOfLines={1} style={[styles.shareOptionDesc, { color: colors.mutedText }]}>
                      {shareInfo.url}
                    </ThemedText>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="#9aa3b7" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={onWechatShare}
                  style={[styles.shareOption, { borderColor: colors.line }]}>
                  <View style={[styles.shareOptionIcon, { backgroundColor: '#e7f6ef' }]}>
                    <MaterialCommunityIcons name="message-text-outline" size={18} color={GREEN} />
                  </View>
                  <View style={styles.shareOptionCopy}>
                    <ThemedText style={styles.shareOptionTitle}>微信分享</ThemedText>
                    <ThemedText style={[styles.shareOptionDesc, { color: colors.mutedText }]}>
                      小程序卡片，标题与封面来自真实活动数据
                    </ThemedText>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="#9aa3b7" />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={onSavePoster}
                  style={[styles.shareOption, { borderColor: colors.line }]}>
                  <View style={[styles.shareOptionIcon, { backgroundColor: '#fff3e2' }]}>
                    <MaterialCommunityIcons name="image-outline" size={18} color={AMBER} />
                  </View>
                  <View style={styles.shareOptionCopy}>
                    <ThemedText style={styles.shareOptionTitle}>保存分享海报</ThemedText>
                    <ThemedText style={[styles.shareOptionDesc, { color: colors.mutedText }]}>
                      官方配图 + 真实标题与时间 + 官网二维码
                    </ThemedText>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color="#9aa3b7" />
                </Pressable>
              </View>

              <View style={[styles.poster, { backgroundColor: HERO }]}>
                <View collapsable={false} ref={posterRef} style={styles.posterInner}>
                  <ImageBackground
                    imageStyle={styles.posterCoverImage}
                    source={shareInfo.imageUrl ? { uri: normalizeUrl(shareInfo.imageUrl) } : undefined}
                    style={styles.posterCover}>
                    <View style={styles.posterCoverShade} />
                  </ImageBackground>
                  <ThemedText style={styles.posterTitle}>{shareInfo.title}</ThemedText>
                  <ThemedText style={styles.posterMeta}>
                    {shareInfo.startDate && shareInfo.endDate
                      ? `${shareInfo.startDate} ~ ${shareInfo.endDate}`
                      : '时间以官网为准'}
                  </ThemedText>
                  <View style={styles.posterFoot}>
                    <View>
                      <ThemedText style={styles.posterSource}>地下城与勇士：起源 官方活动</ThemedText>
                      <ThemedText style={styles.posterSourceHint}>扫码直达官网活动页</ThemedText>
                    </View>
                    <View style={styles.posterQR}>
                      <QRCode size={46} value={shareInfo.url} />
                    </View>
                  </View>
                </View>
              </View>

              {message ? (
                <View style={[styles.shareMessage, { backgroundColor: isDark ? '#1c2440' : '#f3f6fb' }]}>
                  <MaterialCommunityIcons name="check-circle-outline" size={15} color={GREEN} />
                  <ThemedText style={[styles.shareMessageText, { color: colors.mutedText }]}>{message}</ThemedText>
                </View>
              ) : null}
              <ThemedText style={[styles.shareDisclaimer, { color: colors.mutedText }]}>
                链接与二维码均指向官网活动页原文，不生成站内伪链接
              </ThemedText>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function activityImageSource(activity: DnfActivity) {
  const uri = normalizeUrl(activity.mobileImage || activity.pcImage);
  return uri ? { uri } : undefined;
}

function normalizeUrl(value?: string) {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return '';
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  return trimmed;
}

function formatFetchedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateDisplay(value: string) {
  const parts = value.split('-');
  if (parts.length !== 3) return value;
  return `${Number(parts[0])} 年 ${Number(parts[1])} 月 ${Number(parts[2])} 日`;
}

function localDateString(date: Date) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screenShell: {
    flex: 1,
  },
  overviewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  overviewTitleBlock: {
    minWidth: 0,
  },
  overviewTitle: {
    fontSize: 22,
    fontWeight: '900',
  },
  headerCaption: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 3,
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  viewTabs: {
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: 16,
    marginTop: 14,
    padding: 4,
  },
  viewTab: {
    alignItems: 'center',
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 38,
  },
  viewTabText: {
    fontSize: 11,
    fontWeight: '900',
  },
  overviewContent: {
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  detailContent: {
    paddingBottom: 30,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  hero: {
    backgroundColor: HERO,
    borderRadius: 14,
    padding: 14,
  },
  heroEyebrow: {
    color: LIME,
    fontSize: 10,
    fontWeight: '900',
    marginBottom: 8,
  },
  heroStats: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
  },
  heroNumber: {
    color: '#ffffff',
    fontSize: 30,
    fontWeight: '900',
  },
  heroCopy: {
    color: '#dbe4f5',
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
  },
  heroMeta: {
    color: '#aebbd0',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 8,
  },
  searchBox: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 8,
    flexDirection: 'row',
    height: 42,
    marginTop: 10,
    paddingHorizontal: 11,
  },
  searchInput: {
    flex: 1,
    fontSize: 12,
    minWidth: 0,
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  searchButton: {
    alignItems: 'center',
    backgroundColor: LIME,
    borderRadius: 6,
    height: 30,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  searchButtonText: {
    color: HERO,
    fontSize: 11,
    fontWeight: '900',
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 7,
    marginTop: 10,
  },
  statCell: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    flex: 1,
    paddingVertical: 9,
  },
  statNumber: {
    fontSize: 17,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  sectionHead: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 14,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
  },
  sectionAction: {
    color: BLUE,
    fontSize: 10,
    fontWeight: '800',
  },
  activityCard: {
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
    overflow: 'hidden',
  },
  activityCover: {
    height: 104,
    justifyContent: 'flex-end',
    padding: 8,
    width: 116,
  },
  activityCoverImage: {
    borderRadius: 0,
  },
  coverShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,17,38,0.24)',
  },
  coverDays: {
    color: LIME,
    fontSize: 10,
    fontWeight: '900',
    zIndex: 1,
  },
  activityBody: {
    flex: 1,
    justifyContent: 'center',
    minWidth: 0,
    paddingRight: 10,
  },
  activityTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  activityTime: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 4,
  },
  activityRowActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  activityLink: {
    alignItems: 'center',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 4,
    height: 26,
    paddingHorizontal: 8,
  },
  activityLinkText: {
    color: LIME,
    fontSize: 9,
    fontWeight: '900',
  },
  activityIconButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 6,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  statusTabs: {
    flexGrow: 0,
    marginBottom: 10,
  },
  statusTab: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 5,
    marginRight: 8,
    minHeight: 34,
    paddingHorizontal: 12,
  },
  statusTabActive: {
    backgroundColor: HERO,
  },
  statusTabText: {
    fontSize: 11,
    fontWeight: '900',
  },
  statusCount: {
    backgroundColor: '#e6ebff',
    borderRadius: 8,
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  statusCountActive: {
    backgroundColor: LIME,
  },
  statusCountText: {
    color: HERO,
    fontSize: 9,
    fontWeight: '900',
    textAlign: 'center',
  },
  listToolbar: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    minHeight: 38,
    paddingHorizontal: 10,
  },
  toolbarHint: {
    fontSize: 9,
    fontWeight: '700',
  },
  sortChip: {
    borderRadius: 6,
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  sortChipText: {
    fontSize: 9,
    fontWeight: '900',
  },
  listBox: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 8,
    overflow: 'hidden',
  },
  activityRow: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: 10,
    minHeight: 72,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  activityThumb: {
    borderRadius: 6,
    height: 48,
    width: 64,
  },
  activityRowBody: {
    flex: 1,
    minWidth: 0,
  },
  activityRowTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  activityRowDate: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 3,
  },
  activityRowTags: {
    flexDirection: 'row',
    marginTop: 5,
  },
  activityRowIcons: {
    gap: 6,
  },
  activityRowIcon: {
    alignItems: 'center',
    height: 24,
    justifyContent: 'center',
    width: 24,
  },
  statusPill: {
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  statusPillText: {
    fontSize: 8,
    fontWeight: '900',
  },
  emptyBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 26,
  },
  emptyTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  emptyDescription: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center',
  },
  emptyAction: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    height: 38,
    justifyContent: 'center',
    marginTop: 8,
    paddingHorizontal: 16,
  },
  emptyActionText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  sourceText: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 15,
    marginTop: 12,
  },
  errorBanner: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
    padding: 10,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  noticeBanner: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    marginBottom: 10,
    padding: 10,
  },
  noticeText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  disclaimer: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 16,
    textAlign: 'center',
  },
  detailHeader: {
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    height: 54,
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  detailHeaderButton: {
    alignItems: 'center',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  detailHeaderTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  detailHero: {
    borderRadius: 12,
    height: 168,
    overflow: 'hidden',
  },
  detailHeroBackground: {
    flex: 1,
    justifyContent: 'space-between',
    padding: 10,
  },
  detailHeroImage: {
    borderRadius: 12,
  },
  detailHeroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,17,38,0.34)',
  },
  detailStateFloat: {
    alignSelf: 'flex-start',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  detailStateFloatText: {
    color: HERO,
    fontSize: 9,
    fontWeight: '900',
  },
  detailDaysFloat: {
    alignSelf: 'flex-start',
  },
  detailDaysNumber: {
    color: LIME,
    fontSize: 16,
    fontWeight: '900',
  },
  detailDaysCaption: {
    color: '#dbe4f5',
    fontSize: 9,
    fontWeight: '800',
    marginTop: 2,
  },
  detailTitle: {
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 25,
    marginTop: 12,
  },
  detailTime: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 5,
  },
  introCard: {
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 12,
    padding: 12,
  },
  introLabel: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    marginBottom: 7,
  },
  introLabelText: {
    fontSize: 10,
    fontWeight: '800',
  },
  introCopy: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 20,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  detailActionPrimary: {
    alignItems: 'center',
    backgroundColor: BLUE,
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  detailActionPrimaryText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '900',
  },
  detailActionGhost: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 42,
    justifyContent: 'center',
  },
  dataCard: {
    alignItems: 'flex-start',
    borderLeftWidth: 3,
    borderLeftColor: BLUE,
    borderRadius: 6,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 10,
  },
  dataText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 16,
  },
  loadingBox: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    gap: 8,
    paddingVertical: 34,
  },
  loadingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  calendarCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  calendarHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calendarTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  calendarNav: {
    flexDirection: 'row',
    gap: 6,
  },
  calendarNavButton: {
    alignItems: 'center',
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  weekRow: {
    flexDirection: 'row',
    marginBottom: 5,
  },
  weekLabel: {
    flex: 1,
    fontSize: 9,
    fontWeight: '800',
    textAlign: 'center',
  },
  daysGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  dayCell: {
    alignItems: 'center',
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: `${100 / 7}%`,
  },
  dayText: {
    fontSize: 11,
    fontWeight: '800',
  },
  dayDot: {
    borderRadius: 4,
    height: 4,
    marginTop: 3,
    width: 4,
  },
  dayToday: {
    backgroundColor: HERO,
  },
  calendarLegend: {
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 14,
    marginTop: 10,
  },
  dayListHead: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
    marginTop: 14,
  },
  dayListTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  dayListCount: {
    fontSize: 9,
    fontWeight: '700',
  },
  modalBackdrop: {
    backgroundColor: 'rgba(9,17,38,0.46)',
    flex: 1,
    justifyContent: 'flex-end',
  },
  shareSheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '84%',
    paddingBottom: 24,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  shareSheetHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  shareSheetTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  shareClose: {
    alignItems: 'center',
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  shareLoading: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 40,
  },
  shareLoadingText: {
    fontSize: 11,
    fontWeight: '700',
  },
  shareOptions: {
    gap: 8,
  },
  shareOption: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
    paddingHorizontal: 10,
  },
  shareOptionIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  shareOptionCopy: {
    flex: 1,
    minWidth: 0,
  },
  shareOptionTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  shareOptionDesc: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  poster: {
    borderRadius: 12,
    marginTop: 14,
    overflow: 'hidden',
    paddingBottom: 12,
  },
  posterInner: {
    backgroundColor: HERO,
  },
  posterCover: {
    height: 150,
  },
  posterCoverImage: {
    borderRadius: 0,
  },
  posterCoverShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(9,17,38,0.2)',
  },
  posterTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
    marginHorizontal: 12,
    marginTop: 10,
  },
  posterMeta: {
    color: '#aebbd0',
    fontSize: 10,
    fontWeight: '700',
    marginHorizontal: 12,
    marginTop: 4,
  },
  posterFoot: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    marginTop: 10,
  },
  posterSource: {
    color: LIME,
    fontSize: 10,
    fontWeight: '900',
  },
  posterSourceHint: {
    color: '#aebbd0',
    fontSize: 8,
    fontWeight: '700',
    marginTop: 3,
  },
  posterQR: {
    backgroundColor: '#ffffff',
    borderRadius: 6,
    padding: 3,
  },
  shareMessage: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    padding: 10,
  },
  shareMessageText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  shareDisclaimer: {
    fontSize: 9,
    fontWeight: '700',
    marginTop: 12,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
  errorPage: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  errorIcon: {
    alignItems: 'center',
    borderRadius: 999,
    height: 62,
    justifyContent: 'center',
    width: 62,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '900',
    marginTop: 16,
  },
  errorMessage: {
    fontSize: 12,
    lineHeight: 19,
    marginTop: 8,
    maxWidth: 260,
    textAlign: 'center',
  },
  retryButton: {
    alignItems: 'center',
    borderRadius: 10,
    flexDirection: 'row',
    gap: 6,
    height: 44,
    justifyContent: 'center',
    marginTop: 22,
    paddingHorizontal: 22,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
});
