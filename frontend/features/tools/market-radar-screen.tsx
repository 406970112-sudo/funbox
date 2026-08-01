import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { MarketSparkline, MarketTrendChart } from '@/features/tools/market-radar-chart';
import { useAppTheme } from '@/hooks/use-app-theme';
import { getMarketPulse, getMarketSector, getRankedMarketSectors } from '@/lib/market-radar';
import {
  fetchMarketRadarSnapshot,
  getMarketRadarErrorMessage,
} from '@/lib/market-radar-api';
import type {
  MarketCategoryId,
  MarketPeriodId,
  MarketRadarSnapshot,
  MarketSector,
} from '@/types/market-radar';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff5d6c';
const GREEN = '#24b36b';

const SECTOR_ICONS: Record<string, IconName> = {
  BK1134: 'brain',
  BK1128: 'lightbulb-on-outline',
  BK1127: 'memory',
  BK0800: 'robot-outline',
  BK0579: 'cloud-outline',
  BK0732: 'medal-outline',
  BK1615: 'circle-outline',
  BK1613: 'circle-multiple-outline',
  BK1626: 'magnet-on',
  BK0479: 'shield-outline',
};

export function MarketRadarScreen() {
  const { colorScheme, colors } = useAppTheme();
  const [categoryId, setCategoryId] = useState<MarketCategoryId>('global');
  const [periodId, setPeriodId] = useState<MarketPeriodId>('1d');
  const [selectedSectorId, setSelectedSectorId] = useState<string | null>(null);
  const [watchedSectorIds, setWatchedSectorIds] = useState<Set<string>>(() => new Set());
  const [snapshot, setSnapshot] = useState<MarketRadarSnapshot | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const detailScrollRef = useRef<ScrollView>(null);
  const overviewScrollRef = useRef<ScrollView>(null);

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
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const activeScrollView = selectedSectorId ? detailScrollRef.current : overviewScrollRef.current;
    activeScrollView?.scrollTo({ animated: false, y: 0 });
    if (typeof window !== 'undefined') window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [selectedSectorId]);

  function toggleWatch(sectorId: string) {
    setWatchedSectorIds((current) => {
      const next = new Set(current);
      if (next.has(sectorId)) next.delete(sectorId);
      else next.add(sectorId);
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
      .then((next) => setSnapshot(next))
      .catch((error) => setLoadError(getMarketRadarErrorMessage(error)))
      .finally(() => setIsLoading(false));
  }

  if (!snapshot) {
    const isDark = colorScheme === 'dark';
    const pageSurface = isDark ? colors.surface : '#f8faff';
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
          <View style={styles.stateContainer}>
            {isLoading ? (
              <>
                <ActivityIndicator color={BLUE} size="large" />
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                  正在加载行情
                </ThemedText>
              </>
            ) : (
              <>
                <MaterialCommunityIcons name="database-alert-outline" size={38} color={CORAL} />
                <ThemedText style={styles.stateTitle}>行情加载失败</ThemedText>
                <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
                  {loadError}
                </ThemedText>
                <Pressable
                  accessibilityLabel="重试加载市场雷达"
                  accessibilityRole="button"
                  onPress={retry}
                  style={({ pressed }) => [
                    styles.retryButton,
                    { backgroundColor: BLUE },
                    pressed && styles.pressed,
                  ]}>
                  <MaterialCommunityIcons name="refresh" size={18} color="#ffffff" />
                  <ThemedText style={styles.retryButtonText}>重试</ThemedText>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  const selectedSector = selectedSectorId ? getMarketSector(snapshot, selectedSectorId) : undefined;
  const rankedSectors = getRankedMarketSectors(snapshot, categoryId, periodId);
  const pulse = getMarketPulse(snapshot, categoryId, periodId);
  const strongestSector = pulse.strongestSectorId
    ? getMarketSector(snapshot, pulse.strongestSectorId)
    : undefined;
  const selectedPeriod =
    snapshot.periods.find((period) => period.id === periodId) ?? snapshot.periods[0];
  const isDark = colorScheme === 'dark';
  const pageSurface = isDark ? colors.surface : '#f8faff';
  const snapshotStatus = isRefreshing
    ? '正在刷新'
    : snapshot.stale
      ? '缓存行情'
      : `${formatFetchedAt(snapshot.fetchedAt)} 更新`;

  if (selectedSector) {
    const watched = watchedSectorIds.has(selectedSector.id);
    const change = selectedSector.changes[periodId];
    const trendColor = change >= 0 ? BLUE : GREEN;
    const indicatorRows = [
      { label: '最新收盘', value: selectedSector.indicator.close.toFixed(2) },
      { label: '成交额', value: formatAmount(selectedSector.indicator.amount) },
      { label: '换手率', value: `${selectedSector.indicator.turnover.toFixed(2)}%` },
      {
        label: '上涨 / 下跌',
        value: `${selectedSector.indicator.advancing} / ${selectedSector.indicator.declining}`,
      },
      { label: '成分覆盖', value: `${selectedSector.indicator.coverage} 只` },
    ];

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
          <View style={[styles.detailHeader, { borderBottomColor: colors.line }]}>
            <Pressable
              accessibilityLabel="返回市场总览"
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setSelectedSectorId(null)}
              style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
              <MaterialCommunityIcons name="chevron-left" size={30} color={colors.text} />
            </Pressable>
            <View style={styles.detailTitleWrap}>
              <ThemedText numberOfLines={1} style={styles.detailHeaderTitle}>
                {selectedSector.name}
              </ThemedText>
              <ThemedText style={[styles.headerCaption, { color: colors.mutedText }]}>
                {selectedPeriod.label}表现
              </ThemedText>
            </View>
            <Pressable
              accessibilityLabel={watched ? '取消关注板块' : '加入关注板块'}
              accessibilityRole="button"
              accessibilityState={{ selected: watched }}
              onPress={() => toggleWatch(selectedSector.id)}
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

          <ScrollView
            contentContainerStyle={styles.detailContent}
            key="market-radar-detail"
            ref={detailScrollRef}
            showsVerticalScrollIndicator={false}>
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
                  {selectedPeriod.label}相对强弱
                </ThemedText>
              </View>
            </View>

            <View style={styles.trendBlock}>
              <MarketTrendChart color={trendColor} gridColor={colors.line} values={selectedSector.series} />
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
              <ThemedText style={styles.sectionTitle}>代表标的与权重</ThemedText>
              <View style={styles.tableHeader}>
                <ThemedText style={[styles.tableHeaderText, { color: colors.mutedText }]}>标的</ThemedText>
                <ThemedText style={[styles.tableHeaderText, styles.tableNumber, { color: colors.mutedText }]}>权重</ThemedText>
                <ThemedText style={[styles.tableHeaderText, styles.tableNumber, { color: colors.mutedText }]}>涨跌</ThemedText>
              </View>
              {selectedSector.constituents.map((constituent) => (
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

            <View style={styles.methodBlock}>
              <View style={styles.methodHeading}>
                <MaterialCommunityIcons name="information-outline" size={18} color={BLUE} />
                <ThemedText style={styles.methodTitle}>计算口径</ThemedText>
              </View>
              <ThemedText style={[styles.methodText, { color: colors.mutedText }]}>
                {selectedSector.methodology}
              </ThemedText>
            </View>

            <Pressable
              accessibilityLabel={watched ? '取消关注板块' : '加入关注板块'}
              accessibilityRole="button"
              onPress={() => toggleWatch(selectedSector.id)}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: watched ? colors.surfaceMuted : BLUE },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons
                name={watched ? 'bookmark-check' : 'bookmark-plus-outline'}
                size={20}
                color={watched ? BLUE : '#ffffff'}
              />
              <ThemedText style={[styles.primaryButtonText, { color: watched ? BLUE : '#ffffff' }]}>
                {watched ? '已加入关注' : '加入关注'}
              </ThemedText>
            </Pressable>
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

  const anomalySector = rankedSectors.find((sector) => sector.anomaly) ?? rankedSectors[0];
  const anomalyText = anomalySector
    ? anomalySector.anomaly ?? `${anomalySector.name}在当前周期排名第 1`
    : '暂无异动信号';

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

        <ScrollView
          contentContainerStyle={styles.overviewContent}
          key="market-radar-overview"
          ref={overviewScrollRef}
          showsVerticalScrollIndicator={false}>
          {loadError ? (
            <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
              <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>
                {loadError}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.pulseHero}>
            <View style={styles.pulseTopRow}>
              <View>
                <ThemedText style={styles.heroEyebrow}>今日脉搏</ThemedText>
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

          <View style={[styles.segmentedControl, { backgroundColor: colors.surfaceMuted }]}>
            {snapshot.categories.map((category) => {
              const selected = category.id === categoryId;
              return (
                <Pressable
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={category.id}
                  onPress={() => setCategoryId(category.id)}
                  style={({ pressed }) => [
                    styles.segmentedItem,
                    selected && { backgroundColor: colors.surface },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText
                    style={[
                      styles.segmentedLabel,
                      { color: selected ? colors.text : colors.mutedText },
                    ]}>
                    {category.label}
                  </ThemedText>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.rankingHeader}>
            <View>
              <ThemedText style={styles.sectionTitle}>板块强弱</ThemedText>
              <ThemedText style={[styles.rankingCaption, { color: colors.mutedText }]}>
                按涨跌幅排序
              </ThemedText>
            </View>
            <View style={[styles.periodControl, { backgroundColor: colors.surfaceMuted }]}>
              {snapshot.periods.map((period) => {
                const selected = period.id === periodId;
                return (
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected }}
                    key={period.id}
                    onPress={() => setPeriodId(period.id)}
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
          </View>

          <View style={styles.sectorList}>
            {rankedSectors.slice(0, 5).map((sector) => (
              <SectorRow
                colors={{ line: colors.line, mutedText: colors.mutedText, surfaceMuted: colors.surfaceMuted }}
                key={sector.id}
                onPress={() => setSelectedSectorId(sector.id)}
                periodId={periodId}
                sector={sector}
              />
            ))}
          </View>

          <View style={styles.sectionBlock}>
            <ThemedText style={styles.sectionTitle}>异动信号</ThemedText>
            {anomalySector ? (
              <Pressable
                accessibilityLabel={`查看${anomalySector.name}详情`}
                accessibilityRole="button"
                onPress={() => setSelectedSectorId(anomalySector.id)}
                style={({ pressed }) => [
                  styles.signalBlock,
                  { backgroundColor: isDark ? '#33212b' : '#fff1f4' },
                  pressed && styles.pressed,
                ]}>
                <View style={styles.signalIcon}>
                  <MaterialCommunityIcons name="pulse" size={20} color="#ffffff" />
                </View>
                <View style={styles.signalCopy}>
                  <ThemedText style={styles.signalTitle}>{anomalySector.name}</ThemedText>
                  <ThemedText style={[styles.signalText, { color: colors.mutedText }]}>
                    {anomalyText}
                  </ThemedText>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={colors.mutedText} />
              </Pressable>
            ) : null}
          </View>

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

function SectorRow({
  colors,
  onPress,
  periodId,
  sector,
}: {
  colors: { line: string; mutedText: string; surfaceMuted: string };
  onPress: () => void;
  periodId: MarketPeriodId;
  sector: MarketSector;
}) {
  const change = sector.changes[periodId];
  const positive = change >= 0;

  return (
    <Pressable
      accessibilityLabel={`查看${sector.name}板块详情，${formatChange(change)}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.sectorRow,
        { borderBottomColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <View style={[styles.sectorIcon, { backgroundColor: colors.surfaceMuted }]}>
        <MaterialCommunityIcons name={SECTOR_ICONS[sector.id] ?? 'chart-line'} size={20} color={BLUE} />
      </View>
      <ThemedText numberOfLines={1} style={styles.sectorName}>
        {sector.name}
      </ThemedText>
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
    paddingBottom: 12,
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
  segmentedControl: { borderRadius: 9, flexDirection: 'row', padding: 4 },
  segmentedItem: { alignItems: 'center', borderRadius: 7, flex: 1, paddingVertical: 9 },
  segmentedLabel: { fontSize: 12, fontWeight: '800', lineHeight: 16 },
  rankingHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontWeight: '900', lineHeight: 26 },
  rankingCaption: { fontSize: 10, fontWeight: '600', lineHeight: 15 },
  periodControl: { borderRadius: 8, flexDirection: 'row', padding: 3 },
  periodItem: { alignItems: 'center', borderRadius: 6, minWidth: 50, paddingHorizontal: 8, paddingVertical: 7 },
  periodLabel: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  sectorList: { gap: 0 },
  sectorRow: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 58,
    paddingVertical: 8,
  },
  sectorIcon: { alignItems: 'center', borderRadius: 8, height: 34, justifyContent: 'center', width: 34 },
  sectorName: { flex: 1, fontSize: 14, fontWeight: '800', lineHeight: 20, marginLeft: 10 },
  changeWrap: { alignItems: 'center', flexDirection: 'row', justifyContent: 'flex-end', marginLeft: 7, width: 86 },
  sectorChange: { fontSize: 13, fontWeight: '900', lineHeight: 20 },
  sectionBlock: { gap: 10 },
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
  driverList: { gap: 12 },
  driverRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 34 },
  driverLabel: { alignItems: 'center', borderRadius: 6, justifyContent: 'center', minHeight: 27, width: 54 },
  driverLabelText: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  driverValue: { flex: 1, fontSize: 12, fontWeight: '700', lineHeight: 19 },
  tableHeader: { flexDirection: 'row', paddingBottom: 6 },
  tableHeaderText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 14 },
  tableNumber: { textAlign: 'right' },
  constituentRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', minHeight: 43 },
  constituentIdentity: { flex: 1 },
  constituentName: { fontSize: 12, fontWeight: '800', lineHeight: 18 },
  constituentCode: { fontSize: 9, fontWeight: '600', lineHeight: 13, marginTop: 1 },
  constituentNumber: { flex: 1, fontSize: 12, fontWeight: '800', lineHeight: 18, textAlign: 'right' },
  methodBlock: { gap: 7 },
  methodHeading: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  methodTitle: { fontSize: 14, fontWeight: '900', lineHeight: 20 },
  methodText: { fontSize: 11, fontWeight: '600', lineHeight: 18 },
  primaryButton: { alignItems: 'center', borderRadius: 10, flexDirection: 'row', gap: 7, justifyContent: 'center', minHeight: 50 },
  primaryButtonText: { fontSize: 14, fontWeight: '900', lineHeight: 20 },
  bottomNav: { borderTopWidth: 1, flexDirection: 'row', minHeight: 70, paddingBottom: 4, paddingTop: 8 },
  bottomNavItem: { alignItems: 'center', flex: 1, gap: 3, justifyContent: 'center' },
  bottomNavLabel: { fontSize: 10, fontWeight: '700', lineHeight: 14 },
  pressed: { opacity: 0.72 },
});
