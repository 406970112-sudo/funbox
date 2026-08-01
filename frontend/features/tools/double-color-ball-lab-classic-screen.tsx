import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  buildLabBacktestCsv,
  getLabAlgorithmLabel,
  runLabBacktest,
} from '@/lib/double-color-ball-lab-classic';
import {
  fetchSSQLabHistory,
  getSSQLabErrorMessage,
} from '@/lib/double-color-ball-lab-api';
import { downloadWebData } from '@/lib/qr-export';
import type {
  SSQLabClassicAlgorithm,
  SSQLabClassicBacktestSummary,
  SSQLabClassicFetchCount,
  SSQLabClassicHistorySnapshot,
  SSQLabClassicTargetCount,
  SSQLabClassicWindowSize,
} from '@/types/double-color-ball-lab-classic';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type LoadState = 'error' | 'loading' | 'ready';

const fetchCounts: readonly SSQLabClassicFetchCount[] = [100, 200, 400, 1000];
const windows: readonly SSQLabClassicWindowSize[] = [30, 100, 300];
const algorithms: readonly SSQLabClassicAlgorithm[] = ['low-frequency', 'time-weighted', 'normal-fit'];
const decays: readonly number[] = [0.999, 0.995, 0.99];
const targetCounts: readonly SSQLabClassicTargetCount[] = [20, 50, 100];

const CORAL = '#ff5f72';
const BLUE = '#3785ff';
const GREEN = '#20ad78';
const INDIGO = '#151b3b';
const LIME = '#c9f36a';

export function DoubleColorBallLabClassicScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const [algorithm, setAlgorithm] = useState<SSQLabClassicAlgorithm>('low-frequency');
  const [error, setError] = useState<unknown>(null);
  const [exporting, setExporting] = useState(false);
  const [fetchCount, setFetchCount] = useState<SSQLabClassicFetchCount>(400);
  const [hasRun, setHasRun] = useState(false);
  const [infoVisible, setInfoVisible] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [runNonce, setRunNonce] = useState(0);
  const [snapshot, setSnapshot] = useState<SSQLabClassicHistorySnapshot | null>(null);
  const [targetCount, setTargetCount] = useState<SSQLabClassicTargetCount>(50);
  const [decay, setDecay] = useState(0.999);
  const [windowSize, setWindowSize] = useState<SSQLabClassicWindowSize>(100);
  const requestRef = useRef<AbortController | null>(null);
  const runCountRef = useRef(0);
  const snapshotRef = useRef<SSQLabClassicHistorySnapshot | null>(null);
  const dark = colorScheme === 'dark';
  const pageSurface = dark ? colors.background : '#f7f9fe';

  const loadHistory = useCallback(async (count: SSQLabClassicFetchCount, initial: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoadState('loading');
    else setRefreshing(true);
    setMessage('');

    try {
      const nextSnapshot = await fetchSSQLabHistory(count, controller.signal);
      if (controller.signal.aborted) return;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setError(null);
      setLoadState('ready');
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (snapshotRef.current) {
        setMessage(getSSQLabErrorMessage(nextError));
      } else {
        setError(nextError);
        setLoadState('error');
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(1000, true);
    return () => requestRef.current?.abort();
  }, [loadHistory]);

  function handleFetchCountChange(nextCount: SSQLabClassicFetchCount) {
    if (nextCount === fetchCount) return;
    setFetchCount(nextCount);
    void loadHistory(nextCount, false);
  }

  const summary = useMemo(() => {
    if (!hasRun || !snapshot || snapshot.draws.length < windowSize) return null;
    return runLabBacktest(snapshot.draws, {
      algorithm,
      decay,
      targetCount,
      windowSize,
    });
  }, [algorithm, decay, hasRun, runNonce, snapshot, targetCount, windowSize]);

  async function handleExport() {
    if (!summary || exporting) return;
    setExporting(true);
    try {
      const csv = buildLabBacktestCsv(summary);
      const fileName = `双色球计划实验室V1回测-${getLabAlgorithmLabel(summary.algorithm)}-${summary.windowSize}期.csv`;
      if (Platform.OS === 'web') {
        downloadWebData(csv, fileName, 'text/csv;charset=utf-8');
        setMessage('CSV 已导出，可用 Excel 打开');
      } else {
        const FileSystem = await import('expo-file-system/legacy');
        const Sharing = await import('expo-sharing');
        const fileUri = `${FileSystem.cacheDirectory}${fileName}`;
        await FileSystem.writeAsStringAsync(fileUri, csv, {
          encoding: FileSystem.EncodingType.UTF8,
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(fileUri, {
            dialogTitle: '导出回测明细',
            mimeType: 'text/csv',
          });
        }
      }
    } catch {
      setMessage('导出失败，请重试');
    } finally {
      setExporting(false);
    }
  }

  function handleRunBacktest(label: string) {
    runCountRef.current += 1;
    setHasRun(true);
    setMessage(`${label}（第 ${runCountRef.current} 次）`);
    setRunNonce((current) => current + 1);
  }

  const header = (
    <View style={[styles.header, { borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityLabel="返回上一页"
        accessibilityRole="button"
        hitSlop={10}
        onPress={() => router.back()}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
      </Pressable>
      <ThemedText style={styles.headerTitle}>双色球计划实验室 V1</ThemedText>
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
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            校验期号、日期与一、二等奖金额
          </ThemedText>
        </View>
      </ScreenShell>
    );
  }

  if (loadState === 'error' || !snapshot) {
    return (
      <ScreenShell background={pageSurface} dark={dark} header={header}>
        <View style={styles.centerState}>
          <View style={styles.errorIcon}>
            <MaterialCommunityIcons name="database-alert-outline" size={30} color={CORAL} />
          </View>
          <ThemedText style={styles.stateTitle}>暂时无法生成回测结果</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>
            {getSSQLabErrorMessage(error)}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadHistory(fetchCount, true)}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="refresh" size={18} color="#ffffff" />
            <ThemedText style={styles.primaryButtonText}>重新加载</ThemedText>
          </Pressable>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell background={pageSurface} dark={dark} header={header}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            onRefresh={() => void loadHistory(fetchCount, false)}
            refreshing={refreshing}
            tintColor={BLUE}
          />
        }
        showsVerticalScrollIndicator={false}>
        {snapshot.stale ? (
          <View style={styles.staleBanner}>
            <MaterialCommunityIcons name="clock-alert-outline" size={17} color="#a76a00" />
            <ThemedText style={styles.staleText}>
              官方数据暂时不可用，当前为缓存快照
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.syncLine}>
          <ThemedText style={[styles.syncText, { color: colors.mutedText }]}>
            已同步至 {snapshot.draws[0]?.issue ?? '--'} 期 · {snapshot.count} 期
          </ThemedText>
          <View style={styles.sourceState}>
            <View style={styles.sourceDot} />
            <ThemedText style={styles.sourceStateText}>官方数据</ThemedText>
          </View>
        </View>

        <View style={styles.hero}>
          <ThemedText style={styles.heroMeta}>参数回测 · 收益期望</ThemedText>
          <ThemedText style={styles.heroTitle}>先跑回测，再看结论</ThemedText>
          <ThemedText style={styles.heroSub}>
            用前 N 期推算第 N 期，按官方浮动奖金与固定奖规则计算每期奖金。
          </ThemedText>
          <View style={styles.heroMetrics}>
            <HeroMetric label="最新期" value={snapshot.draws[0]?.issue ?? '--'} />
            <HeroMetric label="数据范围" value={`${snapshot.count} 期`} />
            <HeroMetric accent label="每注成本" value="2 元" />
          </View>
        </View>

        <LabPanel title="历史期数" caption="官方开奖可抓取">
          <SegmentedChips
            labels={fetchCounts.map((count) => String(count))}
            selected={String(fetchCount)}
            onSelect={(value) => handleFetchCountChange(Number(value) as SSQLabClassicFetchCount)}
          />
        </LabPanel>

        <LabPanel title="统计窗口" caption="用于算法训练">
          <SegmentedChips
            labels={windows.map((window) => `${window} 期`)}
            selected={String(windowSize)}
            onSelect={(value) => setWindowSize(Number(value) as SSQLabClassicWindowSize)}
          />
        </LabPanel>

        <LabPanel title="预测算法" caption="三套可切换">
          <View style={styles.algorithmList}>
            {algorithms.map((item, index) => {
              const active = item === algorithm;
              return (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  key={item}
                  onPress={() => setAlgorithm(item)}
                  style={({ pressed }) => [
                    styles.algorithm,
                    { borderColor: active ? '#4b6bff' : colors.line },
                    active && { backgroundColor: colors.primarySoft },
                    pressed && styles.pressed,
                  ]}>
                  <View style={[styles.algorithmIndex, active && styles.algorithmIndexActive]}>
                    <ThemedText style={[styles.algorithmIndexText, active && styles.algorithmIndexTextActive]}>
                      {index + 1}
                    </ThemedText>
                  </View>
                  <View style={styles.algorithmCopy}>
                    <ThemedText style={styles.algorithmTitle}>
                      {getLabAlgorithmLabel(item)}
                    </ThemedText>
                    <ThemedText style={[styles.algorithmCaption, { color: colors.mutedText }]}>
                      {algorithmCaption(item)}
                    </ThemedText>
                  </View>
                  {active ? (
                    <MaterialCommunityIcons name="check-circle" size={17} color="#4b6bff" />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </LabPanel>

        {algorithm === 'time-weighted' ? (
          <LabPanel title="时间衰减" caption="参数可调">
            <SegmentedChips
              labels={decays.map((value) => value.toFixed(3))}
              selected={decay.toFixed(3)}
              onSelect={(value) => setDecay(Number(value))}
            />
          </LabPanel>
        ) : null}

        <LabPanel title="回测期数" caption="最近 N 个目标期">
          <SegmentedChips
            labels={targetCounts.map((count) => `${count} 期`)}
            selected={String(targetCount)}
            onSelect={(value) => setTargetCount(Number(value) as SSQLabClassicTargetCount)}
          />
        </LabPanel>

        {infoVisible ? <ProbabilityExplanation /> : null}
        {message ? <InlineMessage text={message} /> : null}

        <Pressable
          accessibilityRole="button"
          onPress={() => handleRunBacktest('回测完成，已生成收益明细')}
          style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
          <MaterialCommunityIcons name="play-circle-outline" size={19} color="#ffffff" />
          <ThemedText style={styles.primaryButtonText}>运行回测</ThemedText>
        </Pressable>
        <ThemedText style={[styles.note, { color: colors.mutedText }]}>
          固定奖：三 3000 / 四 200 / 五 10 / 六 5；一、二等奖取当期官方每注奖金。
        </ThemedText>

        {summary ? <LabResults summary={summary} /> : (
          <View style={styles.emptyResult}>
            <MaterialCommunityIcons name="chart-bell-curve" size={28} color={BLUE} />
            <ThemedText style={styles.emptyTitle}>
              {hasRun ? '数据不足，无法回测' : '尚未运行回测'}
            </ThemedText>
            <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
              {hasRun
                ? '当前数据期数少于统计窗口，请切换更小窗口或抓取更多历史期数。'
                : '设置参数后点击运行回测，生成收益明细与命中分布。'}
            </ThemedText>
          </View>
        )}

        {summary ? (
          <View style={styles.actionRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => void handleExport()}
              disabled={exporting}
              style={({ pressed }) => [
                styles.darkButton,
                exporting && styles.disabled,
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="file-excel-outline" size={17} color="#ffffff" />
              <ThemedText style={styles.darkButtonText}>
                {exporting ? '导出中…' : '导出 Excel（CSV）'}
              </ThemedText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => handleRunBacktest('已重新回测，结果已更新')}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: colors.primarySoft },
                pressed && styles.pressed,
              ]}>
              <MaterialCommunityIcons name="refresh" size={17} color={BLUE} />
              <ThemedText style={[styles.secondaryButtonText, { color: BLUE }]}>
                换参数重跑
              </ThemedText>
            </Pressable>
          </View>
        ) : null}

        <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
          回测只用于检验算法行为，开奖是独立随机事件，任何组合理论中奖概率相同。
        </ThemedText>
        <SourceFooter snapshot={snapshot} />
      </ScrollView>
      <ToolBottomNavigation />
    </ScreenShell>
  );
}

function LabResults({ summary }: { summary: SSQLabClassicBacktestSummary }) {
  const { colors } = useAppTheme();
  const hitRate = summary.targetCount === 0
    ? 0
    : Math.round((summary.records.filter((record) => record.prize > 0).length / summary.targetCount) * 100);
  const metrics = [
    { label: '总投入', value: `${summary.totalCost} 元`, tone: 'normal' as const },
    { label: '总奖金', value: `${summary.totalPrize} 元`, tone: summary.net >= 0 ? 'win' as const : 'loss' as const },
    { label: '净收益', value: `${summary.net} 元`, tone: summary.net >= 0 ? 'win' as const : 'loss' as const },
    { label: '每注期望', value: summary.evPerTicket.toFixed(2), tone: 'normal' as const },
    { label: '剔除头奖净收益', value: `${summary.netWithoutFirstPrize} 元`, tone: summary.netWithoutFirstPrize >= 0 ? 'win' as const : 'loss' as const },
    { label: '中奖率', value: `${hitRate}%`, tone: 'normal' as const },
  ];
  const rows = [
    {
      color: '#4b6bff',
      label: '红球命中 0—1',
      value: summary.redHitBuckets.zeroToOne,
      total: summary.targetCount,
    },
    {
      color: CORAL,
      label: '红球命中 2—3',
      value: summary.redHitBuckets.twoToThree,
      total: summary.targetCount,
    },
    {
      color: GREEN,
      label: '红球命中 4+',
      value: summary.redHitBuckets.fourPlus,
      total: summary.targetCount,
    },
    {
      color: GREEN,
      label: '蓝球命中',
      value: summary.blueHitCount,
      total: summary.targetCount,
    },
  ];
  const recentRecords = [...summary.records].reverse().slice(0, 6);

  return (
    <>
      <View style={styles.resultsSection}>
        <View style={styles.resultsHeading}>
          <ThemedText style={styles.sectionTitle}>收益回测结果</ThemedText>
          <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>
            {summary.algorithm === 'time-weighted'
              ? `${getLabAlgorithmLabel(summary.algorithm)} · 衰减 ${summary.decay}`
              : `${getLabAlgorithmLabel(summary.algorithm)} · ${summary.windowSize} 期窗口`}
          </ThemedText>
        </View>
        <View style={styles.metricGrid}>
          {metrics.map((metric) => (
            <View
              key={metric.label}
              style={[
                styles.metric,
                { borderColor: colors.line },
              ]}>
              <ThemedText
                style={[
                  styles.metricLabel,
                  { color: colors.mutedText },
                ]}>
                {metric.label}
              </ThemedText>
              <ThemedText
                style={[
                  styles.metricValue,
                  metric.tone === 'loss' && styles.metricLoss,
                  metric.tone === 'win' && styles.metricWin,
                ]}>
                {metric.value}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      <View style={[styles.distribution, { borderColor: colors.line }]}>
        <View style={styles.resultsHeading}>
          <ThemedText style={styles.sectionTitle}>命中分布</ThemedText>
          <ThemedText style={[styles.sectionCaption, { color: colors.mutedText }]}>
            仅描述模型行为
          </ThemedText>
        </View>
        {rows.map((row) => {
          const percentage = row.total === 0 ? 0 : Math.round((row.value / row.total) * 100);
          return (
            <View key={row.label} style={styles.distRow}>
              <ThemedText style={styles.distLabel}>{row.label}</ThemedText>
              <View style={styles.distTrack}>
                <View
                  style={[styles.distFill, { backgroundColor: row.color, width: `${percentage}%` }]}
                />
              </View>
              <ThemedText style={styles.distValue}>{percentage}%</ThemedText>
            </View>
          );
        })}
      </View>

      <View style={[styles.table, { borderColor: colors.line }]}>
        <View style={[styles.tableHead, { backgroundColor: colors.surfaceMuted }]}>
          {['期号', '预测号', '开奖号', '红球', '奖金', '盈亏'].map((label) => (
            <ThemedText key={label} style={styles.tableHeadText}>
              {label}
            </ThemedText>
          ))}
        </View>
        {recentRecords.map((record) => (
          <View key={record.issue} style={[styles.tableRow, { borderBottomColor: colors.line }]}>
            <ThemedText style={styles.tableIssue}>{record.issue}</ThemedText>
            <BallGroup red={record.predictedRed} blue={record.predictedBlue} />
            <BallGroup red={record.actualRed} blue={record.actualBlue} />
            <ThemedText style={styles.tableValue}>{record.redHits}</ThemedText>
            <ThemedText style={styles.tableValue}>{record.prize}</ThemedText>
            <ThemedText
              style={[
                styles.tableValue,
                record.net >= 0 ? styles.metricWin : styles.metricLoss,
              ]}>
              {record.net}
            </ThemedText>
          </View>
        ))}
      </View>
      <ThemedText style={[styles.tableNote, { color: colors.mutedText }]}>
        仅展示最近 {recentRecords.length} 期，完整明细见导出的 CSV。
      </ThemedText>
      {summary.missingFloatingPrizeCount > 0 ? (
        <View style={styles.warningLine}>
          <MaterialCommunityIcons name="alert-outline" size={15} color="#a76a00" />
          <ThemedText style={styles.warningText}>
            {summary.missingFloatingPrizeCount} 期缺少浮动奖金额，按 0 计算。
          </ThemedText>
        </View>
      ) : null}
    </>
  );
}

function BallGroup({ red, blue }: { red: readonly number[]; blue: number }) {
  return (
    <View style={styles.ballGroup}>
      {red.map((number) => (
        <View key={number} style={styles.redBall}>
          <ThemedText style={styles.ballText}>{padBall(number)}</ThemedText>
        </View>
      ))}
      <View style={styles.blueBall}>
        <ThemedText style={styles.ballText}>{padBall(blue)}</ThemedText>
      </View>
    </View>
  );
}

function LabPanel({
  caption,
  children,
  title,
}: {
  caption: string;
  children: React.ReactNode;
  title: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.panel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <View style={styles.panelHead}>
        <ThemedText style={styles.panelTitle}>{title}</ThemedText>
        <ThemedText style={[styles.panelCaption, { color: colors.mutedText }]}>{caption}</ThemedText>
      </View>
      {children}
    </View>
  );
}

function SegmentedChips({
  labels,
  onSelect,
  selected,
}: {
  labels: readonly string[];
  onSelect: (value: string) => void;
  selected: string;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {labels.map((label) => {
        const active = label === selected;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            key={label}
            onPress={() => onSelect(label)}
            style={({ pressed }) => [
              styles.segment,
              active && { backgroundColor: colors.surface },
              pressed && styles.pressed,
            ]}>
            <ThemedText
              style={[styles.segmentText, { color: active ? '#4b6bff' : colors.mutedText }]}>
              {label}
            </ThemedText>
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
      <ThemedText style={[styles.heroMetricValue, accent && styles.heroMetricAccent]}>
        {value}
      </ThemedText>
    </View>
  );
}

function ProbabilityExplanation() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.infoPanel, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <ThemedText style={styles.infoTitle}>概率说明</ThemedText>
      <ThemedText style={[styles.infoText, { color: colors.mutedText }]}>
        历史频次、时间权重和正态拟合只描述数据与生成规则，不能预测独立随机开奖，也不会提高任何合法组合的理论中奖概率。
      </ThemedText>
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

function SourceFooter({ snapshot }: { snapshot: SSQLabClassicHistorySnapshot }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.sourceFooter}>
      <MaterialCommunityIcons name="database-check-outline" size={15} color={colors.mutedText} />
      <ThemedText style={[styles.sourceFooterText, { color: colors.mutedText }]}>
        中国福彩网历史开奖 · 更新于 {formatFetchedAt(snapshot.fetchedAt)}
      </ThemedText>
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
    { icon: 'home-outline', label: '首页', onPress: () => router.replace('/'), },
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

function algorithmCaption(algorithm: SSQLabClassicAlgorithm) {
  if (algorithm === 'time-weighted') return '按 0.999^n 给近期出现加权';
  if (algorithm === 'normal-fit') return '各位置拟合正态分布取顶点';
  return '出现频次最低的红球与蓝球';
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
  actionRow: { flexDirection: 'row', gap: 9, marginTop: 10 },
  algorithm: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 9, minHeight: 44, padding: 8 },
  algorithmCaption: { fontSize: 8, lineHeight: 12, marginTop: 2 },
  algorithmCopy: { flex: 1, minWidth: 0 },
  algorithmIndex: { alignItems: 'center', borderRadius: 6, height: 22, justifyContent: 'center', width: 22 },
  algorithmIndexActive: { backgroundColor: '#4b6bff' },
  algorithmIndexText: { color: '#7483a2', fontSize: 9, fontWeight: '900' },
  algorithmIndexTextActive: { color: '#ffffff' },
  algorithmList: { gap: 7 },
  algorithmTitle: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  ballGroup: { alignItems: 'center', flexDirection: 'row', gap: 2 },
  ballText: { color: '#ffffff', fontSize: 6, fontWeight: '900' },
  blueBall: { alignItems: 'center', backgroundColor: BLUE, borderRadius: 999, height: 15, justifyContent: 'center', width: 15 },
  bottomNav: { borderTopWidth: 1, flexDirection: 'row', minHeight: 68, paddingBottom: 4, paddingTop: 7 },
  bottomNavItem: { alignItems: 'center', flex: 1, gap: 2, justifyContent: 'center' },
  bottomNavLabel: { fontSize: 9, fontWeight: '700', lineHeight: 13 },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 30 },
  darkButton: { alignItems: 'center', backgroundColor: INDIGO, borderRadius: 8, flex: 1, flexDirection: 'row', gap: 7, height: 44, justifyContent: 'center' },
  darkButtonText: { color: '#ffffff', fontSize: 10, fontWeight: '900', lineHeight: 15 },
  disabled: { opacity: 0.6 },
  disclaimer: { fontSize: 8, lineHeight: 13, marginTop: 10, textAlign: 'center' },
  distFill: { borderRadius: 999, height: '100%' },
  distLabel: { fontSize: 8, fontWeight: '700', width: 86 },
  distRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginTop: 9 },
  distTrack: { backgroundColor: '#e8edf7', borderRadius: 999, flex: 1, height: 6, overflow: 'hidden' },
  distValue: { fontSize: 9, fontWeight: '900', textAlign: 'right', width: 34 },
  distribution: { borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 12 },
  emptyResult: { alignItems: 'center', borderColor: '#dce4f5', borderRadius: 8, borderWidth: 1, marginTop: 12, padding: 20 },
  emptyText: { fontSize: 9, lineHeight: 14, marginTop: 4, textAlign: 'center' },
  emptyTitle: { fontSize: 13, fontWeight: '900', lineHeight: 19, marginTop: 8 },
  errorIcon: { alignItems: 'center', backgroundColor: '#fff0f3', borderRadius: 8, height: 58, justifyContent: 'center', width: 58 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', height: 57, justifyContent: 'space-between', paddingHorizontal: 12 },
  headerTitle: { fontSize: 16, fontWeight: '900', lineHeight: 22 },
  hero: { backgroundColor: INDIGO, borderRadius: 8, marginTop: 10, padding: 15 },
  heroMeta: { color: '#dfe5f8', fontSize: 9, fontWeight: '700', lineHeight: 14 },
  heroMetric: { flex: 1, minWidth: 0 },
  heroMetricAccent: { color: LIME },
  heroMetricLabel: { color: '#9facce', fontSize: 8, lineHeight: 12 },
  heroMetricValue: { color: '#ffffff', fontSize: 12, fontWeight: '900', lineHeight: 17, marginTop: 3 },
  heroMetrics: { flexDirection: 'row', gap: 12, marginTop: 12 },
  heroSub: { color: '#b7c2df', fontSize: 9, lineHeight: 14, marginTop: 4 },
  heroTitle: { color: '#ffffff', fontSize: 21, fontWeight: '900', lineHeight: 27, marginTop: 5 },
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  infoButton: { alignItems: 'center', borderRadius: 8, borderWidth: 1, height: 34, justifyContent: 'center', width: 34 },
  infoPanel: { borderRadius: 8, borderWidth: 1, marginTop: 10, padding: 11 },
  infoText: { fontSize: 9, lineHeight: 15, marginTop: 3 },
  infoTitle: { fontSize: 11, fontWeight: '900', lineHeight: 16 },
  inlineMessage: { alignItems: 'center', backgroundColor: '#ebfaf5', borderRadius: 6, flexDirection: 'row', gap: 7, marginTop: 9, paddingHorizontal: 10, paddingVertical: 8 },
  inlineMessageText: { color: '#146e5d', flex: 1, fontSize: 9, fontWeight: '700', lineHeight: 14 },
  metric: { borderRadius: 7, borderWidth: 1, minHeight: 62, padding: 9 },
  metricAccent: { backgroundColor: INDIGO, borderColor: INDIGO },
  metricAccentValue: { color: LIME },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  metricLabel: { fontSize: 8, fontWeight: '700', lineHeight: 12 },
  metricLoss: { color: CORAL },
  metricValue: { fontSize: 14, fontWeight: '900', lineHeight: 19, marginTop: 5 },
  metricWin: { color: GREEN },
  note: { fontSize: 8, lineHeight: 13, marginTop: 7, textAlign: 'center' },
  panel: { borderRadius: 8, borderWidth: 1, marginTop: 10, padding: 11 },
  panelCaption: { fontSize: 8, lineHeight: 12 },
  panelHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  panelTitle: { fontSize: 11, fontWeight: '900', lineHeight: 16 },
  pressed: { opacity: 0.76 },
  primaryButton: { alignItems: 'center', backgroundColor: '#4b6bff', borderRadius: 8, flexDirection: 'row', gap: 8, height: 48, justifyContent: 'center', marginTop: 12 },
  primaryButtonText: { color: '#ffffff', fontSize: 11, fontWeight: '900', lineHeight: 16 },
  redBall: { alignItems: 'center', backgroundColor: CORAL, borderRadius: 999, height: 15, justifyContent: 'center', width: 15 },
  resultsHeading: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between' },
  resultsSection: { marginTop: 14 },
  safeArea: { flex: 1 },
  screenShell: { alignSelf: 'center', flex: 1, maxWidth: appLayout.screenMaxWidth, overflow: 'hidden', width: '100%' },
  scrollContent: { paddingBottom: 18, paddingHorizontal: 14, paddingTop: 8 },
  secondaryButton: { alignItems: 'center', borderRadius: 8, flex: 1, flexDirection: 'row', gap: 7, height: 44, justifyContent: 'center' },
  secondaryButtonText: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  sectionCaption: { fontSize: 8, lineHeight: 12 },
  sectionTitle: { fontSize: 13, fontWeight: '900', lineHeight: 19 },
  segment: { alignItems: 'center', borderRadius: 6, flex: 1, justifyContent: 'center' },
  segmented: { borderRadius: 8, flexDirection: 'row', height: 38, padding: 3 },
  segmentText: { fontSize: 10, fontWeight: '800', lineHeight: 15 },
  sourceDot: { backgroundColor: LIME, borderRadius: 999, height: 7, width: 7 },
  sourceFooter: { alignItems: 'center', flexDirection: 'row', gap: 5, justifyContent: 'center', marginTop: 11 },
  sourceFooterText: { fontSize: 8, lineHeight: 12 },
  sourceState: { alignItems: 'center', backgroundColor: '#effbe9', borderRadius: 999, flexDirection: 'row', gap: 5, paddingHorizontal: 8, paddingVertical: 5 },
  sourceStateText: { color: '#168b70', fontSize: 8, fontWeight: '800', lineHeight: 12 },
  staleBanner: { alignItems: 'flex-start', backgroundColor: '#fff7e8', borderRadius: 6, flexDirection: 'row', gap: 7, marginBottom: 4, padding: 9 },
  staleText: { color: '#7c590d', flex: 1, fontSize: 9, lineHeight: 14 },
  stateText: { fontSize: 11, lineHeight: 17, marginTop: 4, textAlign: 'center' },
  stateTitle: { fontSize: 17, fontWeight: '900', lineHeight: 23, marginTop: 15, textAlign: 'center' },
  syncLine: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  syncText: { fontSize: 9, lineHeight: 14 },
  table: { borderRadius: 8, borderWidth: 1, marginTop: 12, overflow: 'hidden' },
  tableHead: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 8 },
  tableHeadText: { flex: 1, fontSize: 7, fontWeight: '800', lineHeight: 11, minWidth: 0 },
  tableIssue: { flex: 1, fontSize: 7, fontWeight: '900', lineHeight: 11, minWidth: 0 },
  tableNote: { fontSize: 8, lineHeight: 12, marginTop: 7, textAlign: 'center' },
  tableRow: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingVertical: 9 },
  tableValue: { flex: 1, fontSize: 8, fontWeight: '700', lineHeight: 11, minWidth: 0, textAlign: 'center' },
  warningLine: { alignItems: 'flex-start', backgroundColor: '#fff7e8', borderRadius: 6, flexDirection: 'row', gap: 6, marginTop: 8, padding: 8 },
  warningText: { color: '#7c590d', flex: 1, fontSize: 8, lineHeight: 13 },
});
