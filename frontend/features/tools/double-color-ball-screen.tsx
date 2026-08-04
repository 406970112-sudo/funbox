import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import {
  BacktestPanel,
  BLUE,
  BlueFocus,
  CombinationCard,
  CORAL,
  EvidencePanel,
  HeatGrid,
  INDIGO,
  StructureBars,
} from '@/features/tools/double-color-ball-components';
import { useAppTheme } from '@/hooks/use-app-theme';
import { fetchSSQHistory, getSSQErrorMessage } from '@/lib/double-color-ball-api';
import {
  analyzeDraws,
  generateReferenceBatch,
  resolveReferenceBatch,
  runWalkForwardBacktest,
} from '@/lib/double-color-ball';
import {
  getSavedSSQBatch,
  setSavedSSQBatch,
} from '@/lib/double-color-ball-storage';
import type {
  BacktestSummary,
  SavedSSQBatch,
  SSQHistorySnapshot,
  SSQWindowSize,
} from '@/types/double-color-ball';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type LoadState = 'error' | 'loading' | 'ready';
type ViewMode = 'analysis' | 'combinations';

const windows: readonly SSQWindowSize[] = [30, 100, 300];

export function DoubleColorBallScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const [batchIndex, setBatchIndex] = useState(0);
  const [backtest, setBacktest] = useState<BacktestSummary | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [savedBatch, setSavedBatch] = useState<SavedSSQBatch | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedCombinationIndex, setSelectedCombinationIndex] = useState(0);
  const [snapshot, setSnapshot] = useState<SSQHistorySnapshot | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('analysis');
  const [windowSize, setWindowSize] = useState<SSQWindowSize>(100);
  const requestRef = useRef<AbortController | null>(null);
  const snapshotRef = useRef<SSQHistorySnapshot | null>(null);
  const dark = colorScheme === 'dark';
  const pageSurface = dark ? colors.background : '#f7f9fe';

  const loadHistory = useCallback(async (targetWindow: SSQWindowSize, initial: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoadState('loading');
    else setRefreshing(true);
    setMessage('');

    try {
      const [nextSnapshot, stored] = await Promise.all([
        fetchSSQHistory(controller.signal),
        getSavedSSQBatch(),
      ]);
      if (controller.signal.aborted) return;
      const analysis = analyzeDraws(nextSnapshot.draws, targetWindow);
      const resolved = resolveReferenceBatch(analysis, stored);
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setSavedBatch(stored);
      setBatchIndex(resolved.batchIndex);
      setSelectedCombinationIndex(0);
      setBacktest(null);
      setError(null);
      setLoadState('ready');
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (snapshotRef.current) {
        setMessage(getSSQErrorMessage(nextError));
      } else {
        setError(nextError);
        setLoadState('error');
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(100, true);
    return () => requestRef.current?.abort();
  }, [loadHistory]);

  const analysis = useMemo(
    () => snapshot ? analyzeDraws(snapshot.draws, windowSize) : null,
    [snapshot, windowSize],
  );

  const currentBatch = useMemo(() => {
    if (!analysis) return null;
    const resolved = resolveReferenceBatch(analysis, savedBatch);
    return resolved.batchIndex === batchIndex
      ? resolved.batch
      : generateReferenceBatch(analysis, batchIndex);
  }, [analysis, batchIndex, savedBatch]);

  const selectedCombination = currentBatch?.combinations[selectedCombinationIndex] ?? null;
  const isCurrentBatchSaved = Boolean(
    analysis
    && savedBatch
    && savedBatch.issue === analysis.latestDraw.issue
    && savedBatch.windowSize === windowSize
    && savedBatch.batchIndex === batchIndex,
  );

  useEffect(() => {
    if (viewMode !== 'combinations' || !snapshot) return;
    let cancelled = false;
    setBacktest(null);
    const timer = setTimeout(() => {
      const summary = runWalkForwardBacktest(snapshot.draws, windowSize);
      if (!cancelled) {
        startTransition(() => setBacktest(summary));
      }
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [snapshot, viewMode, windowSize]);

  function handleWindowChange(nextWindow: SSQWindowSize) {
    if (!snapshot || nextWindow === windowSize) return;
    const nextAnalysis = analyzeDraws(snapshot.draws, nextWindow);
    const resolved = resolveReferenceBatch(nextAnalysis, savedBatch);
    setWindowSize(nextWindow);
    setBatchIndex(resolved.batchIndex);
    setSelectedCombinationIndex(0);
    setBacktest(null);
    setMessage('');
  }

  function handleRegenerate() {
    setBatchIndex((current) => current + 1);
    setSelectedCombinationIndex(0);
    setMessage('已生成一批新的低重合参考组合');
  }

  async function handleSave() {
    if (!analysis || !currentBatch || saving) return;
    setSaving(true);
    const value: SavedSSQBatch = {
      batch: currentBatch,
      batchIndex,
      issue: analysis.latestDraw.issue,
      windowSize,
    };
    try {
      await setSavedSSQBatch(value);
      setSavedBatch(value);
      setMessage('本期组合已保存');
    } catch {
      setMessage('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  function handleBack() {
    if (viewMode === 'combinations') {
      setViewMode('analysis');
      setBacktest(null);
      return;
    }
    router.back();
  }

  const header = (
    <View style={[styles.header, { borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityLabel={viewMode === 'combinations' ? '返回概率分析' : '返回工具列表'}
        accessibilityRole="button"
        hitSlop={10}
        onPress={handleBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
      </Pressable>
      <ThemedText style={styles.headerTitle}>
        {viewMode === 'analysis' ? '双色球概率实验室' : '下期参考组合'}
      </ThemedText>
      <Pressable
        accessibilityLabel="查看概率说明"
        accessibilityRole="button"
        onPress={() => setInfoVisible((current) => !current)}
        style={({ pressed }) => [
          styles.infoButton,
          { backgroundColor: colors.surface, borderColor: colors.line },
          pressed && styles.pressed,
        ]}>
        <MaterialCommunityIcons name="information-outline" size={18} color={BLUE} />
      </Pressable>
    </View>
  );

  if (loadState === 'loading') {
    return (
      <ScreenShell background={pageSurface} dark={dark} header={header}>
        <View style={styles.centerState}>
          <ActivityIndicator color={BLUE} size="large" />
          <ThemedText style={styles.stateTitle}>正在同步官方开奖数据</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>校验期号、日期与号码范围</ThemedText>
        </View>
      </ScreenShell>
    );
  }

  if (loadState === 'error' || !snapshot || !analysis || !currentBatch) {
    return (
      <ScreenShell background={pageSurface} dark={dark} header={header}>
        <View style={styles.centerState}>
          <View style={styles.errorIcon}>
            <MaterialCommunityIcons name="database-alert-outline" size={30} color={CORAL} />
          </View>
          <ThemedText style={styles.stateTitle}>暂时无法生成参考组合</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>{getSSQErrorMessage(error)}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadHistory(windowSize, true)}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="refresh" size={18} color="#ffffff" />
            <ThemedText style={styles.retryText}>重新加载</ThemedText>
          </Pressable>
        </View>
      </ScreenShell>
    );
  }

  const selected = selectedCombination ?? currentBatch.combinations[0];
  const scrollContent = viewMode === 'analysis' ? (
    <AnalysisView
      analysis={analysis}
      currentBatchScore={Math.round(currentBatch.combinations.reduce((sum, item) => sum + item.structureScore, 0) / 5)}
      infoVisible={infoVisible}
      message={message}
      onShowCombinations={() => setViewMode('combinations')}
      onWindowChange={handleWindowChange}
      snapshot={snapshot}
      windowSize={windowSize}
    />
  ) : (
    <CombinationsView
      backtest={backtest}
      batchIndex={batchIndex}
      currentBatchSaved={isCurrentBatchSaved}
      infoVisible={infoVisible}
      message={message}
      onRegenerate={handleRegenerate}
      onSave={() => void handleSave()}
      onSelect={setSelectedCombinationIndex}
      saving={saving}
      selected={selected}
      selectedIndex={selectedCombinationIndex}
      snapshot={snapshot}
      combinations={currentBatch.combinations}
      windowSize={windowSize}
    />
  );

  return (
    <ScreenShell background={pageSurface} dark={dark} header={header}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            onRefresh={() => void loadHistory(windowSize, false)}
            refreshing={refreshing}
            tintColor={BLUE}
          />
        }
        showsVerticalScrollIndicator={false}>
        {snapshot.stale ? (
          <View style={styles.staleBanner}>
            <MaterialCommunityIcons name="clock-alert-outline" size={17} color="#a76a00" />
            <ThemedText style={styles.staleText}>官方数据暂时不可用，当前为 {formatFetchedAt(snapshot.fetchedAt)} 的缓存快照</ThemedText>
          </View>
        ) : null}
        {scrollContent}
      </ScrollView>
      <ToolBottomNavigation />
    </ScreenShell>
  );
}

function AnalysisView({
  analysis,
  currentBatchScore,
  infoVisible,
  message,
  onShowCombinations,
  onWindowChange,
  snapshot,
  windowSize,
}: {
  analysis: ReturnType<typeof analyzeDraws>;
  currentBatchScore: number;
  infoVisible: boolean;
  message: string;
  onShowCombinations: () => void;
  onWindowChange: (window: SSQWindowSize) => void;
  snapshot: SSQHistorySnapshot;
  windowSize: SSQWindowSize;
}) {
  const { colors } = useAppTheme();
  const cold = analysis.redStats.filter((item) => item.temperature === 'cold').slice(0, 3);
  const hot = analysis.redStats.filter((item) => item.temperature === 'hot').slice(0, 3);

  return (
    <>
      <View style={styles.syncLine}>
        <ThemedText style={[styles.syncText, { color: colors.mutedText }]}>已同步至 {analysis.latestDraw.issue} 期 · 近 {windowSize} 期</ThemedText>
        <View style={styles.sourceState}>
          <View style={styles.sourceDot} />
          <ThemedText style={styles.sourceStateText}>官方数据</ThemedText>
        </View>
      </View>

      <View style={styles.hero}>
        <ThemedText style={styles.heroMeta}>下一期开奖 · 历史结构参考</ThemedText>
        <ThemedText style={styles.heroTitle}>结构分析已更新</ThemedText>
        <ThemedText style={styles.heroSub}>基于频次、遗漏与分布约束生成参考</ThemedText>
        <View style={styles.heroDivider} />
        <View style={styles.heroMetrics}>
          <HeroMetric label="低遗漏观察" value={cold.map((item) => padBall(item.number)).join(' · ')} />
          <HeroMetric label="近期活跃" value={hot.map((item) => padBall(item.number)).join(' · ')} />
          <HeroMetric accent label="结构匹配" value={`${currentBatchScore} / 100`} />
        </View>
      </View>

      <ProbabilityStrip />
      {infoVisible ? <ProbabilityExplanation /> : null}
      {message ? <InlineMessage text={message} /> : null}

      <SegmentedWindow onChange={onWindowChange} selected={windowSize} />

      <SectionHeading caption="颜色越深，仅表示历史活跃" title="红球冷热分布" />
      <HeatGrid stats={analysis.redStats} />
      <BlueFocus stats={analysis.blueStats} />

      <SectionHeading caption="不属预测，只用于组合约束" title="常见结构区间" />
      <StructureBars analysis={analysis} />

      <Pressable
        accessibilityRole="button"
        onPress={onShowCombinations}
        style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chart-bell-curve-cumulative" size={19} color="#ffffff" />
        <ThemedText style={styles.primaryButtonText}>查看下期参考组合</ThemedText>
      </Pressable>
      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>结构匹配度用于解释模型规则，不代表中奖概率或收益。</ThemedText>
      <SourceFooter snapshot={snapshot} />
    </>
  );
}

function CombinationsView({
  backtest,
  batchIndex,
  combinations,
  currentBatchSaved,
  infoVisible,
  message,
  onRegenerate,
  onSave,
  onSelect,
  saving,
  selected,
  selectedIndex,
  snapshot,
  windowSize,
}: {
  backtest: BacktestSummary | null;
  batchIndex: number;
  combinations: ReturnType<typeof generateReferenceBatch>['combinations'];
  currentBatchSaved: boolean;
  infoVisible: boolean;
  message: string;
  onRegenerate: () => void;
  onSave: () => void;
  onSelect: (index: number) => void;
  saving: boolean;
  selected: ReturnType<typeof generateReferenceBatch>['combinations'][number];
  selectedIndex: number;
  snapshot: SSQHistorySnapshot;
  windowSize: SSQWindowSize;
}) {
  const { colors } = useAppTheme();

  return (
    <>
      <View style={styles.combinationHero}>
        <View>
          <ThemedText style={styles.combinationHeroTitle}>最新 {snapshot.draws[0].issue} 期之后 · 5 组</ThemedText>
          <ThemedText style={styles.combinationHeroMeta}>近 {windowSize} 期结构约束 · 批次 {batchIndex + 1}</ThemedText>
        </View>
        <View style={styles.updatedBadge}>
          <ThemedText style={styles.updatedText}>{currentBatchSaved ? '已保存' : '已更新'}</ThemedText>
        </View>
        <ThemedText style={styles.combinationHeroNote}>这些组合只代表规则筛选结果，不比其他合法组合拥有更高的理论中奖概率。</ThemedText>
      </View>
      {infoVisible ? <ProbabilityExplanation /> : null}
      {message ? <InlineMessage text={message} /> : null}

      <View style={styles.combinationList}>
        {combinations.map((combination, index) => (
          <CombinationCard
            combination={combination}
            index={index}
            key={`${batchIndex}-${combination.red.join('-')}-${combination.blue}`}
            onPress={() => onSelect(index)}
            selected={selectedIndex === index}
          />
        ))}
      </View>

      <EvidencePanel combination={selected} index={selectedIndex} />

      {backtest ? (
        <BacktestPanel summary={backtest} />
      ) : (
        <View style={styles.backtestLoading}>
          <ActivityIndicator color={BLUE} />
          <View>
            <ThemedText style={styles.backtestLoadingTitle}>正在执行无未来数据泄漏回测</ThemedText>
            <ThemedText style={[styles.backtestLoadingText, { color: colors.mutedText }]}>仅使用每个目标期之前的历史窗口</ThemedText>
          </View>
        </View>
      )}

      <View style={styles.actionRow}>
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={onSave}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: colors.primarySoft },
            pressed && styles.pressed,
          ]}>
          <MaterialCommunityIcons name={currentBatchSaved ? 'bookmark-check' : 'bookmark-outline'} size={18} color={BLUE} />
          <ThemedText style={[styles.secondaryButtonText, { color: BLUE }]}>
            {saving ? '保存中' : currentBatchSaved ? '已保存本期' : '保存本期'}
          </ThemedText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={onRegenerate}
          style={({ pressed }) => [styles.regenerateButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="refresh" size={18} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>换一批组合</ThemedText>
        </Pressable>
      </View>
      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>仅供娱乐与概率研究参考 · 18+ · 理性购彩 · 请勿将号码作为任何承诺</ThemedText>
      <SourceFooter snapshot={snapshot} />
    </>
  );
}

function ProbabilityStrip() {
  return (
    <View style={styles.probabilityStrip}>
      <View style={styles.probabilityIcon}>
        <MaterialCommunityIcons name="alert" size={15} color="#ffffff" />
      </View>
      <ThemedText style={styles.probabilityText}>每个合法单式组合理论中奖概率相同：约 1 / 17,721,088</ThemedText>
    </View>
  );
}

function ProbabilityExplanation() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.infoPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={styles.infoTitle}>概率说明</ThemedText>
      <ThemedText style={[styles.infoText, { color: colors.mutedText }]}>历史频次、遗漏和结构只能解释过去与生成规则，不能预测独立随机开奖，也不会提高任何合法组合的理论中奖概率。</ThemedText>
    </View>
  );
}

function SegmentedWindow({
  onChange,
  selected,
}: {
  onChange: (window: SSQWindowSize) => void;
  selected: SSQWindowSize;
}) {
  const { colors } = useAppTheme();
  return (
    <View accessibilityRole="tablist" style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {windows.map((window) => {
        const active = window === selected;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={window}
            onPress={() => onChange(window)}
            style={({ pressed }) => [
              styles.segment,
              active && { backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}>
            <ThemedText style={[styles.segmentText, { color: active ? BLUE : colors.mutedText }]}>近 {window} 期</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function HeroMetric({ accent, label, value }: { accent?: boolean; label: string; value: string }) {
  return (
    <View style={styles.heroMetric}>
      <ThemedText style={styles.heroMetricLabel}>{label}</ThemedText>
      <ThemedText style={[styles.heroMetricValue, accent && styles.heroMetricAccent]}>{value}</ThemedText>
    </View>
  );
}

function SectionHeading({ caption, title }: { caption: string; title: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sectionHeading}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>{caption}</ThemedText>
    </View>
  );
}

function InlineMessage({ text }: { text: string }) {
  return (
    <View style={styles.inlineMessage}>
      <MaterialCommunityIcons name="check-circle-outline" size={16} color="#168b70" />
      <ThemedText style={styles.inlineMessageText}>{text}</ThemedText>
    </View>
  );
}

function SourceFooter({ snapshot }: { snapshot: SSQHistorySnapshot }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sourceFooter}>
      <MaterialCommunityIcons name="database-check-outline" size={15} color={colors.mutedText} />
      <ThemedText style={[styles.sourceFooterText, { color: colors.mutedText }]}>中国福彩网历史开奖 · 更新于 {formatFetchedAt(snapshot.fetchedAt)}</ThemedText>
    </View>
  );
}

function ScreenShell({
  background,
  children,
  dark,
  header,
}: {
  background: string;
  children: React.ReactNode;
  dark: boolean;
  header: React.ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: background }]}>
        {header}
        {children}
      </View>
    </SafeAreaView>
  );
}

function ToolBottomNavigation() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const items: { icon: IconName; label: string; onPress: () => void; selected?: boolean }[] = [
    { icon: 'home-outline', label: '首页', onPress: () => router.replace('/') },
    { icon: 'message-outline', label: '消息', onPress: () => router.replace('/messages') },
    { icon: 'account-circle-outline', label: '我的', onPress: () => router.replace('/profile') },
  ];
  return (
    <View style={[styles.bottomNav, { backgroundColor: colors.surface, borderTopColor: colors.line }]}>
      {items.map((item) => {
        const color = item.selected ? BLUE : colors.tabInactive;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: Boolean(item.selected) }}
            key={item.label}
            onPress={item.onPress}
            style={({ pressed }) => [styles.bottomNavItem, pressed && styles.pressed]}>
            <MaterialCommunityIcons name={item.icon} size={21} color={color} />
            <ThemedText style={[styles.bottomNavLabel, { color }]}>{item.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function padBall(number: number) {
  return String(number).padStart(2, '0');
}

function formatFetchedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: '2-digit',
  }).format(date);
}

const styles = StyleSheet.create({
  actionRow: { flexDirection: 'row', gap: 9, marginTop: 12 },
  backtestLoading: { alignItems: 'center', borderColor: '#dce4f5', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 12, marginTop: 12, minHeight: 82, padding: 14 },
  backtestLoadingText: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  backtestLoadingTitle: { fontSize: 11, fontWeight: '800', lineHeight: 16 },
  bottomNav: { borderTopWidth: 1, flexDirection: 'row', minHeight: 68, paddingBottom: 4, paddingTop: 7 },
  bottomNavItem: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center' },
  bottomNavLabel: { fontSize: 9, fontWeight: '700', lineHeight: 13 },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  combinationHero: { backgroundColor: INDIGO, borderRadius: 8, padding: 14 },
  combinationHeroMeta: { color: '#aeb9d9', fontSize: 9, lineHeight: 14, marginTop: 3 },
  combinationHeroNote: { borderTopColor: 'rgba(255,255,255,0.16)', borderTopWidth: 1, color: '#dfe5f8', fontSize: 8, lineHeight: 13, marginTop: 11, paddingTop: 10 },
  combinationHeroTitle: { color: '#ffffff', fontSize: 16, fontWeight: '900', lineHeight: 22 },
  combinationList: { gap: 8, marginTop: 10 },
  disclaimer: { fontSize: 8, lineHeight: 13, marginTop: 8, textAlign: 'center' },
  errorIcon: { alignItems: 'center', backgroundColor: '#fff0f3', borderRadius: 8, height: 58, justifyContent: 'center', width: 58 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', height: 57, justifyContent: 'space-between', paddingHorizontal: 12 },
  headerTitle: { fontSize: 16, fontWeight: '900', lineHeight: 22 },
  hero: { backgroundColor: INDIGO, borderRadius: 8, marginTop: 10, padding: 15 },
  heroDivider: { backgroundColor: 'rgba(255,255,255,0.18)', height: 1, marginVertical: 12 },
  heroMeta: { color: '#dfe5f8', fontSize: 9, fontWeight: '700', lineHeight: 14 },
  heroMetric: { flex: 1, minWidth: 0 },
  heroMetricAccent: { color: '#c9f36a' },
  heroMetricLabel: { color: '#9facce', fontSize: 8, lineHeight: 12 },
  heroMetricValue: { color: '#ffffff', fontSize: 12, fontWeight: '900', lineHeight: 17, marginTop: 3 },
  heroMetrics: { flexDirection: 'row', gap: 12 },
  heroSub: { color: '#b7c2df', fontSize: 9, lineHeight: 14, marginTop: 4 },
  heroTitle: { color: '#ffffff', fontSize: 22, fontWeight: '900', lineHeight: 28, marginTop: 5 },
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  infoButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 34, justifyContent: 'center', width: 34 },
  infoPanel: { borderRadius: 8, borderWidth: 1, marginTop: 10, padding: 11 },
  infoText: { fontSize: 9, lineHeight: 15, marginTop: 3 },
  infoTitle: { fontSize: 11, fontWeight: '900', lineHeight: 16 },
  inlineMessage: { alignItems: 'center', backgroundColor: '#ebfaf5', borderRadius: 6, flexDirection: 'row', gap: 7, marginTop: 9, paddingHorizontal: 10, paddingVertical: 8 },
  inlineMessageText: { color: '#146e5d', flex: 1, fontSize: 9, fontWeight: '700', lineHeight: 14 },
  pressed: { opacity: 0.76 },
  primaryButton: { alignItems: 'center', backgroundColor: '#4b6bff', borderRadius: 8, flexDirection: 'row', gap: 8, height: 48, justifyContent: 'center', marginTop: 14 },
  primaryButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900', lineHeight: 16 },
  probabilityIcon: { alignItems: 'center', backgroundColor: '#f5a623', borderRadius: 999, height: 24, justifyContent: 'center', width: 24 },
  probabilityStrip: { alignItems: 'center', backgroundColor: '#fff7e8', borderLeftColor: '#f5a623', borderLeftWidth: 3, borderRadius: 3, flexDirection: 'row', gap: 9, marginTop: 10, minHeight: 48, paddingHorizontal: 10 },
  probabilityText: { color: '#5b4924', flex: 1, fontSize: 9, fontWeight: '800', lineHeight: 14 },
  regenerateButton: { alignItems: 'center', backgroundColor: '#4b6bff', borderRadius: 8, flex: 1.18, flexDirection: 'row', gap: 7, height: 45, justifyContent: 'center' },
  retryButton: { alignItems: 'center', backgroundColor: '#4b6bff', borderRadius: 8, flexDirection: 'row', gap: 7, marginTop: 17, paddingHorizontal: 18, paddingVertical: 11 },
  retryText: { color: '#ffffff', fontSize: 11, fontWeight: '900', lineHeight: 16 },
  safeArea: { flex: 1 },
  screenShell: { alignSelf: 'center', flex: 1, maxWidth: appLayout.screenMaxWidth, overflow: 'hidden', width: '100%' },
  scrollContent: { paddingBottom: 18, paddingHorizontal: 14, paddingTop: 8 },
  secondaryButton: { alignItems: 'center', borderRadius: 8, flex: 1, flexDirection: 'row', gap: 7, height: 45, justifyContent: 'center' },
  secondaryButtonText: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  sectionCaption: { fontSize: 8, lineHeight: 12 },
  sectionHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginTop: 15 },
  sectionTitle: { fontSize: 13, fontWeight: '900', lineHeight: 19 },
  segmented: { borderRadius: 8, flexDirection: 'row', height: 40, marginTop: 10, padding: 3 },
  segment: { alignItems: 'center', borderRadius: 6, flex: 1, justifyContent: 'center' },
  segmentText: { fontSize: 10, fontWeight: '800', lineHeight: 15 },
  sourceDot: { backgroundColor: '#c9f36a', borderRadius: 999, height: 7, width: 7 },
  sourceFooter: { alignItems: 'center', flexDirection: 'row', gap: 5, justifyContent: 'center', marginTop: 13 },
  sourceFooterText: { fontSize: 8, lineHeight: 12 },
  sourceState: { alignItems: 'center', backgroundColor: '#effbe9', borderRadius: 999, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 5 },
  sourceStateText: { color: '#168b70', fontSize: 8, fontWeight: '800', lineHeight: 12 },
  staleBanner: { alignItems: 'flex-start', backgroundColor: '#fff7e8', borderRadius: 6, flexDirection: 'row', gap: 7, marginBottom: 4, padding: 9 },
  staleText: { color: '#7c590d', flex: 1, fontSize: 9, lineHeight: 14 },
  stateText: { fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' },
  stateTitle: { fontSize: 17, fontWeight: '900', lineHeight: 23, marginTop: 15, textAlign: 'center' },
  syncLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  syncText: { fontSize: 9, lineHeight: 14 },
  updatedBadge: { alignItems: 'center', alignSelf: 'flex-end', backgroundColor: '#c9f36a', borderRadius: 999, justifyContent: 'center', marginTop: -36, minHeight: 25, paddingHorizontal: 9 },
  updatedText: { color: '#26320b', fontSize: 8, fontWeight: '900', lineHeight: 12 },
});
