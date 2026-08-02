import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { MarketSparkline, MarketTrendChart } from '@/features/tools/market-radar-chart';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  getMarketPulse,
  getMarketSector,
  getRankedMarketSectors,
  getSignalSectors,
  getSignalTypeLabel,
  getWatchSectorSummaries,
  searchMarketSectors,
  sortMarketSectors,
} from '@/lib/market-radar';
import {
  fetchMarketRadarSectorDetail,
  fetchMarketRadarSnapshot,
  getMarketRadarErrorMessage,
} from '@/lib/market-radar-api';
import { loadMarketRadarWatchIds, saveMarketRadarWatchIds } from '@/lib/market-radar-watch-storage';
import { PageErrorState } from '@/shared/ui/page-error-state';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import type {
  MarketCategoryId,
  MarketPeriodId,
  MarketRadarSnapshot,
  MarketSector,
  MarketSectorDetail,
  MarketSignal,
  MarketSignalType,
  MarketSortKey,
  MarketView,
} from '@/types/market-radar';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff5d6c';
const GREEN = '#24b36b';

const VIEW_TABS: { id: MarketView; label: string; icon: IconName }[] = [
  { id: 'overview', label: '总览', icon: 'radar' },
  { id: 'sectors', label: '板块', icon: 'view-grid-outline' },
  { id: 'signals', label: '异动', icon: 'pulse' },
  { id: 'watch', label: '关注', icon: 'bookmark-outline' },
];

const SORT_OPTIONS: { id: MarketSortKey; label: string }[] = [
  { id: 'change', label: '涨跌幅' },
  { id: 'amount', label: '成交额' },
  { id: 'turnover', label: '换手率' },
  { id: 'advancingRatio', label: '上涨占比' },
  { id: 'strength', label: '相对强弱' },
];

const CATEGORY_ICONS: Record<MarketCategoryId, IconName> = {
  market: 'chart-line',
  ai: 'creation-outline',
  'new-energy': 'weather-sunny',
  health: 'medical-bag',
  finance: 'bank-outline',
  manufacturing: 'factory',
  themes: 'star-four-points-outline',
};

const SECTOR_ICONS: Record<string, IconName> = {
  BK1134: 'brain',
  BK1128: 'lightbulb-on-outline',
  BK1127: 'memory',
  BK0800: 'robot-outline',
  BK0579: 'cloud-outline',
  BK0634: 'database-outline',
  BK1104: 'shield-lock-outline',
  BK1184: 'human-handsup',
  BK0802: 'car-outline',
  BK1036: 'chip',
  BK0732: 'medal-outline',
  BK0479: 'shield-outline',
  BK0437: 'mine',
  BK0464: 'oil',
  BK1206: 'flask-outline',
  BK0490: 'airplane',
  BK0739: 'excavator',
  BK1166: 'airplane-marker',
  BK0921: 'satellite-variant',
  BK0710: 'atom',
  BK1135: 'database-settings-outline',
  BK0854: 'cellphone-link',
  BK1138: 'coolant-temperature',
  BK0877: 'sitemap-outline',
  BK0577: 'atom-variant',
  BK0922: 'server-network',
  BK1174: 'dna',
};

const SIGNAL_ICONS: Record<MarketSignalType, IconName> = {
  leader: 'trending-up',
  laggard: 'trending-down',
  volume: 'chart-areaspline',
  reversal: 'swap-vertical',
  breadth: 'view-dashboard-outline',
};

export function MarketRadarScreen() {
  const { colorScheme, colors } = useAppTheme();
  const [view, setView] = useState<MarketView>('overview');
  const [categoryId, setCategoryId] = useState<MarketCategoryId>('market');
  const [periodId, setPeriodId] = useState<MarketPeriodId>('1d');
  const [sortKey, setSortKey] = useState<MarketSortKey>('change');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [watchedIds, setWatchedIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<MarketRadarSnapshot | null>(null);
  const [detail, setDetail] = useState<MarketSectorDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const next = await fetchMarketRadarSnapshot(controller.signal);
        setSnapshot(next);
        setLoadError(null);
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(getMarketRadarErrorMessage(error));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    load();
    loadMarketRadarWatchIds().then(setWatchedIds);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
    if (typeof window !== 'undefined') window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [view, selectedSectorId]);

  useEffect(() => {
    if (!selectedSectorId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError(null);
    setIsDetailLoading(true);
    fetchMarketRadarSectorDetail(selectedSectorId, controller.signal)
      .then(setDetail)
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(getMarketRadarErrorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedSectorId]);

  function toggleWatch(sectorId: string) {
    setWatchedIds((current) => {
      const next = current.includes(sectorId)
        ? current.filter((id) => id !== sectorId)
        : [...current, sectorId];
      saveMarketRadarWatchIds(next);
      return next;
    });
  }

  async function handleRefresh() {
    setIsRefreshing(true);
    setLoadError(null);
    try {
      const next = await fetchMarketRadarSnapshot(undefined, true);
      setSnapshot(next);
    } catch (error) {
      setLoadError(getMarketRadarErrorMessage(error));
    } finally {
      setIsRefreshing(false);
    }
  }

  function retry() {
    setIsLoading(true);
    setLoadError(null);
    fetchMarketRadarSnapshot(undefined, true)
      .then(setSnapshot)
      .catch((error) => setLoadError(getMarketRadarErrorMessage(error)))
      .finally(() => setIsLoading(false));
  }

  if (!snapshot) {
    return isLoading ? (
      <PageLoadingFrame stateLabel="正在加载行情" title="市场雷达" variant="panel" />
    ) : (
      <PageErrorState
        message={loadError ?? undefined}
        onRetry={retry}
        title="市场雷达"
      />
    );
  }

  const isDark = colorScheme === 'dark';
  const pageSurface = isDark ? colors.surface : '#f8faff';
  const selectedSector = selectedSectorId ? getMarketSector(snapshot, selectedSectorId) : undefined;
  const snapshotStatus = isRefreshing
    ? '正在刷新'
    : snapshot.stale
      ? '缓存行情'
      : `${formatFetchedAt(snapshot.fetchedAt)} 更新`;

  if (selectedSector) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
          <DetailHeader
            colors={colors}
            isDark={isDark}
            onBack={() => setSelectedSectorId(null)}
            onToggleWatch={() => toggleWatch(selectedSector.id)}
            periodLabel={getPeriodLabel(snapshot, periodId)}
            sector={selectedSector}
            watched={watchedIds.includes(selectedSector.id)}
          />
          <ScrollView
            contentContainerStyle={styles.detailContent}
            key={`market-radar-detail-${selectedSector.id}`}
            ref={scrollRef}
            showsVerticalScrollIndicator={false}>
            {isDetailLoading ? (
              <View style={styles.detailLoading}>
                <ActivityIndicator color={BLUE} size="large" />
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                  正在加载板块详情
                </ThemedText>
              </View>
            ) : detailError ? (
              <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
                <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>
                  {detailError}
                </ThemedText>
              </View>
            ) : detail ? (
              <SectorDetailBody
                colors={colors}
                detail={detail}
                isDark={isDark}
                onOpenSector={setSelectedSectorId}
                periodId={periodId}
                snapshot={snapshot}
              />
            ) : null}
            <View style={styles.sourceLine}>
              <MaterialCommunityIcons name="database-clock-outline" size={15} color={colors.mutedText} />
              <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>
                东方财富公开行情 · 延迟数据 · 覆盖 {snapshot.coverage.loaded}/{snapshot.coverage.requested} 个板块
              </ThemedText>
            </View>
            <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
              仅作信息展示，不构成投资建议
            </ThemedText>
          </ScrollView>
          <ToolBottomNavigation />
        </View>
      </SafeAreaView>
    );
  }

  const categorySectors = searchQuery.trim()
    ? searchMarketSectors(snapshot, searchQuery)
    : getRankedMarketSectors(snapshot, categoryId, periodId);
  const rankedSectors = sortMarketSectors(categorySectors, periodId, sortKey);
  const pulse = getMarketPulse(snapshot, categoryId, periodId);
  const strongestSector = pulse.strongestSectorId
    ? getMarketSector(snapshot, pulse.strongestSectorId)
    : undefined;

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
        <View style={styles.overviewHeader}>
          <View>
            <ThemedText style={styles.overviewTitle}>市场雷达</ThemedText>
            <ThemedText style={[styles.headerCaption, { color: colors.mutedText }]}>
              {snapshotStatus}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新市场快照状态"
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

        <ViewTabs
          activeView={view}
          colors={colors}
          onChange={setView}
        />

        <ScrollView
          contentContainerStyle={styles.overviewContent}
          key={`market-radar-${view}`}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}>
          {loadError ? (
            <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
              <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>
                {loadError}
              </ThemedText>
            </View>
          ) : null}

          {view === 'overview' ? (
            <OverviewView
              colors={colors}
              isDark={isDark}
              onOpenSector={setSelectedSectorId}
              onPeriodChange={setPeriodId}
              periodId={periodId}
              pulse={pulse}
              snapshot={snapshot}
              strongestSector={strongestSector}
            />
          ) : null}

          {view === 'sectors' ? (
            <SectorsView
              categoryId={categoryId}
              colors={colors}
              onCategoryChange={setCategoryId}
              onOpenSector={setSelectedSectorId}
              onPeriodChange={setPeriodId}
              onSearchChange={setSearchQuery}
              onSortChange={setSortKey}
              onToggleWatch={toggleWatch}
              periodId={periodId}
              rankedSectors={rankedSectors}
              searchQuery={searchQuery}
              snapshot={snapshot}
              sortKey={sortKey}
              watchedIds={watchedIds}
            />
          ) : null}

          {view === 'signals' ? (
            <SignalsView
              colors={colors}
              isDark={isDark}
              onOpenSector={setSelectedSectorId}
              snapshot={snapshot}
            />
          ) : null}

          {view === 'watch' ? (
            <WatchView
              colors={colors}
              onOpenSector={setSelectedSectorId}
              onToggleWatch={toggleWatch}
              onBrowse={() => setView('sectors')}
              periodId={periodId}
              snapshot={snapshot}
              watchedIds={watchedIds}
            />
          ) : null}

          <View style={styles.sourceLine}>
            <MaterialCommunityIcons name="database-clock-outline" size={15} color={colors.mutedText} />
            <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>
              东方财富公开行情 · 延迟数据 · 覆盖 {snapshot.coverage.loaded}/{snapshot.coverage.requested} 个板块
            </ThemedText>
          </View>
          <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
            仅作信息展示，不构成投资建议
          </ThemedText>
        </ScrollView>

        <ToolBottomNavigation />
      </View>
    </SafeAreaView>
  );
}

function OverviewView({
  colors,
  isDark,
  onOpenSector,
  onPeriodChange,
  periodId,
  pulse,
  snapshot,
  strongestSector,
}: {
  colors: ThemeColors;
  isDark: boolean;
  onOpenSector: (sectorId: string) => void;
  onPeriodChange: (period: MarketPeriodId) => void;
  periodId: MarketPeriodId;
  pulse: ReturnType<typeof getMarketPulse>;
  snapshot: MarketRadarSnapshot;
  strongestSector?: MarketSector;
}) {
  const marketSectors = getRankedMarketSectors(snapshot, 'market', periodId);
  const distribution = buildBreadthDistribution(marketSectors, periodId);
  const maxBucket = Math.max(...distribution.map((bucket) => bucket.count), 1);
  const strongest = marketSectors.slice(0, 3);
  const weakest = marketSectors.slice(-3).reverse();

  return (
    <>
      <View style={styles.pulseHero}>
        <View style={styles.pulseTopRow}>
          <View>
            <ThemedText style={styles.heroEyebrow}>市场脉搏</ThemedText>
            <View style={styles.scoreRow}>
              <ThemedText style={styles.pulseScore}>{pulse.score}</ThemedText>
              <View style={styles.pulseState}>
                <ThemedText style={styles.pulseStateText}>{pulse.state}</ThemedText>
              </View>
            </View>
          </View>
          <View style={styles.strongestBlock}>
            <ThemedText style={styles.heroEyebrow}>最强板块</ThemedText>
            <ThemedText numberOfLines={1} style={styles.strongestName}>
              {strongestSector?.name}
            </ThemedText>
            <ThemedText style={styles.strongestChange}>
              {strongestSector ? formatChange(strongestSector.changes[periodId]) : '--'}
            </ThemedText>
          </View>
        </View>
        <View style={styles.breadthTrack}>
          <View style={[styles.breadthFill, { width: `${pulse.score}%` }]} />
        </View>
        <View style={styles.breadthLabels}>
          <ThemedText style={styles.breadthText}>上涨 {pulse.advancing}</ThemedText>
          <ThemedText style={styles.breadthText}>下跌 {pulse.declining}</ThemedText>
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <View style={styles.sectionHeaderRow}>
          <View>
            <ThemedText style={styles.sectionTitle}>全球指数</ThemedText>
            <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>
              主要市场参照
            </ThemedText>
          </View>
          <PeriodControl
            colors={colors}
            onPeriodChange={onPeriodChange}
            periodId={periodId}
            periods={snapshot.periods}
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.indexBand}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {snapshot.indices.map((index) => (
            <View
              key={index.id}
              style={[styles.indexItem, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText numberOfLines={1} style={styles.indexName}>{index.name}</ThemedText>
              <ThemedText style={styles.indexClose}>{index.close.toFixed(2)}</ThemedText>
              <ThemedText style={{ color: index.change >= 0 ? CORAL : GREEN, fontSize: 12, fontWeight: '900', lineHeight: 18 }}>
                {formatChange(index.change)}
              </ThemedText>
              <ThemedText style={[styles.indexRegion, { color: colors.mutedText }]}>
                {index.region}
              </ThemedText>
            </View>
          ))}
        </ScrollView>
      </View>

      <View style={styles.sectionBlock}>
        <ThemedText style={styles.sectionTitle}>涨跌分布</ThemedText>
        <View style={styles.distributionRow}>
          {distribution.map((bucket) => (
            <View key={bucket.label} style={styles.distributionItem}>
              <View style={styles.distributionTrack}>
                <View
                  style={[
                    styles.distributionBar,
                    {
                      backgroundColor: bucket.color,
                      height: Math.max(4, Math.round((bucket.count / maxBucket) * 64)),
                    },
                  ]}
                />
              </View>
              <ThemedText style={styles.distributionCount}>{bucket.count}</ThemedText>
              <ThemedText style={[styles.distributionLabel, { color: colors.mutedText }]}>
                {bucket.label}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <ThemedText style={styles.sectionTitle}>板块速览</ThemedText>
        <View style={styles.overviewSectorGroup}>
          <ThemedText style={[styles.groupLabel, { color: colors.mutedText }]}>领涨</ThemedText>
          {strongest.map((sector) => (
            <SectorRow
              colors={colors}
              key={sector.id}
              onPress={() => onOpenSector(sector.id)}
              onToggleWatch={() => {}}
              periodId={periodId}
              sector={sector}
              showWatch={false}
              watched={false}
            />
          ))}
          <ThemedText style={[styles.groupLabel, { color: colors.mutedText }]}>领跌</ThemedText>
          {weakest.map((sector) => (
            <SectorRow
              colors={colors}
              key={sector.id}
              onPress={() => onOpenSector(sector.id)}
              onToggleWatch={() => {}}
              periodId={periodId}
              sector={sector}
              showWatch={false}
              watched={false}
            />
          ))}
        </View>
      </View>
    </>
  );
}

function SectorsView({
  categoryId,
  colors,
  onCategoryChange,
  onOpenSector,
  onPeriodChange,
  onSearchChange,
  onSortChange,
  onToggleWatch,
  periodId,
  rankedSectors,
  searchQuery,
  snapshot,
  sortKey,
  watchedIds,
}: {
  categoryId: MarketCategoryId;
  colors: ThemeColors;
  onCategoryChange: (category: MarketCategoryId) => void;
  onOpenSector: (sectorId: string) => void;
  onPeriodChange: (period: MarketPeriodId) => void;
  onSearchChange: (query: string) => void;
  onSortChange: (sort: MarketSortKey) => void;
  onToggleWatch: (sectorId: string) => void;
  periodId: MarketPeriodId;
  rankedSectors: MarketSector[];
  searchQuery: string;
  snapshot: MarketRadarSnapshot;
  sortKey: MarketSortKey;
  watchedIds: string[];
}) {
  return (
    <>
      <View style={styles.sectionBlock}>
        <ScrollView
          contentContainerStyle={styles.categoryChips}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {snapshot.categories.map((category) => {
            const selected = category.id === categoryId;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={category.id}
                onPress={() => onCategoryChange(category.id)}
                style={({ pressed }) => [
                  styles.categoryChip,
                  { backgroundColor: selected ? BLUE : colors.surfaceMuted },
                  pressed && styles.pressed,
                ]}>
                <MaterialCommunityIcons
                  name={CATEGORY_ICONS[category.id] ?? 'chart-line'}
                  size={15}
                  color={selected ? '#ffffff' : colors.mutedText}
                />
                <ThemedText style={[styles.categoryChipText, { color: selected ? '#ffffff' : colors.text }]}>
                  {category.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.rankingHeader}>
        <View style={styles.searchWrap}>
          <MaterialCommunityIcons name="magnify" size={17} color={colors.mutedText} />
          <TextInput
            accessibilityLabel="搜索板块"
            onChangeText={onSearchChange}
            placeholder="搜索板块"
            placeholderTextColor={colors.mutedText}
            style={[styles.searchInput, { color: colors.text }]}
            value={searchQuery}
          />
          {searchQuery ? (
            <Pressable accessibilityLabel="清空搜索" onPress={() => onSearchChange('')} hitSlop={8}>
              <MaterialCommunityIcons name="close-circle" size={16} color={colors.mutedText} />
            </Pressable>
          ) : null}
        </View>
        <PeriodControl
          colors={colors}
          onPeriodChange={onPeriodChange}
          periodId={periodId}
          periods={snapshot.periods}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.sortChips}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {SORT_OPTIONS.map((option) => {
          const selected = option.id === sortKey;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              key={option.id}
              onPress={() => onSortChange(option.id)}
              style={({ pressed }) => [
                styles.sortChip,
                { backgroundColor: selected ? colors.primarySoft : colors.surfaceMuted },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={[styles.sortChipText, { color: selected ? BLUE : colors.mutedText }]}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.sectorList}>
        {rankedSectors.length === 0 ? (
          <View style={styles.emptyBlock}>
            <MaterialCommunityIcons name="text-search" size={30} color={colors.mutedText} />
            <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
              没有匹配的板块
            </ThemedText>
          </View>
        ) : (
          rankedSectors.map((sector) => (
            <SectorRow
              colors={colors}
              key={sector.id}
              onPress={() => onOpenSector(sector.id)}
              onToggleWatch={() => onToggleWatch(sector.id)}
              periodId={periodId}
              sector={sector}
              showWatch
              watched={watchedIds.includes(sector.id)}
            />
          ))
        )}
      </View>
    </>
  );
}

function SignalsView({
  colors,
  isDark,
  onOpenSector,
  snapshot,
}: {
  colors: ThemeColors;
  isDark: boolean;
  onOpenSector: (sectorId: string) => void;
  snapshot: MarketRadarSnapshot;
}) {
  const entries = getSignalSectors(snapshot);
  const groups: MarketSignalType[] = ['leader', 'laggard', 'volume', 'reversal', 'breadth'];
  const hasSignals = entries.length > 0;

  return (
    <View style={styles.sectionBlock}>
      <View>
        <ThemedText style={styles.sectionTitle}>异动信号</ThemedText>
        <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>
          全部由行情快照确定性计算
        </ThemedText>
      </View>
      {!hasSignals ? (
        <View style={styles.emptyBlock}>
          <MaterialCommunityIcons name="pulse" size={30} color={colors.mutedText} />
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            暂无异动信号
          </ThemedText>
        </View>
      ) : (
        groups.map((type) => {
          const group = entries.filter((entry) => entry.signal.type === type);
          if (group.length === 0) return null;
          return (
            <View key={type} style={styles.sectionBlock}>
              <View style={styles.signalGroupHeader}>
                <MaterialCommunityIcons
                  name={SIGNAL_ICONS[type]}
                  size={16}
                  color={BLUE}
                />
                <ThemedText style={styles.signalGroupTitle}>{getSignalTypeLabel(type)}</ThemedText>
                <ThemedText style={[styles.signalGroupCount, { color: colors.mutedText }]}>
                  {group.length}
                </ThemedText>
              </View>
              {group.map(({ signal, sector }) => (
                <SignalRow
                  colors={colors}
                  isDark={isDark}
                  key={signal.id}
                  onPress={() => onOpenSector(sector.id)}
                  signal={signal}
                />
              ))}
            </View>
          );
        })
      )}
    </View>
  );
}

function WatchView({
  colors,
  onBrowse,
  onOpenSector,
  onToggleWatch,
  periodId,
  snapshot,
  watchedIds,
}: {
  colors: ThemeColors;
  onBrowse: () => void;
  onOpenSector: (sectorId: string) => void;
  onToggleWatch: (sectorId: string) => void;
  periodId: MarketPeriodId;
  snapshot: MarketRadarSnapshot;
  watchedIds: string[];
}) {
  const watched = getWatchSectorSummaries(snapshot, watchedIds);
  const sorted = watched.slice().sort(
    (left, right) => right.changes[periodId] - left.changes[periodId] || left.id.localeCompare(right.id),
  );

  return (
    <View style={styles.sectionBlock}>
      <View>
        <ThemedText style={styles.sectionTitle}>我的关注</ThemedText>
        <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>
          {watched.length > 0 ? `已关注 ${watched.length} 个板块` : '关注板块会保存在本机'}
        </ThemedText>
      </View>
      {sorted.length === 0 ? (
        <View style={styles.emptyBlock}>
          <MaterialCommunityIcons name="bookmark-plus-outline" size={30} color={colors.mutedText} />
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            还没有关注板块
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onBrowse}
            style={({ pressed }) => [
              styles.retryButton,
              { backgroundColor: BLUE },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={styles.retryButtonText}>去浏览板块</ThemedText>
          </Pressable>
        </View>
      ) : (
        sorted.map((sector) => (
          <SectorRow
            colors={colors}
            key={sector.id}
            onPress={() => onOpenSector(sector.id)}
            onToggleWatch={() => onToggleWatch(sector.id)}
            periodId={periodId}
            sector={sector}
            showWatch
            watched
          />
        ))
      )}
    </View>
  );
}

function SectorDetailBody({
  colors,
  detail,
  isDark,
  onOpenSector,
  periodId,
  snapshot,
}: {
  colors: ThemeColors;
  detail: MarketSectorDetail;
  isDark: boolean;
  onOpenSector: (sectorId: string) => void;
  periodId: MarketPeriodId;
  snapshot: MarketRadarSnapshot;
}) {
  const [constituentSort, setConstituentSort] = useState<'weight' | 'change' | 'amount'>('weight');
  const change = detail.changes[periodId];
  const trendColor = change >= 0 ? BLUE : GREEN;
  const indicatorRows = [
    { label: '最新收盘', value: detail.indicator.close.toFixed(2) },
    { label: '成交额', value: formatAmount(detail.indicator.amount) },
    { label: '换手率', value: `${detail.indicator.turnover.toFixed(2)}%` },
    {
      label: '上涨 / 下跌',
      value: `${detail.indicator.advancing} / ${detail.indicator.declining}`,
    },
    { label: '成分覆盖', value: `${detail.indicator.coverage} 只` },
  ];
  const constituents = detail.constituents.slice().sort((left, right) => {
    if (constituentSort === 'change') return right.change - left.change;
    if (constituentSort === 'amount') return (right.amount ?? 0) - (left.amount ?? 0);
    return right.weight - left.weight;
  });

  return (
    <>
      <View style={styles.detailMetricRow}>
        <View>
          <ThemedText style={[styles.detailChange, { color: change >= 0 ? CORAL : GREEN }]}>
            {formatChange(change)}
          </ThemedText>
          <ThemedText style={[styles.detailMetricCaption, { color: colors.mutedText }]}>
            东方财富公开行情 · 延迟数据
          </ThemedText>
        </View>
        <View style={[styles.periodPill, { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.periodPillText, { color: BLUE }]}>
            {getPeriodLabel(snapshot, periodId)}相对强弱
          </ThemedText>
        </View>
      </View>

      <View style={styles.trendBlock}>
        <MarketTrendChart color={trendColor} gridColor={colors.line} values={detail.series} />
        <View style={styles.chartAxisLabels}>
          <ThemedText style={[styles.axisText, { color: colors.mutedText }]}>起点</ThemedText>
          <ThemedText style={[styles.axisText, { color: colors.mutedText }]}>当前</ThemedText>
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <ThemedText style={styles.sectionTitle}>行情指标</ThemedText>
        <View style={styles.indicatorList}>
          {indicatorRows.map((row) => (
            <View key={row.label} style={styles.indicatorRow}>
              <ThemedText style={[styles.indicatorLabel, { color: colors.mutedText }]}>
                {row.label}
              </ThemedText>
              <ThemedText style={styles.indicatorValue}>{row.value}</ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.sectionBlock}>
        <View style={styles.detailSubHeader}>
          <ThemedText style={styles.sectionTitle}>成分股</ThemedText>
          <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>
            共 {detail.constituents.length} 只
          </ThemedText>
        </View>
        <ScrollView
          contentContainerStyle={styles.sortChips}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {([
            ['weight', '市值'],
            ['change', '涨跌幅'],
            ['amount', '成交额'],
          ] as const).map(([id, label]) => {
            const selected = constituentSort === id;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                key={id}
                onPress={() => setConstituentSort(id)}
                style={({ pressed }) => [
                  styles.sortChip,
                  { backgroundColor: selected ? colors.primarySoft : colors.surfaceMuted },
                  pressed && styles.pressed,
                ]}>
                <ThemedText style={[styles.sortChipText, { color: selected ? BLUE : colors.mutedText }]}>
                  {label}
                </ThemedText>
              </Pressable>
            );
          })}
        </ScrollView>
        <View style={styles.tableHeader}>
          <ThemedText style={[styles.tableHeaderText, { color: colors.mutedText }]}>标的</ThemedText>
          <ThemedText style={[styles.tableHeaderText, styles.tableNumber, { color: colors.mutedText }]}>权重</ThemedText>
          <ThemedText style={[styles.tableHeaderText, styles.tableNumber, { color: colors.mutedText }]}>涨跌</ThemedText>
        </View>
        {constituents.slice(0, 50).map((constituent) => (
          <View
            key={`${constituent.code}-${constituent.name}`}
            style={[styles.constituentRow, { borderBottomColor: colors.line }]}>
            <View style={styles.constituentIdentity}>
              <ThemedText style={styles.constituentName}>{constituent.name}</ThemedText>
              <ThemedText style={[styles.constituentCode, { color: colors.mutedText }]}>
                {constituent.code}
              </ThemedText>
            </View>
            <ThemedText style={[styles.constituentNumber, { color: colors.mutedText }]}>
              {constituent.weight}%
            </ThemedText>
            <ThemedText
              style={[
                styles.constituentNumber,
                { color: constituent.change >= 0 ? CORAL : GREEN },
              ]}>
              {formatChange(constituent.change)}
            </ThemedText>
          </View>
        ))}
      </View>

      {detail.related.length > 0 ? (
        <View style={styles.sectionBlock}>
          <ThemedText style={styles.sectionTitle}>关联板块</ThemedText>
          {detail.related.map((related) => (
            <Pressable
              accessibilityLabel={`查看${related.name}`}
              accessibilityRole="button"
              key={related.id}
              onPress={() => onOpenSector(related.id)}
              style={({ pressed }) => [
                styles.relatedRow,
                { borderBottomColor: colors.line },
                pressed && styles.pressed,
              ]}>
              <ThemedText style={styles.relatedName}>{related.name}</ThemedText>
              <ThemedText style={[styles.relatedScore, { color: colors.mutedText }]}>
                相关性 {related.score.toFixed(1)}%
              </ThemedText>
              <MaterialCommunityIcons name="chevron-right" size={20} color={colors.mutedText} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {detail.news.length > 0 ? (
        <View style={styles.sectionBlock}>
          <ThemedText style={styles.sectionTitle}>板块资讯</ThemedText>
          {detail.news.map((item) => (
            <Pressable
              accessibilityLabel={item.title}
              accessibilityRole="link"
              key={item.id}
              onPress={() => openNewsSource(item.sources[0]?.url, item.title)}
              style={({ pressed }) => [
                styles.newsRow,
                { borderBottomColor: colors.line },
                pressed && styles.pressed,
              ]}>
              <View style={styles.newsIcon}>
                <MaterialCommunityIcons name="newspaper-variant-outline" size={16} color="#ffffff" />
              </View>
              <View style={styles.newsCopy}>
                <ThemedText numberOfLines={2} style={styles.newsTitle}>{item.title}</ThemedText>
                <ThemedText style={[styles.newsMeta, { color: colors.mutedText }]}>
                  {item.summary.oneSentence || item.sources[0]?.name || '原文链接'}
                </ThemedText>
              </View>
              <MaterialCommunityIcons name="open-in-new" size={16} color={colors.mutedText} />
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.methodBlock}>
        <View style={styles.methodHeading}>
          <MaterialCommunityIcons name="information-outline" size={18} color={BLUE} />
          <ThemedText style={styles.methodTitle}>计算口径</ThemedText>
        </View>
        <ThemedText style={[styles.methodText, { color: colors.mutedText }]}>
          {detail.methodology}
        </ThemedText>
      </View>
    </>
  );
}

function DetailHeader({
  colors,
  isDark,
  onBack,
  onToggleWatch,
  periodLabel,
  sector,
  watched,
}: {
  colors: ThemeColors;
  isDark: boolean;
  onBack: () => void;
  onToggleWatch: () => void;
  periodLabel: string;
  sector: MarketSector;
  watched: boolean;
}) {
  return (
    <View style={[styles.detailHeader, { borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityLabel="返回市场总览"
        accessibilityRole="button"
        hitSlop={10}
        onPress={onBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chevron-left" size={30} color={colors.text} />
      </Pressable>
      <View style={styles.detailTitleWrap}>
        <ThemedText numberOfLines={1} style={styles.detailHeaderTitle}>
          {sector.name}
        </ThemedText>
        <ThemedText style={[styles.headerCaption, { color: colors.mutedText }]}>
          {periodLabel}表现
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel={watched ? '取消关注板块' : '加入关注板块'}
        accessibilityRole="button"
        accessibilityState={{ selected: watched }}
        onPress={onToggleWatch}
        style={({ pressed }) => [
          styles.headerWatchButton,
          { backgroundColor: watched ? colors.primarySoft : colors.surfaceMuted },
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons
          name={watched ? 'bookmark-check' : 'bookmark-plus-outline'}
          size={16}
          color={BLUE}
        />
        <ThemedText style={[styles.headerWatchText, { color: BLUE }]}>
          {watched ? '已关注' : '关注'}
        </ThemedText>
      </Pressable>
    </View>
  );
}

function ViewTabs({
  activeView,
  colors,
  onChange,
}: {
  activeView: MarketView;
  colors: ThemeColors;
  onChange: (view: MarketView) => void;
}) {
  return (
    <View style={[styles.viewTabs, { backgroundColor: colors.surfaceMuted }]}>
      {VIEW_TABS.map((tab) => {
        const selected = tab.id === activeView;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={({ pressed }) => [
              styles.viewTab,
              selected && { backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}>
            <MaterialCommunityIcons
              name={tab.icon}
              size={17}
              color={selected ? BLUE : colors.mutedText}
            />
            <ThemedText style={[styles.viewTabText, { color: selected ? BLUE : colors.mutedText }]}>
              {tab.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function PeriodControl({
  colors,
  onPeriodChange,
  periodId,
  periods,
}: {
  colors: ThemeColors;
  onPeriodChange: (period: MarketPeriodId) => void;
  periodId: MarketPeriodId;
  periods: readonly { id: MarketPeriodId; label: string }[];
}) {
  return (
    <View style={[styles.periodControl, { backgroundColor: colors.surfaceMuted }]}>
      {periods.map((period) => {
        const selected = period.id === periodId;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={period.id}
            onPress={() => onPeriodChange(period.id)}
            style={({ pressed }) => [
              styles.periodItem,
              selected && { backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}>
            <ThemedText
              style={[
                styles.periodLabel,
                { color: selected ? BLUE : colors.mutedText },
              ]}>
              {period.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectorRow({
  colors,
  onPress,
  onToggleWatch,
  periodId,
  sector,
  showWatch,
  watched,
}: {
  colors: ThemeColors;
  onPress: () => void;
  onToggleWatch: () => void;
  periodId: MarketPeriodId;
  sector: MarketSector;
  showWatch: boolean;
  watched: boolean;
}) {
  const change = sector.changes[periodId];
  const positive = change >= 0;
  const primaryCategory = sector.categoryIds.find((id) => id !== 'market') ?? 'market';

  return (
    <View style={[styles.sectorRowShell, { borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityLabel={`查看${sector.name}板块详情，${formatChange(change)}`}
        accessibilityRole="button"
        onPress={onPress}
        style={({ pressed }) => [
          styles.sectorRow,
          showWatch && styles.sectorRowWithWatch,
          pressed && styles.pressed,
        ]}>
        <View style={[styles.sectorIcon, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons
            name={SECTOR_ICONS[sector.id] ?? CATEGORY_ICONS[primaryCategory] ?? 'chart-line'}
            size={20}
            color={BLUE}
          />
        </View>
        <View style={styles.sectorMiddle}>
          <ThemedText numberOfLines={1} style={styles.sectorName}>
            {sector.name}
          </ThemedText>
          <ThemedText style={[styles.sectorMeta, { color: colors.mutedText }]}>
            成交 {formatAmount(sector.indicator.amount)} · 换手 {sector.indicator.turnover.toFixed(2)}%
          </ThemedText>
        </View>
        <MarketSparkline color={positive ? BLUE : GREEN} values={sector.series.slice(-7)} />
        <View style={styles.changeWrap}>
          <MaterialCommunityIcons
            name={positive ? 'triangle-small-up' : 'triangle-small-down'}
            size={24}
            color={positive ? CORAL : GREEN}
          />
          <ThemedText style={[styles.sectorChange, { color: positive ? CORAL : GREEN }]}>
            {formatChange(change)}
          </ThemedText>
        </View>
      </Pressable>
      {showWatch ? (
        <Pressable
          accessibilityLabel={watched ? `取消关注${sector.name}` : `关注${sector.name}`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={onToggleWatch}
          style={({ pressed }) => [styles.rowWatchOverlay, pressed && styles.pressed]}>
          <MaterialCommunityIcons
            name={watched ? 'bookmark-check' : 'bookmark-plus-outline'}
            size={17}
            color={watched ? BLUE : colors.mutedText}
          />
        </Pressable>
      ) : null}
    </View>
  );
}

function SignalRow({
  colors,
  isDark,
  onPress,
  signal,
}: {
  colors: ThemeColors;
  isDark: boolean;
  onPress: () => void;
  signal: MarketSignal;
}) {
  return (
    <Pressable
      accessibilityLabel={`查看${signal.description}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.signalBlock,
        { backgroundColor: isDark ? '#33212b' : '#fff1f4' },
        pressed && styles.pressed,
      ]}>
      <View style={styles.signalIcon}>
        <MaterialCommunityIcons name={SIGNAL_ICONS[signal.type]} size={20} color="#ffffff" />
      </View>
      <View style={styles.signalCopy}>
        <ThemedText style={styles.signalTitle}>{getSignalTypeLabel(signal.type)}</ThemedText>
        <ThemedText style={[styles.signalText, { color: colors.mutedText }]}>
          {signal.description}
        </ThemedText>
      </View>
      <MaterialCommunityIcons name="chevron-right" size={22} color={colors.mutedText} />
    </Pressable>
  );
}

function ToolBottomNavigation() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const items: { icon: IconName; label: string; onPress: () => void; selected?: boolean }[] = [
    { icon: 'home-outline', label: '首页', onPress: () => router.replace('/') },
    { icon: 'view-grid', label: '工具', onPress: () => router.replace('/tools'), selected: true },
    { icon: 'message-outline', label: '消息', onPress: () => router.replace('/messages') },
    { icon: 'account-circle-outline', label: '我的', onPress: () => router.replace('/profile') },
  ];

  return (
    <View style={[styles.bottomNav, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
      {items.map((item) => {
        const color = item.selected ? BLUE : colors.tabInactive;
        return (
          <Pressable
            accessibilityLabel={item.label}
            accessibilityRole="tab"
            accessibilityState={{ selected: Boolean(item.selected) }}
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressed]}>
            <MaterialCommunityIcons name={item.icon} size={22} color={color} />
            <ThemedText style={[styles.bottomNavLabel, { color }]}>{item.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function buildBreadthDistribution(
  sectors: MarketSector[],
  periodId: MarketPeriodId,
) {
  const buckets = [
    { label: '≥5%', from: 5, to: Infinity, color: CORAL },
    { label: '0-5%', from: 0, to: 5, color: BLUE },
    { label: '-5-0%', from: -5, to: 0, color: GREEN },
    { label: '<-5%', from: -Infinity, to: -5, color: '#6b768c' },
  ];
  return buckets.map((bucket) => ({
    ...bucket,
    count: sectors.filter((sector) => {
      const change = sector.changes[periodId];
      return change >= bucket.from && change < bucket.to;
    }).length,
  }));
}

function getPeriodLabel(snapshot: MarketRadarSnapshot, periodId: MarketPeriodId) {
  return snapshot.periods.find((period) => period.id === periodId)?.label ?? '1日';
}

function openNewsSource(url: string | undefined, title: string) {
  if (!url) return;
  Linking.openURL(url).catch(() => {
    // Keep the app usable when a news source link is unavailable.
  });
}

function formatChange(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatAmount(value: number) {
  if (value >= 1000000000000) return `${(value / 1000000000000).toFixed(2)}万亿`;
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return value.toFixed(0);
}

function formatFetchedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  stateContainer: {
    alignItems: 'center',
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  stateTitle: { fontSize: 18, fontWeight: '900', lineHeight: 26 },
  stateText: { fontSize: 12, fontWeight: '600', lineHeight: 18, textAlign: 'center' },
  retryButton: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    marginTop: 4,
    minHeight: 44,
    paddingHorizontal: 18,
  },
  retryButtonText: { color: '#ffffff', fontSize: 13, fontWeight: '900', lineHeight: 18 },
  screenShell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: appLayout.screenMaxWidth,
    overflow: 'hidden',
    width: '100%',
  },
  overviewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 10,
    paddingTop: 12,
  },
  overviewTitle: { fontSize: 24, fontWeight: '900', lineHeight: 32 },
  headerCaption: { fontSize: 11, fontWeight: '700', lineHeight: 16, marginTop: 1 },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  overviewContent: { gap: 18, paddingBottom: 24, paddingHorizontal: 16 },
  errorBanner: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  errorBannerText: { flex: 1, fontSize: 11, fontWeight: '700', lineHeight: 17 },
  pulseHero: { backgroundColor: HERO, borderRadius: 16, gap: 12, padding: 18 },
  pulseTopRow: { flexDirection: 'row', justifyContent: 'space-between' },
  heroEyebrow: { color: '#aeb8d5', fontSize: 11, fontWeight: '700', lineHeight: 16 },
  scoreRow: { alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 2 },
  pulseScore: { color: '#ffffff', fontSize: 48, fontWeight: '900', lineHeight: 58 },
  pulseState: { backgroundColor: LIME, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 6 },
  pulseStateText: { color: HERO, fontSize: 11, fontWeight: '900', lineHeight: 14 },
  strongestBlock: { alignItems: 'flex-end', flexShrink: 1, maxWidth: 150 },
  strongestName: { color: '#ffffff', fontSize: 20, fontWeight: '900', lineHeight: 28, marginTop: 4 },
  strongestChange: { color: CORAL, fontSize: 13, fontWeight: '900', lineHeight: 20 },
  breadthTrack: { backgroundColor: '#30395f', borderRadius: 4, height: 7, overflow: 'hidden' },
  breadthFill: { backgroundColor: LIME, borderRadius: 4, height: 7 },
  breadthLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  breadthText: { color: '#d9def0', fontSize: 11, fontWeight: '700', lineHeight: 16 },
  sectionBlock: { gap: 10 },
  sectionHeaderRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 18, fontWeight: '900', lineHeight: 26 },
  sectionCaption: { fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: 2 },
  indexBand: { gap: 9, paddingBottom: 2, paddingTop: 2 },
  indexItem: {
    borderRadius: 8,
    minWidth: 128,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  indexName: { fontSize: 12, fontWeight: '800', lineHeight: 17 },
  indexClose: { fontSize: 16, fontWeight: '900', lineHeight: 22, marginTop: 3 },
  indexRegion: { fontSize: 9, fontWeight: '600', lineHeight: 13, marginTop: 3 },
  distributionRow: { flexDirection: 'row', gap: 8 },
  distributionItem: { alignItems: 'center', flex: 1 },
  distributionTrack: {
    alignItems: 'flex-end',
    backgroundColor: '#e9eefb',
    borderRadius: 4,
    height: 72,
    justifyContent: 'flex-end',
    overflow: 'hidden',
    width: '100%',
  },
  distributionBar: { borderRadius: 4, minWidth: 18, width: '60%' },
  distributionCount: { fontSize: 12, fontWeight: '900', lineHeight: 17, marginTop: 6 },
  distributionLabel: { fontSize: 9, fontWeight: '600', lineHeight: 13 },
  overviewSectorGroup: { gap: 0 },
  groupLabel: { fontSize: 11, fontWeight: '800', lineHeight: 17, marginBottom: 2, marginTop: 8 },
  viewTabs: {
    borderRadius: 9,
    flexDirection: 'row',
    marginBottom: 14,
    marginHorizontal: 16,
    padding: 4,
  },
  viewTab: {
    alignItems: 'center',
    borderRadius: 7,
    flex: 1,
    flexDirection: 'row',
    gap: 5,
    justifyContent: 'center',
    minHeight: 38,
  },
  viewTabText: { fontSize: 11, fontWeight: '800', lineHeight: 15 },
  categoryChips: { gap: 8, paddingVertical: 2 },
  categoryChip: {
    alignItems: 'center',
    borderRadius: 16,
    flexDirection: 'row',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 13,
  },
  categoryChipText: { fontSize: 12, fontWeight: '800', lineHeight: 16 },
  rankingHeader: { alignItems: 'center', flexDirection: 'row', gap: 10, justifyContent: 'space-between' },
  searchWrap: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    minHeight: 40,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 18, paddingVertical: 8 },
  periodControl: { borderRadius: 8, flexDirection: 'row', padding: 3 },
  periodItem: { alignItems: 'center', borderRadius: 6, minWidth: 50, paddingHorizontal: 8, paddingVertical: 7 },
  periodLabel: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  sortChips: { gap: 8, paddingVertical: 2 },
  sortChip: {
    alignItems: 'center',
    borderRadius: 14,
    minHeight: 30,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  sortChipText: { fontSize: 11, fontWeight: '800', lineHeight: 15 },
  sectorList: { gap: 0 },
  sectorRowShell: { borderBottomWidth: 1, position: 'relative' },
  sectorRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 64,
    paddingVertical: 8,
  },
  sectorRowWithWatch: { paddingRight: 34 },
  sectorIcon: { alignItems: 'center', borderRadius: 8, height: 36, justifyContent: 'center', width: 36 },
  sectorMiddle: { flex: 1, marginLeft: 10, minWidth: 0 },
  sectorName: { fontSize: 14, fontWeight: '800', lineHeight: 20 },
  sectorMeta: { fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: 2 },
  changeWrap: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginLeft: 7,
    width: 90,
  },
  sectorChange: { fontSize: 13, fontWeight: '900', lineHeight: 20 },
  rowWatchOverlay: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    position: 'absolute',
    right: 2,
    top: 0,
    width: 30,
    zIndex: 1,
  },
  emptyBlock: {
    alignItems: 'center',
    gap: 10,
    justifyContent: 'center',
    minHeight: 160,
    paddingHorizontal: 20,
  },
  emptyText: { fontSize: 12, fontWeight: '700', lineHeight: 18, textAlign: 'center' },
  signalGroupHeader: { alignItems: 'center', flexDirection: 'row', gap: 7, marginTop: 4 },
  signalGroupTitle: { fontSize: 14, fontWeight: '900', lineHeight: 20 },
  signalGroupCount: { fontSize: 11, fontWeight: '800', lineHeight: 16 },
  signalBlock: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 11, padding: 14 },
  signalIcon: { alignItems: 'center', backgroundColor: '#ff6b8f', borderRadius: 16, height: 32, justifyContent: 'center', width: 32 },
  signalCopy: { flex: 1 },
  signalTitle: { fontSize: 13, fontWeight: '900', lineHeight: 19 },
  signalText: { fontSize: 11, fontWeight: '600', lineHeight: 17 },
  sourceLine: { alignItems: 'center', flexDirection: 'row', gap: 6, justifyContent: 'center' },
  sourceText: { fontSize: 10, fontWeight: '600', lineHeight: 15 },
  disclaimer: { fontSize: 9, fontWeight: '600', lineHeight: 14, textAlign: 'center' },
  detailHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 68,
    paddingHorizontal: 12,
  },
  iconButton: { alignItems: 'center', height: 44, justifyContent: 'center', width: 40 },
  detailTitleWrap: { flex: 1, marginLeft: 2 },
  detailHeaderTitle: { fontSize: 21, fontWeight: '900', lineHeight: 28 },
  headerWatchButton: { alignItems: 'center', borderRadius: 16, flexDirection: 'row', gap: 4, paddingHorizontal: 11, paddingVertical: 8 },
  headerWatchText: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  detailContent: { gap: 22, paddingBottom: 28, paddingHorizontal: 20, paddingTop: 20 },
  detailLoading: { alignItems: 'center', gap: 12, justifyContent: 'center', minHeight: 260 },
  detailMetricRow: { alignItems: 'flex-start', flexDirection: 'row', justifyContent: 'space-between' },
  detailChange: { fontSize: 36, fontWeight: '900', lineHeight: 44 },
  detailMetricCaption: { fontSize: 10, fontWeight: '600', lineHeight: 15 },
  periodPill: { borderRadius: 15, marginTop: 8, paddingHorizontal: 12, paddingVertical: 7 },
  periodPillText: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  trendBlock: { gap: 5 },
  chartAxisLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  axisText: { fontSize: 9, fontWeight: '600', lineHeight: 13 },
  indicatorList: { gap: 12 },
  indicatorRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 34,
  },
  indicatorLabel: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 18 },
  indicatorValue: { fontSize: 13, fontWeight: '900', lineHeight: 18, textAlign: 'right' },
  detailSubHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  tableHeader: { flexDirection: 'row', paddingBottom: 6 },
  tableHeaderText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 14 },
  tableNumber: { textAlign: 'right' },
  constituentRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 43 },
  constituentIdentity: { flex: 1 },
  constituentName: { fontSize: 12, fontWeight: '800', lineHeight: 18 },
  constituentCode: { fontSize: 9, fontWeight: '600', lineHeight: 13, marginTop: 1 },
  constituentNumber: { flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 18, textAlign: 'right' },
  relatedRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 44 },
  relatedName: { flex: 1, fontSize: 13, fontWeight: '800', lineHeight: 19 },
  relatedScore: { fontSize: 10, fontWeight: '700', lineHeight: 15, marginRight: 8 },
  newsRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 10, minHeight: 58 },
  newsIcon: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 14, height: 28, justifyContent: 'center', width: 28 },
  newsCopy: { flex: 1 },
  newsTitle: { fontSize: 12, fontWeight: '800', lineHeight: 17 },
  newsMeta: { fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: 3 },
  methodBlock: { gap: 7 },
  methodHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  methodTitle: { fontSize: 14, fontWeight: '900', lineHeight: 20 },
  methodText: { fontSize: 11, fontWeight: '600', lineHeight: 18 },
  bottomNav: { borderTopWidth: 1, flexDirection: 'row', minHeight: 70, paddingBottom: 4, paddingTop: 8 },
  bottomNavItem: { alignItems: 'center', flex: 1, gap: 3, justifyContent: 'center' },
  bottomNavLabel: { fontSize: 10, fontWeight: '700', lineHeight: 14 },
  pressed: { opacity: 0.72 },
});
