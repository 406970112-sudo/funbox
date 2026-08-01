import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { fetchSSQHistory, getSSQErrorMessage } from '@/lib/double-color-ball-api';
import {
  filterSSQHistoryDraws,
  formatSSQBall,
  paginateSSQHistoryDraws,
  validateSSQHistoryFilters,
  type SSQHistoryRange,
} from '@/lib/double-color-ball-history';
import type { SSQDraw, SSQHistorySnapshot } from '@/types/double-color-ball';

const BLUE = '#3785ff';
const CORAL = '#ff5f72';
const GREEN = '#20ad78';
const INDIGO = '#151b3b';
const PAGE_SIZE = 30;
const ranges: readonly SSQHistoryRange[] = [30, 100, 400];

type LoadState = 'error' | 'loading' | 'ready';
type FilterInput = { endDate: string; issue: string; startDate: string };

const emptyFilters: FilterInput = { endDate: '', issue: '', startDate: '' };

export function DoubleColorBallHistoryScreen() {
  const router = useRouter();
  const { colorScheme, colors } = useAppTheme();
  const dark = colorScheme === 'dark';
  const pageSurface = dark ? colors.background : '#f7f9fe';
  const [appliedFilters, setAppliedFilters] = useState<FilterInput>(emptyFilters);
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [issue, setIssue] = useState('');
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [message, setMessage] = useState('');
  const [range, setRange] = useState<SSQHistoryRange>(30);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDraw, setSelectedDraw] = useState<SSQDraw | null>(null);
  const [snapshot, setSnapshot] = useState<SSQHistorySnapshot | null>(null);
  const [startDate, setStartDate] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const requestRef = useRef<AbortController | null>(null);
  const scrollOffsetRef = useRef(0);
  const scrollRef = useRef<ScrollView>(null);
  const snapshotRef = useRef<SSQHistorySnapshot | null>(null);

  const loadHistory = useCallback(async (initial: boolean) => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoadState('loading');
    else setRefreshing(true);
    setMessage('');

    try {
      const nextSnapshot = await fetchSSQHistory(controller.signal);
      if (controller.signal.aborted) return;
      snapshotRef.current = nextSnapshot;
      setSnapshot(nextSnapshot);
      setError(null);
      setLoadState('ready');
    } catch (nextError) {
      if (controller.signal.aborted) return;
      if (snapshotRef.current) setMessage(getSSQErrorMessage(nextError));
      else {
        setError(nextError);
        setLoadState('error');
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadHistory(true);
    return () => requestRef.current?.abort();
  }, [loadHistory]);

  const filteredDraws = useMemo(
    () => snapshot ? filterSSQHistoryDraws(snapshot.draws, { ...appliedFilters, range }) : [],
    [appliedFilters, range, snapshot],
  );
  const page = useMemo(
    () => paginateSSQHistoryDraws(filteredDraws, visibleCount),
    [filteredDraws, visibleCount],
  );

  function handleSearch() {
    const nextFilters = {
      endDate: endDate.trim(),
      issue: issue.trim(),
      startDate: startDate.trim(),
    };
    const validationMessage = validateSSQHistoryFilters(nextFilters);
    if (validationMessage) {
      setMessage(validationMessage);
      return;
    }
    setAppliedFilters(nextFilters);
    setMessage('');
    setVisibleCount(PAGE_SIZE);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: true, y: 215 }));
  }

  function handleReset() {
    setIssue('');
    setStartDate('');
    setEndDate('');
    setAppliedFilters(emptyFilters);
    setMessage('');
    setVisibleCount(PAGE_SIZE);
  }

  function handleRangeChange(nextRange: SSQHistoryRange) {
    setRange(nextRange);
    setVisibleCount(PAGE_SIZE);
    setMessage('');
  }

  function openDetail(draw: SSQDraw) {
    setSelectedDraw(draw);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ animated: false, y: 0 }));
  }

  function handleBack() {
    if (selectedDraw) {
      setSelectedDraw(null);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ animated: false, y: scrollOffsetRef.current });
      });
      return;
    }
    router.back();
  }

  const header = (
    <View style={[styles.header, { borderBottomColor: colors.line }]}>
      <Pressable
        accessibilityLabel={selectedDraw ? '返回开奖记录列表' : '返回双色球功能选择'}
        accessibilityRole="button"
        hitSlop={10}
        onPress={handleBack}
        style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="chevron-left" size={29} color={colors.text} />
      </Pressable>
      <ThemedText style={styles.headerTitle}>
        {selectedDraw ? `第 ${selectedDraw.issue} 期` : '历史开奖记录'}
      </ThemedText>
      <View style={styles.headerSlot} />
    </View>
  );

  if (loadState === 'loading') {
    return (
      <ScreenShell background={pageSurface} dark={dark} header={header}>
        <View style={styles.centerState}>
          <ActivityIndicator color={GREEN} size="large" />
          <ThemedText style={styles.stateTitle}>正在同步官方开奖记录</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>请稍候，数据校验完成后即可查询</ThemedText>
        </View>
      </ScreenShell>
    );
  }

  if (loadState === 'error' || !snapshot) {
    return (
      <ScreenShell background={pageSurface} dark={dark} header={header}>
        <View style={styles.centerState}>
          <View style={[styles.stateIcon, { backgroundColor: dark ? '#3a2026' : '#fff0f2' }]}>
            <MaterialCommunityIcons name="database-alert-outline" size={30} color={CORAL} />
          </View>
          <ThemedText style={styles.stateTitle}>暂时无法加载开奖记录</ThemedText>
          <ThemedText style={[styles.stateText, { color: colors.mutedText }]}>{getSSQErrorMessage(error)}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={() => void loadHistory(true)}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="refresh" size={18} color="#ffffff" />
            <ThemedText style={styles.retryText}>重新加载</ThemedText>
          </Pressable>
        </View>
      </ScreenShell>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
        {header}
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          onScroll={(event) => {
            if (!selectedDraw) scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
          }}
          refreshControl={
            selectedDraw ? undefined : (
              <RefreshControl
                colors={[GREEN]}
                onRefresh={() => void loadHistory(false)}
                refreshing={refreshing}
                tintColor={GREEN}
              />
            )
          }
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}>
          {selectedDraw ? (
            <DrawDetail draw={selectedDraw} sourceUrl={snapshot.sourceUrl} />
          ) : (
            <>
              <HistoryHero snapshot={snapshot} />
              {snapshot.stale ? (
                <Notice
                  color="#d79600"
                  icon="clock-alert-outline"
                  text="当前展示最近一次成功同步的数据，官方数据恢复后可下拉刷新。"
                />
              ) : null}
              {message ? <Notice color={CORAL} icon="alert-circle-outline" text={message} /> : null}

              <View style={[styles.filterCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                <View style={styles.sectionHeading}>
                  <View>
                    <ThemedText style={styles.sectionTitle}>查询条件</ThemedText>
                    <ThemedText style={[styles.sectionSub, { color: colors.mutedText }]}>期号与日期可组合筛选</ThemedText>
                  </View>
                  {(appliedFilters.issue || appliedFilters.startDate || appliedFilters.endDate) ? (
                    <Pressable accessibilityRole="button" onPress={handleReset}>
                      <ThemedText style={styles.resetText}>清空</ThemedText>
                    </Pressable>
                  ) : null}
                </View>

                <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>期号</ThemedText>
                <TextInput
                  accessibilityLabel="开奖期号"
                  keyboardType="number-pad"
                  maxLength={12}
                  onChangeText={setIssue}
                  onSubmitEditing={handleSearch}
                  placeholder="例如 2026085"
                  placeholderTextColor={colors.mutedText}
                  style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                  value={issue}
                />

                <View style={styles.dateRow}>
                  <View style={styles.dateField}>
                    <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>开始日期</ThemedText>
                    <TextInput
                      accessibilityLabel="开始日期"
                      autoCapitalize="none"
                      maxLength={10}
                      onChangeText={setStartDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.mutedText}
                      style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                      value={startDate}
                    />
                  </View>
                  <View style={styles.dateField}>
                    <ThemedText style={[styles.fieldLabel, { color: colors.mutedText }]}>结束日期</ThemedText>
                    <TextInput
                      accessibilityLabel="结束日期"
                      autoCapitalize="none"
                      maxLength={10}
                      onChangeText={setEndDate}
                      placeholder="YYYY-MM-DD"
                      placeholderTextColor={colors.mutedText}
                      style={[styles.input, { backgroundColor: colors.surfaceMuted, borderColor: colors.line, color: colors.text }]}
                      value={endDate}
                    />
                  </View>
                </View>
                <Pressable
                  accessibilityLabel="查询开奖记录"
                  accessibilityRole="button"
                  onPress={handleSearch}
                  style={({ pressed }) => [styles.searchButton, pressed && styles.pressed]}>
                  <MaterialCommunityIcons name="magnify" size={18} color="#ffffff" />
                  <ThemedText style={styles.searchText}>查询开奖记录</ThemedText>
                </Pressable>
              </View>

              <View style={styles.resultHeader}>
                <View>
                  <ThemedText style={styles.sectionTitle}>开奖记录</ThemedText>
                  <ThemedText style={[styles.sectionSub, { color: colors.mutedText }]}>找到 {filteredDraws.length} 期</ThemedText>
                </View>
                <View style={[styles.segment, { backgroundColor: colors.surfaceMuted }]}>
                  {ranges.map((item) => (
                    <Pressable
                      accessibilityLabel={`查看近 ${item} 期`}
                      accessibilityRole="button"
                      key={item}
                      onPress={() => handleRangeChange(item)}
                      style={[styles.segmentItem, range === item && styles.segmentItemActive]}>
                      <ThemedText style={[styles.segmentText, range === item && styles.segmentTextActive]}>{item}期</ThemedText>
                    </Pressable>
                  ))}
                </View>
              </View>

              {page.items.length ? page.items.map((draw) => (
                <DrawRow draw={draw} key={draw.issue} onPress={() => openDetail(draw)} />
              )) : (
                <View style={[styles.emptyState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
                  <MaterialCommunityIcons name="calendar-remove-outline" size={30} color={colors.mutedText} />
                  <ThemedText style={styles.emptyTitle}>没有匹配的开奖记录</ThemedText>
                  <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>请调整期号、日期或查询范围</ThemedText>
                </View>
              )}

              {page.hasMore ? (
                <Pressable
                  accessibilityLabel="加载更多开奖记录"
                  accessibilityRole="button"
                  onPress={() => setVisibleCount((current) => current + PAGE_SIZE)}
                  style={({ pressed }) => [
                    styles.loadMore,
                    { backgroundColor: colors.surface, borderColor: colors.line },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText style={styles.loadMoreText}>加载更多</ThemedText>
                  <MaterialCommunityIcons name="chevron-down" size={18} color={GREEN} />
                </Pressable>
              ) : null}

              <Notice
                color={BLUE}
                icon="information-outline"
                text="数据来源：中国福彩网。开奖记录仅用于事实查询，不构成任何预测或中奖保证。"
              />
            </>
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function HistoryHero({ snapshot }: { snapshot: SSQHistorySnapshot }) {
  const latest = snapshot.draws[0];
  return (
    <View style={styles.hero}>
      <ThemedText style={styles.heroMeta}>中国福彩网 · 官方开奖记录</ThemedText>
      <ThemedText style={styles.heroTitle}>历史开奖，一查即得</ThemedText>
      <ThemedText style={styles.heroSub}>支持按期号或日期筛选，点击任一期查看完整号码。</ThemedText>
      <View style={styles.heroStats}>
        <View style={styles.heroStat}>
          <ThemedText style={styles.heroStatLabel}>最新期号</ThemedText>
          <ThemedText style={styles.heroStatValue}>{latest?.issue ?? '--'}</ThemedText>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStat}>
          <ThemedText style={styles.heroStatLabel}>已同步</ThemedText>
          <ThemedText style={styles.heroStatValue}>{snapshot.draws.length} 期</ThemedText>
        </View>
        <View style={styles.heroDivider} />
        <View style={styles.heroStat}>
          <ThemedText style={styles.heroStatLabel}>更新时间</ThemedText>
          <ThemedText style={styles.heroStatValue}>{formatFetchedAt(snapshot.fetchedAt)}</ThemedText>
        </View>
      </View>
    </View>
  );
}

function DrawRow({ draw, onPress }: { draw: SSQDraw; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityHint="查看本期完整开奖记录"
      accessibilityLabel={`第 ${draw.issue} 期，开奖日期 ${draw.date}`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.drawCard,
        { backgroundColor: colors.surface, borderColor: colors.line },
        pressed && styles.pressed,
      ]}>
      <View style={styles.drawTop}>
        <View>
          <ThemedText style={styles.drawIssue}>第 {draw.issue} 期</ThemedText>
          <ThemedText style={[styles.drawDate, { color: colors.mutedText }]}>{draw.date}</ThemedText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={21} color={colors.mutedText} />
      </View>
      <BallRow draw={draw} />
    </Pressable>
  );
}

function DrawDetail({ draw, sourceUrl }: { draw: SSQDraw; sourceUrl: string }) {
  const { colors } = useAppTheme();
  return (
    <>
      <View style={styles.detailHero}>
        <View style={styles.detailIcon}>
          <MaterialCommunityIcons name="calendar-check-outline" size={26} color={GREEN} />
        </View>
        <ThemedText style={styles.detailEyebrow}>双色球开奖记录</ThemedText>
        <ThemedText style={styles.detailTitle}>第 {draw.issue} 期</ThemedText>
        <ThemedText style={styles.detailDate}>开奖日期 {draw.date}</ThemedText>
      </View>
      <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <ThemedText style={styles.detailCardTitle}>开奖号码</ThemedText>
        <BallRow draw={draw} large />
        <View style={[styles.legend, { borderTopColor: colors.line }]}>
          <View style={styles.legendItem}><View style={styles.redDot} /><ThemedText style={[styles.legendText, { color: colors.mutedText }]}>红球 6 个</ThemedText></View>
          <View style={styles.legendItem}><View style={styles.blueDot} /><ThemedText style={[styles.legendText, { color: colors.mutedText }]}>蓝球 1 个</ThemedText></View>
        </View>
      </View>
      <View style={[styles.sourceCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-check-outline" size={20} color={GREEN} />
        <View style={styles.sourceCopy}>
          <ThemedText style={styles.sourceTitle}>数据来源已核验</ThemedText>
          <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>中国福彩网官方开奖记录</ThemedText>
          <ThemedText numberOfLines={1} style={[styles.sourceUrl, { color: colors.mutedText }]}>{sourceUrl}</ThemedText>
        </View>
      </View>
      <Notice color={BLUE} icon="information-outline" text="开奖记录仅用于事实查询，不构成任何预测或中奖保证。" />
    </>
  );
}

function BallRow({ draw, large = false }: { draw: SSQDraw; large?: boolean }) {
  return (
    <View style={[styles.ballRow, large && styles.ballRowLarge]}>
      {draw.red.map((number) => (
        <View key={number} style={[styles.ball, large && styles.ballLarge, styles.redBall]}>
          <ThemedText style={[styles.ballText, large && styles.ballTextLarge]}>{formatSSQBall(number)}</ThemedText>
        </View>
      ))}
      <View style={[styles.ball, large && styles.ballLarge, styles.blueBall]}>
        <ThemedText style={[styles.ballText, large && styles.ballTextLarge]}>{formatSSQBall(draw.blue)}</ThemedText>
      </View>
    </View>
  );
}

function Notice({ color, icon, text }: { color: string; icon: 'alert-circle-outline' | 'clock-alert-outline' | 'information-outline'; text: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.notice, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <ThemedText style={[styles.noticeText, { color: colors.mutedText }]}>{text}</ThemedText>
    </View>
  );
}

function ScreenShell({ background, children, dark, header }: { background: string; children: ReactNode; dark: boolean; header: ReactNode }) {
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

function formatFetchedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  ball: { alignItems: 'center', borderRadius: 999, height: 30, justifyContent: 'center', width: 30 },
  ballLarge: { height: 37, width: 37 },
  ballRow: { flexDirection: 'row', gap: 5, marginTop: 12 },
  ballRowLarge: { gap: 7, justifyContent: 'center', marginTop: 22 },
  ballText: { color: '#ffffff', fontSize: 10, fontWeight: '900', lineHeight: 14 },
  ballTextLarge: { fontSize: 12, lineHeight: 16 },
  blueBall: { backgroundColor: BLUE },
  blueDot: { backgroundColor: BLUE, borderRadius: 999, height: 8, width: 8 },
  centerState: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingHorizontal: 34 },
  dateField: { flex: 1 },
  dateRow: { flexDirection: 'row', gap: 10 },
  detailCard: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 18 },
  detailCardTitle: { fontSize: 14, fontWeight: '900', lineHeight: 20, textAlign: 'center' },
  detailDate: { color: '#b7c2df', fontSize: 11, lineHeight: 17, marginTop: 5 },
  detailEyebrow: { color: '#aab5d6', fontSize: 9, fontWeight: '800', lineHeight: 14, marginTop: 10 },
  detailHero: { alignItems: 'center', backgroundColor: INDIGO, borderRadius: 12, marginTop: 12, padding: 22 },
  detailIcon: { alignItems: 'center', backgroundColor: '#e2f6ee', borderRadius: 12, height: 48, justifyContent: 'center', width: 48 },
  detailTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', lineHeight: 31, marginTop: 5 },
  drawCard: { borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 14 },
  drawDate: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  drawIssue: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  drawTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  emptyState: { alignItems: 'center', borderRadius: 12, borderWidth: 1, marginTop: 10, padding: 28 },
  emptyText: { fontSize: 10, lineHeight: 16, marginTop: 4 },
  emptyTitle: { fontSize: 13, fontWeight: '900', lineHeight: 19, marginTop: 10 },
  fieldLabel: { fontSize: 10, fontWeight: '800', lineHeight: 15, marginBottom: 5, marginTop: 12 },
  filterCard: { borderRadius: 12, borderWidth: 1, marginTop: 12, padding: 14 },
  header: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', height: 57, justifyContent: 'space-between', paddingHorizontal: 12 },
  headerSlot: { height: 38, width: 38 },
  headerTitle: { fontSize: 16, fontWeight: '900', lineHeight: 22 },
  hero: { backgroundColor: INDIGO, borderRadius: 12, marginTop: 12, padding: 18 },
  heroDivider: { backgroundColor: '#394264', height: 27, width: 1 },
  heroMeta: { color: '#aab5d6', fontSize: 9, fontWeight: '800', lineHeight: 14 },
  heroStat: { alignItems: 'center', flex: 1 },
  heroStatLabel: { color: '#9eabc8', fontSize: 8, lineHeight: 12 },
  heroStatValue: { color: '#ffffff', fontSize: 10, fontWeight: '900', lineHeight: 15, marginTop: 3 },
  heroStats: { alignItems: 'center', backgroundColor: '#20284c', borderRadius: 8, flexDirection: 'row', marginTop: 16, paddingVertical: 10 },
  heroSub: { color: '#b7c2df', fontSize: 10, lineHeight: 16, marginTop: 5 },
  heroTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', lineHeight: 30, marginTop: 6 },
  iconButton: { alignItems: 'center', height: 38, justifyContent: 'center', width: 38 },
  input: { borderRadius: 8, borderWidth: 1, fontSize: 12, height: 40, paddingHorizontal: 11 },
  legend: { borderTopWidth: 1, flexDirection: 'row', gap: 18, justifyContent: 'center', marginTop: 22, paddingTop: 14 },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 6 },
  legendText: { fontSize: 9, lineHeight: 14 },
  loadMore: { alignItems: 'center', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 5, height: 40, justifyContent: 'center', marginTop: 12 },
  loadMoreText: { color: GREEN, fontSize: 11, fontWeight: '900', lineHeight: 16 },
  notice: { alignItems: 'flex-start', borderRadius: 8, borderWidth: 1, flexDirection: 'row', gap: 8, marginTop: 12, padding: 11 },
  noticeText: { flex: 1, fontSize: 9, lineHeight: 15 },
  pressed: { opacity: 0.76 },
  redBall: { backgroundColor: CORAL },
  redDot: { backgroundColor: CORAL, borderRadius: 999, height: 8, width: 8 },
  resetText: { color: GREEN, fontSize: 10, fontWeight: '900', lineHeight: 15 },
  resultHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginTop: 18 },
  retryButton: { alignItems: 'center', backgroundColor: GREEN, borderRadius: 8, flexDirection: 'row', gap: 6, height: 40, justifyContent: 'center', marginTop: 18, paddingHorizontal: 18 },
  retryText: { color: '#ffffff', fontSize: 11, fontWeight: '900', lineHeight: 16 },
  safeArea: { flex: 1 },
  screenShell: { alignSelf: 'center', flex: 1, maxWidth: appLayout.screenMaxWidth, overflow: 'hidden', width: '100%' },
  scrollContent: { paddingBottom: 24, paddingHorizontal: 14, paddingTop: 8 },
  searchButton: { alignItems: 'center', backgroundColor: GREEN, borderRadius: 8, flexDirection: 'row', gap: 6, height: 40, justifyContent: 'center', marginTop: 14 },
  searchText: { color: '#ffffff', fontSize: 11, fontWeight: '900', lineHeight: 16 },
  sectionHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  sectionSub: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  sectionTitle: { fontSize: 14, fontWeight: '900', lineHeight: 19 },
  segment: { borderRadius: 8, flexDirection: 'row', padding: 2 },
  segmentItem: { alignItems: 'center', borderRadius: 6, height: 27, justifyContent: 'center', paddingHorizontal: 8 },
  segmentItemActive: { backgroundColor: GREEN },
  segmentText: { fontSize: 9, fontWeight: '800', lineHeight: 13 },
  segmentTextActive: { color: '#ffffff' },
  sourceCard: { alignItems: 'flex-start', borderRadius: 12, borderWidth: 1, flexDirection: 'row', gap: 11, marginTop: 12, padding: 14 },
  sourceCopy: { flex: 1 },
  sourceText: { fontSize: 10, lineHeight: 16, marginTop: 2 },
  sourceTitle: { fontSize: 12, fontWeight: '900', lineHeight: 17 },
  sourceUrl: { fontSize: 8, lineHeight: 13, marginTop: 4 },
  stateIcon: { alignItems: 'center', borderRadius: 14, height: 56, justifyContent: 'center', marginBottom: 16, width: 56 },
  stateText: { fontSize: 11, lineHeight: 18, marginTop: 6, textAlign: 'center' },
  stateTitle: { fontSize: 15, fontWeight: '900', lineHeight: 21, marginTop: 16, textAlign: 'center' },
});
