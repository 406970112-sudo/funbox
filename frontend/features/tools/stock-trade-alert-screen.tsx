import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  addStockWatchBySymbol,
  addStockWatch,
  createStockReminder,
  deleteStockReminder,
  deleteStockWatch,
  fetchStockAlertEvents,
  fetchStockAlertSettings,
  fetchStockIntraday,
  fetchStockReminders,
  fetchStockWatch,
  fetchStockWatchList,
  getStockAlertErrorMessage,
  markStockAlertEventsRead,
  reanalyzeStockWatch,
  saveStockAlertSettings,
  searchStockSymbols,
  testStockPush,
  updateStockReminder,
  updateStockWatch,
} from '@/lib/stock-alert-api';
import {
  buildIntradayChartPoints,
  formatTriggerTime,
  getDirectionLabel,
  getSignalConditions,
  getSignalStatusLabel,
  getTriggerPrice,
  isAnalysisExpired,
} from '@/lib/stock-alert';
import { PageErrorState } from '@/shared/ui/page-error-state';
import { PageLoadingFrame } from '@/shared/ui/page-loading-frame';
import type {
  IntradaySnapshot,
  StockAlertEvent,
  StockAlertSettings,
  StockReminder,
  StockReminderInput,
  StockReminderRuleType,
  StockReminderType,
  StockSymbol,
  StockWatchItem,
} from '@/types/stock-alert';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type ThemeColors = ReturnType<typeof useAppTheme>['colors'];
type ViewId = 'watch' | 'events' | 'settings';

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff5d6c';
const GREEN = '#24b36b';
const AMBER = '#f1a33b';

const VIEW_TABS: { id: ViewId; label: string; icon: IconName }[] = [
  { id: 'watch', label: '自选', icon: 'star-outline' },
  { id: 'events', label: '提醒', icon: 'bell-outline' },
  { id: 'settings', label: '设置', icon: 'tune-variant' },
];

const STATUS_TONES: Record<string, string> = {
  listening: '#6b7892',
  'near-buy': AMBER,
  'buy-triggered': BLUE,
  'sell-triggered': GREEN,
  'stop-triggered': CORAL,
  expired: '#9aa3b7',
  'data-missing': '#9aa3b7',
};

export function StockTradeAlertScreen() {
  const { accessToken, status: authStatus } = useAuth();
  const { colorScheme, colors } = useAppTheme();
  const [view, setView] = useState<ViewId>('watch');
  const [query, setQuery] = useState('');
  const [searchResults, setSearchResults] = useState<StockSymbol[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [items, setItems] = useState<StockWatchItem[]>([]);
  const [events, setEvents] = useState<StockAlertEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [settings, setSettings] = useState<StockAlertSettings | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [reminderSymbol, setReminderSymbol] = useState<string | null>(null);
  const [reminders, setReminders] = useState<StockReminder[]>([]);
  const [detailReminders, setDetailReminders] = useState<StockReminder[]>([]);
  const [detail, setDetail] = useState<StockWatchItem | null>(null);
  const [intraday, setIntraday] = useState<IntradaySnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSavingReminder, setIsSavingReminder] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendKey, setSendKey] = useState('');
  const [pushMessage, setPushMessage] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ animated: false, y: 0 });
    if (typeof window !== 'undefined') window.scrollTo({ behavior: 'auto', left: 0, top: 0 });
  }, [view, selectedSymbol, reminderSymbol]);

  useEffect(() => {
    if (!accessToken) {
      setIsLoading(false);
      return;
    }
    const token = accessToken;
    const controller = new AbortController();
    async function load() {
      try {
        const [nextItems, nextEvents, nextSettings] = await Promise.all([
          fetchStockWatchList(token),
          fetchStockAlertEvents(token, 50),
          fetchStockAlertSettings(token),
        ]);
        setItems(nextItems);
        setEvents(nextEvents.events);
        setUnread(nextEvents.unread);
        setSettings(nextSettings);
        if (nextSettings.sendKeyBound) setSendKey('');
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(getStockAlertErrorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [accessToken]);

  useEffect(() => {
    if (!accessToken || view !== 'watch') return;
    const token = accessToken;
    const timer = setInterval(() => {
      fetchStockWatchList(token)
        .then(setItems)
        .catch(() => undefined);
    }, 30000);
    return () => clearInterval(timer);
  }, [accessToken, view]);

  useEffect(() => {
    if (!accessToken || !selectedSymbol) {
      setDetail(null);
      setIntraday(null);
      setDetailReminders([]);
      return;
    }
    const token = accessToken;
    const symbol = selectedSymbol;
    const controller = new AbortController();
    async function loadDetail() {
      try {
        const [nextDetail, nextIntraday, nextReminders] = await Promise.all([
          fetchStockWatch(token, symbol),
          fetchStockIntraday(token, symbol),
          fetchStockReminders(token, symbol),
        ]);
        setDetail(nextDetail);
        setIntraday(nextIntraday);
        setDetailReminders(nextReminders);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(getStockAlertErrorMessage(loadError));
      }
    }
    loadDetail();
    const timer = setInterval(() => {
      Promise.all([
        fetchStockWatch(token, symbol),
        fetchStockIntraday(token, symbol),
        fetchStockReminders(token, symbol),
      ])
        .then(([nextDetail, nextIntraday, nextReminders]) => {
          setDetail(nextDetail);
          setIntraday(nextIntraday);
          setDetailReminders(nextReminders);
        })
        .catch(() => undefined);
    }, 30000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [accessToken, selectedSymbol]);

  useEffect(() => {
    if (!accessToken || !reminderSymbol) {
      setReminders([]);
      return;
    }
    const token = accessToken;
    fetchStockReminders(token, reminderSymbol)
      .then(setReminders)
      .catch((loadError) => setError(getStockAlertErrorMessage(loadError)));
  }, [accessToken, reminderSymbol]);

  async function handleSearch() {
    const normalized = query.trim();
    if (!normalized || !accessToken) return;
    setIsSearching(true);
    setError(null);
    try {
      const candidates = await searchStockSymbols(accessToken, normalized);
      if (candidates.length === 0) {
        setError('未找到匹配标的，试试 600519 / 贵州茅台 / NVDA。');
        return;
      }
      setSearchResults(candidates);
      setShowSearchResults(true);
    } catch (analyzeError) {
      setError(getStockAlertErrorMessage(analyzeError));
    } finally {
      setIsSearching(false);
    }
  }

  async function handleAddResult(symbol: StockSymbol) {
    if (!accessToken) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const item = await addStockWatchBySymbol(accessToken, symbol);
      setItems((current) => [item, ...current.filter((entry) => entry.symbolCode !== item.symbolCode)]);
      setShowSearchResults(false);
      setQuery('');
      setView('watch');
    } catch (addError) {
      setError(getStockAlertErrorMessage(addError));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleRefresh() {
    if (!accessToken) return;
    setIsRefreshing(true);
    setError(null);
    try {
      const [nextItems, nextEvents] = await Promise.all([
        fetchStockWatchList(accessToken),
        fetchStockAlertEvents(accessToken, 50),
      ]);
      setItems(nextItems);
      setEvents(nextEvents.events);
      setUnread(nextEvents.unread);
    } catch (refreshError) {
      setError(getStockAlertErrorMessage(refreshError));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleToggleWatch(item: StockWatchItem) {
    if (!accessToken) return;
    try {
      const next = await updateStockWatch(accessToken, item.symbolCode, { enabled: !item.enabled });
      setItems((current) => current.map((entry) => (entry.symbolCode === next.symbolCode ? next : entry)));
      if (selectedSymbol === next.symbolCode) setDetail(next);
    } catch (toggleError) {
      setError(getStockAlertErrorMessage(toggleError));
    }
  }

  async function handleReanalyze() {
    if (!accessToken || !selectedSymbol) return;
    setIsAnalyzing(true);
    setError(null);
    try {
      const next = await reanalyzeStockWatch(accessToken, selectedSymbol);
      setDetail(next);
      setItems((current) => current.map((entry) => (entry.symbolCode === next.symbolCode ? next : entry)));
    } catch (reanalyzeError) {
      setError(getStockAlertErrorMessage(reanalyzeError));
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleDelete() {
    if (!accessToken || !selectedSymbol) return;
    try {
      await deleteStockWatch(accessToken, selectedSymbol);
      setItems((current) => current.filter((entry) => entry.symbolCode !== selectedSymbol));
      setSelectedSymbol(null);
    } catch (deleteError) {
      setError(getStockAlertErrorMessage(deleteError));
    }
  }

  async function handleMarkRead() {
    if (!accessToken) return;
    try {
      await markStockAlertEventsRead(accessToken, events.filter((event) => !event.readAt).map((event) => event.id));
      setEvents((current) => current.map((event) => ({ ...event, readAt: event.readAt ?? new Date().toISOString() })));
      setUnread(0);
    } catch (readError) {
      setError(getStockAlertErrorMessage(readError));
    }
  }

  async function handleSaveSettings() {
    if (!accessToken) return;
    setError(null);
    setPushMessage(null);
    try {
      const next = await saveStockAlertSettings(accessToken, {
        sendKey: sendKey.trim(),
        reminderEnabled: settings?.reminderEnabled ?? true,
      });
      setSettings(next);
      setSendKey('');
      setPushMessage('SendKey 已保存，仅服务端保留加密值。');
    } catch (settingsError) {
      setError(getStockAlertErrorMessage(settingsError));
    }
  }

  async function handleTestPush() {
    if (!accessToken) return;
    setError(null);
    setPushMessage(null);
    try {
      const result = await testStockPush(accessToken);
      setPushMessage(`测试推送完成：code ${result.code} ${result.message}`);
    } catch (pushError) {
      setError(getStockAlertErrorMessage(pushError));
    }
  }

  async function handleSaveReminder(input: StockReminderInput, editingId?: string) {
    if (!accessToken || !reminderSymbol) return;
    setIsSavingReminder(true);
    setError(null);
    try {
      const saved = editingId
        ? await updateStockReminder(accessToken, editingId, input)
        : await createStockReminder(accessToken, reminderSymbol, input);
      setReminders((current) => editingId
        ? current.map((item) => (item.id === saved.id ? saved : item))
        : [saved, ...current]);
    } catch (saveError) {
      setError(getStockAlertErrorMessage(saveError));
    } finally {
      setIsSavingReminder(false);
    }
  }

  async function handleToggleReminder(reminder: StockReminder) {
    if (!accessToken) return;
    setError(null);
    try {
      const saved = await updateStockReminder(accessToken, reminder.id, {
        ruleType: reminder.ruleType,
        direction: reminder.direction,
        threshold: reminder.threshold,
        timeRange: reminder.timeRange,
        validDays: reminder.validDays,
        channels: reminder.channels,
        enabled: !reminder.enabled,
      });
      setReminders((current) => current.map((item) => (item.id === saved.id ? saved : item)));
    } catch (toggleError) {
      setError(getStockAlertErrorMessage(toggleError));
    }
  }

  async function handleDeleteReminder(reminder: StockReminder) {
    if (!accessToken) return;
    setError(null);
    try {
      await deleteStockReminder(accessToken, reminder.id);
      setReminders((current) => current.filter((item) => item.id !== reminder.id));
    } catch (deleteError) {
      setError(getStockAlertErrorMessage(deleteError));
    }
  }

  if (authStatus === 'loading') {
    return <PageLoadingFrame stateLabel="正在加载提醒" title="股票交易提醒" variant="panel" />;
  }

  if (!accessToken) {
    return (
      <PageErrorState
        message="请先登录后使用股票交易提醒。"
        onRetry={() => undefined}
        title="股票交易提醒"
      />
    );
  }

  if (isLoading && !items.length) {
    return <PageLoadingFrame stateLabel="正在加载真实行情" title="股票交易提醒" variant="panel" />;
  }

  const isDark = colorScheme === 'dark';
  const pageSurface = isDark ? colors.surface : '#f8faff';

  if (reminderSymbol) {
    return (
      <ReminderConfigScreen
        colors={colors}
        error={error}
        isDark={isDark}
        isSaving={isSavingReminder}
        onBack={() => setReminderSymbol(null)}
        onDelete={handleDeleteReminder}
        onSave={handleSaveReminder}
        onToggle={handleToggleReminder}
        reminders={reminders}
        symbol={reminderSymbol}
        watchItem={items.find((item) => item.symbolCode === reminderSymbol) ?? null}
      />
    );
  }

  if (selectedSymbol) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
          <DetailHeader
            colors={colors}
            onBack={() => setSelectedSymbol(null)}
            onToggle={detail ? () => handleToggleWatch(detail) : undefined}
            symbol={detail?.symbolCode}
            name={detail?.name ?? selectedSymbol}
            enabled={detail?.enabled ?? true}
          />
          <ScrollView
            contentContainerStyle={styles.detailContent}
            ref={scrollRef}
            showsVerticalScrollIndicator={false}>
            {error ? (
              <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
                <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
                <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>{error}</ThemedText>
              </View>
            ) : null}
            <PriceHero detail={detail} intraday={intraday} isDark={isDark} colors={colors} />
            <IntradayChart intraday={intraday} isDark={isDark} colors={colors} />
            <SignalRules detail={detail} colors={colors} />
            <ReminderRulesCard
              colors={colors}
              onAddReminder={() => {
                if (detail) setReminderSymbol(detail.symbolCode);
              }}
              onDelete={handleDeleteReminder}
              onToggle={handleToggleReminder}
              reminders={detailReminders}
            />
            <SignalTimeline detail={detail} events={events} colors={colors} />
            <View style={styles.actionRow}>
              <Pressable
                onPress={handleReanalyze}
                style={({ pressed }) => [styles.actionButton, styles.primaryButton, pressed && styles.pressed]}>
                {isAnalyzing ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <MaterialCommunityIcons name="refresh" size={16} color="#fff" />
                )}
                <ThemedText style={styles.primaryButtonText}>重新分析</ThemedText>
              </Pressable>
              <Pressable
                onPress={handleDelete}
                style={({ pressed }) => [styles.actionButton, { borderColor: colors.line }, pressed && styles.pressed]}>
                <MaterialCommunityIcons name="trash-can-outline" size={16} color={colors.text} />
                <ThemedText>删除自选</ThemedText>
              </Pressable>
            </View>
            <View style={[styles.dataCard, { backgroundColor: isDark ? '#1c2440' : '#f3f6fb' }]}>
              <MaterialCommunityIcons name="database-clock-outline" size={15} color={colors.mutedText} />
              <ThemedText style={[styles.dataText, { color: colors.mutedText }]}>
                东方财富真实分时序列（trends2/get）+ 90 日复权 K 线；信号规则由 deepseek-v4-flash 生成，盘中由后端信号引擎判定。
              </ThemedText>
            </View>
            <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
              仅供信息参考，不构成投资建议
            </ThemedText>
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
          <View>
            <ThemedText style={styles.overviewTitle}>股票交易提醒</ThemedText>
            <ThemedText style={[styles.headerCaption, { color: colors.mutedText }]}>
              {isRefreshing ? '正在刷新' : '分时实时监听 · 真实数据'}
            </ThemedText>
          </View>
          <Pressable
            accessibilityLabel="刷新行情"
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

        <ViewTabs activeView={view} colors={colors} onChange={setView} unread={unread} />

        <ScrollView
          contentContainerStyle={styles.overviewContent}
          key={`stock-alert-${view}`}
          ref={scrollRef}
          showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
              <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>{error}</ThemedText>
            </View>
          ) : null}

          {view === 'watch' ? (
            <WatchView
              colors={colors}
              isDark={isDark}
              isSearching={isSearching}
              items={items}
              onAddResult={handleAddResult}
              onBackFromSearch={() => setShowSearchResults(false)}
              onSearch={handleSearch}
              onOpen={setSelectedSymbol}
              onQueryChange={setQuery}
              onSetReminder={(symbol) => setReminderSymbol(symbol)}
              onToggle={handleToggleWatch}
              query={query}
              searchResults={searchResults}
              showSearchResults={showSearchResults}
            />
          ) : null}

          {view === 'events' ? (
            <EventsView
              colors={colors}
              events={events}
              isDark={isDark}
              onMarkRead={handleMarkRead}
              onOpen={(symbol) => setSelectedSymbol(symbol)}
            />
          ) : null}

          {view === 'settings' ? (
            <SettingsView
              colors={colors}
              isDark={isDark}
              onChangeSendKey={setSendKey}
              onSave={handleSaveSettings}
              onTestPush={handleTestPush}
              pushMessage={pushMessage}
              sendKey={sendKey}
              settings={settings}
            />
          ) : null}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function ViewTabs({
  activeView,
  colors,
  onChange,
  unread,
}: {
  activeView: ViewId;
  colors: ThemeColors;
  onChange: (view: ViewId) => void;
  unread: number;
}) {
  return (
    <View style={[styles.tabs, { borderColor: colors.line }]}>
      {VIEW_TABS.map((tab) => {
        const active = tab.id === activeView;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            style={[styles.tabButton, active && { backgroundColor: colors.primary }]}>
            <MaterialCommunityIcons
              name={tab.icon}
              size={16}
              color={active ? '#fff' : colors.mutedText}
            />
            <ThemedText style={[styles.tabText, active && { color: '#fff' }]}>{tab.label}</ThemedText>
            {tab.id === 'events' && unread > 0 ? (
              <View style={styles.unreadBadge}>
                <ThemedText style={styles.unreadBadgeText}>{unread}</ThemedText>
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

function WatchView({
  colors,
  isDark,
  isSearching,
  items,
  onAddResult,
  onBackFromSearch,
  onSearch,
  onOpen,
  onQueryChange,
  onSetReminder,
  onToggle,
  query,
  searchResults,
  showSearchResults,
}: {
  colors: ThemeColors;
  isDark: boolean;
  isSearching: boolean;
  items: StockWatchItem[];
  onAddResult: (symbol: StockSymbol) => void;
  onBackFromSearch: () => void;
  onSearch: () => void;
  onOpen: (symbol: string) => void;
  onQueryChange: (value: string) => void;
  onSetReminder: (symbol: string) => void;
  onToggle: (item: StockWatchItem) => void;
  query: string;
  searchResults: StockSymbol[];
  showSearchResults: boolean;
}) {
  return (
    <>
      <View style={[styles.hero, isDark && styles.heroDark]}>
        <ThemedText style={styles.heroEyebrow}>REAL MARKET DATA</ThemedText>
        <View style={[styles.searchBox, { backgroundColor: colors.surface }]}>
          <MaterialCommunityIcons name="magnify" size={18} color={colors.mutedText} />
          <TextInput
            autoCapitalize="characters"
            onChangeText={onQueryChange}
            placeholder="输入股票代码或名称，如 600519 / 贵州茅台"
            placeholderTextColor={colors.mutedText}
            style={[styles.searchInput, { color: colors.text }]}
            value={query}
          />
          <Pressable
            onPress={onSearch}
            style={({ pressed }) => [styles.analyzeButton, pressed && styles.pressed]}>
            {isSearching ? (
              <ActivityIndicator color={HERO} size="small" />
            ) : (
              <MaterialCommunityIcons name="magnify" size={15} color={HERO} />
            )}
            <ThemedText style={styles.analyzeButtonText}>搜索</ThemedText>
          </Pressable>
        </View>
        <ThemedText style={styles.heroMeta}>真实搜索结果先确认，再加入自选配置分时提醒</ThemedText>
      </View>

      {showSearchResults ? (
        <SearchResultsView
          colors={colors}
          items={items}
          onAddResult={onAddResult}
          onBack={onBackFromSearch}
          results={searchResults}
        />
      ) : (
        <>
          <View style={styles.sectionHead}>
            <ThemedText style={styles.sectionTitle}>自选标的</ThemedText>
            <ThemedText style={[styles.sectionHint, { color: colors.mutedText }]}>
              {items.length}/10 · 选择标的设置提醒
            </ThemedText>
          </View>

          {items.length === 0 ? (
            <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="chart-timeline-variant-shimmer" size={34} color={BLUE} />
              <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>还没有自选标的</ThemedText>
              <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
                搜索真实标的后加入自选，再从自选设置分时提醒。
              </ThemedText>
            </View>
          ) : (
            <View style={[styles.watchList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {items.map((item, index) => (
                <Pressable
                  key={item.symbolCode}
                  onPress={() => onOpen(item.symbolCode)}
                  style={({ pressed }) => [
                    styles.watchRow,
                    index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
                    pressed && styles.pressed,
                  ]}>
                  <View style={styles.watchMain}>
                    <View style={styles.watchNameRow}>
                      <ThemedText style={styles.stockName}>{item.name}</ThemedText>
                      <Pressable onPress={() => onToggle(item)} style={styles.bellButton} hitSlop={8}>
                        <MaterialCommunityIcons
                          name={item.enabled ? 'bell-ring' : 'bell-off-outline'}
                          size={17}
                          color={item.enabled ? BLUE : colors.mutedText}
                        />
                      </Pressable>
                    </View>
                    <ThemedText style={[styles.stockCode, { color: colors.mutedText }]}>
                      {item.symbolCode}.{item.market} · {item.analysis ? `买入触发 ${formatPrice(item.analysis.rule.buyTrigger)}` : '等待分析'}
                    </ThemedText>
                    <StatusPill status={item.signalStatus} />
                  </View>
                  <View style={styles.watchQuote}>
                    <ThemedText style={[styles.quotePrice, { color: priceColor(item.changePct) }]}>
                      {formatPrice(item.latestPrice ?? 0)}
                    </ThemedText>
                    <ThemedText style={[styles.quoteSub, { color: colors.mutedText }]}>
                      {item.avgPrice ? `均线 ${formatPrice(item.avgPrice)}` : item.changePct != null ? `${item.changePct >= 0 ? '+' : ''}${item.changePct.toFixed(2)}%` : '--'}
                    </ThemedText>
                  </View>
                  <Pressable
                    onPress={() => onSetReminder(item.symbolCode)}
                    style={({ pressed }) => [styles.setReminderButton, pressed && styles.pressed]}>
                    <MaterialCommunityIcons name="tune-variant" size={13} color={HERO} />
                    <ThemedText style={styles.setReminderText}>设置</ThemedText>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}

      <View style={[styles.sourceLine, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="database-clock-outline" size={15} color={colors.mutedText} />
        <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>
          东方财富真实行情 · 无 mock 回退 · 仅供信息参考，不构成投资建议
        </ThemedText>
      </View>
    </>
  );
}

function SearchResultsView({
  colors,
  items,
  onAddResult,
  onBack,
  results,
}: {
  colors: ThemeColors;
  items: StockWatchItem[];
  onAddResult: (symbol: StockSymbol) => void;
  onBack: () => void;
  results: StockSymbol[];
}) {
  const inWatch = (symbol: StockSymbol) => items.some((item) => item.symbolCode === symbol.code);
  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>搜索结果 {results.length} 条</ThemedText>
        <Pressable onPress={onBack}>
          <ThemedText style={[styles.sectionHint, { color: BLUE }]}>返回自选</ThemedText>
        </Pressable>
      </View>
      <View style={[styles.watchList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {results.map((symbol, index) => {
          const added = inWatch(symbol);
          return (
            <View
              key={`${symbol.market}-${symbol.code}`}
              style={[
                styles.searchRow,
                index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
              ]}>
              <View style={styles.watchMain}>
                <ThemedText style={styles.stockName}>{symbol.name}</ThemedText>
                <ThemedText style={[styles.stockCode, { color: colors.mutedText }]}>
                  {symbol.code} · {symbol.market} · {symbol.typeName || symbol.region}
                </ThemedText>
                <View style={styles.tagRow}>
                  <View style={[styles.tagPill, { backgroundColor: symbol.tradable ? '#e7ecff' : '#fff3e2' }]}>
                    <ThemedText style={[styles.tagPillText, { color: symbol.tradable ? BLUE : '#b06d14' }]}>
                      {symbol.tradable ? '股票' : symbol.typeName || '其他'}
                    </ThemedText>
                  </View>
                </View>
              </View>
              <View style={styles.searchResultRight}>
                {symbol.latestPrice != null ? (
                  <>
                    <ThemedText style={[styles.quotePrice, { color: priceColor(symbol.changePct) }]}>
                      {formatPrice(symbol.latestPrice)}
                    </ThemedText>
                    <ThemedText style={[styles.quoteSub, { color: colors.mutedText }]}>
                      {symbol.changePct != null ? `${symbol.changePct >= 0 ? '+' : ''}${symbol.changePct.toFixed(2)}%` : '--'}
                    </ThemedText>
                  </>
                ) : (
                  <ThemedText style={[styles.stockCode, { color: colors.mutedText }]}>--</ThemedText>
                )}
                <Pressable
                  disabled={!symbol.tradable || added}
                  onPress={() => onAddResult(symbol)}
                  style={({ pressed }) => [
                    styles.addResultButton,
                    added && styles.addResultAdded,
                    (!symbol.tradable || added) && { opacity: 0.65 },
                    pressed && styles.pressed,
                  ]}>
                  <MaterialCommunityIcons
                    name={added ? 'check' : symbol.tradable ? 'plus' : 'close-circle-outline'}
                    size={13}
                    color={added ? '#2e8f62' : symbol.tradable ? BLUE : '#9aa3b7'}
                  />
                  <ThemedText
                    style={[
                      styles.addResultText,
                      { color: added ? '#2e8f62' : symbol.tradable ? BLUE : '#9aa3b7' },
                    ]}>
                    {added ? '已在自选' : symbol.tradable ? '加入自选' : '不可加入'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
      <View style={[styles.sourceLine, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="database-clock-outline" size={15} color={colors.mutedText} />
        <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>
          东方财富 suggest 真实标的口径 · 行情为真实快照 · 仅供信息参考
        </ThemedText>
      </View>
    </>
  );
}

function PriceHero({
  detail,
  intraday,
  isDark,
  colors,
}: {
  detail: StockWatchItem | null;
  intraday: IntradaySnapshot | null;
  isDark: boolean;
  colors: ThemeColors;
}) {
  const price = detail?.latestPrice ?? intraday?.latest.price ?? 0;
  const change = detail?.changePct ?? 0;
  const avg = detail?.avgPrice ?? intraday?.latest.avgPrice ?? 0;
  return (
    <View style={[styles.priceHero, isDark && styles.priceHeroDark]}>
      <View style={styles.liveBadge}>
        <View style={styles.liveDot} />
        <ThemedText style={styles.liveText}>
          实时监听中 · {intraday ? formatTriggerTime(intraday.fetchedAt).slice(6) : '等待分时'}
        </ThemedText>
      </View>
      <View style={styles.priceLine}>
        <ThemedText style={styles.priceStrong}>{formatPrice(price)}</ThemedText>
        <ThemedText style={[styles.priceChange, { color: priceColor(change) }]}>
          {change >= 0 ? '+' : ''}{change.toFixed(2)}%
        </ThemedText>
      </View>
      <View style={styles.priceGrid}>
        <PriceCell label="分时均价" value={formatPrice(avg)} />
        <PriceCell label="信号状态" value={getSignalStatusLabel(detail?.signalStatus ?? 'data-missing')} />
        <PriceCell label="买入触发" value={detail?.analysis ? formatPrice(detail.analysis.rule.buyTrigger) : '--'} />
        <PriceCell label="止损触发" value={detail?.analysis ? formatPrice(detail.analysis.rule.stopLoss) : '--'} />
      </View>
    </View>
  );
}

function PriceCell({ label, value }: { label: string; value: string }) {
  return (
    <View>
      <ThemedText style={styles.priceCellLabel}>{label}</ThemedText>
      <ThemedText style={styles.priceCellValue}>{value}</ThemedText>
    </View>
  );
}

function IntradayChart({
  intraday,
  isDark,
  colors,
}: {
  intraday: IntradaySnapshot | null;
  isDark: boolean;
  colors: ThemeColors;
}) {
  const width = 354;
  const height = 142;
  const points = buildIntradayChartPoints(intraday?.points ?? [], width - 12, height - 24).map((point) => ({
    x: point.x + 6,
    y: point.y + 8,
  }));
  const avgPoints = buildIntradayChartPoints(
    (intraday?.points ?? []).map((point) => ({ price: point.avgPrice || point.price })),
    width - 12,
    height - 24,
  ).map((point) => ({ x: point.x + 6, y: point.y + 8 }));
  const gridColor = isDark ? '#2b3557' : '#e9edf5';
  const finalPoint = points.at(-1);

  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>今日分时 · 真实分时序列</ThemedText>
        <ThemedText style={[styles.sectionHint, { color: colors.mutedText }]}>
          最近刷新 · 10 秒轮询
        </ThemedText>
      </View>
      <View style={[styles.chartCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.chartLegend}>
          <LegendItem color="#4b6bff" label="分时价" />
          <LegendItem color={AMBER} label="分时均价" />
        </View>
        <Svg
          accessibilityLabel="当日真实分时图"
          height={height}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
          width="100%">
          {[24, 63, 102].map((y) => (
            <Line key={y} stroke={gridColor} strokeWidth={1} x1={0} x2={width} y1={y} y2={y} />
          ))}
          {avgPoints.length > 1 ? (
            <Polyline
              fill="none"
              points={avgPoints.map((point) => `${point.x},${point.y}`).join(' ')}
              stroke={AMBER}
              strokeDasharray="4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
            />
          ) : null}
          {points.length > 1 ? (
            <Polyline
              fill="none"
              points={points.map((point) => `${point.x},${point.y}`).join(' ')}
              stroke={BLUE}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.6}
            />
          ) : null}
          {finalPoint ? <Circle cx={finalPoint.x} cy={finalPoint.y} fill={BLUE} r={4} /> : null}
        </Svg>
        <View style={styles.axisLabels}>
          {['09:30', '10:30', '11:30', '13:00', '14:00', '15:00'].map((label) => (
            <ThemedText key={label} style={[styles.axisText, { color: colors.mutedText }]}>{label}</ThemedText>
          ))}
        </View>
      </View>
    </>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendLine, { backgroundColor: color }]} />
      <ThemedText style={styles.legendText}>{label}</ThemedText>
    </View>
  );
}

function SignalRules({ detail, colors }: { detail: StockWatchItem | null; colors: ThemeColors }) {
  const rule = detail?.analysis?.rule;
  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>今日信号规则</ThemedText>
        <ThemedText style={[styles.sectionHint, { color: colors.mutedText }]}>
          DeepSeek-V4-Flash · {detail?.analysis?.dataEndDate ?? '--'}
        </ThemedText>
      </View>
      <View style={[styles.aiCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.aiHead}>
          <ThemedText style={styles.aiHeadTitle}>deepseek-v4-flash 信号规则</ThemedText>
          <ThemedText style={styles.aiHeadBadge}>有效期 5 个交易日</ThemedText>
        </View>
        <View style={styles.zoneGrid}>
          <ZoneCell color={BLUE} label="买入信号" value={rule ? formatPrice(rule.buyTrigger) : '--'} note="站稳 + 均线上方 + 量比≥1.1" />
          <ZoneCell color={GREEN} label="卖出信号" value={rule ? formatPrice(rule.sellTrigger) : '--'} note="放量突破 + 涨速确认" />
          <ZoneCell color={CORAL} label="止损信号" value={rule ? formatPrice(rule.stopLoss) : '--'} note="分时价跌破即触发" />
        </View>
      </View>
    </>
  );
}

function ZoneCell({ color, label, value, note }: { color: string; label: string; value: string; note: string }) {
  return (
    <View style={styles.zoneCell}>
      <ThemedText style={styles.zoneLabel}>{label}</ThemedText>
      <ThemedText style={[styles.zoneValue, { color }]}>{value}</ThemedText>
      <ThemedText style={styles.zoneNote}>{note}</ThemedText>
    </View>
  );
}

function ReminderRulesCard({
  colors,
  onAddReminder,
  onDelete,
  onToggle,
  reminders,
}: {
  colors: ThemeColors;
  onAddReminder: () => void;
  onDelete: (reminder: StockReminder) => void;
  onToggle: (reminder: StockReminder) => void;
  reminders: StockReminder[];
}) {
  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>当前提醒规则</ThemedText>
        <Pressable onPress={onAddReminder}>
          <ThemedText style={[styles.sectionHint, { color: BLUE }]}>+ 新建</ThemedText>
        </Pressable>
      </View>
      {reminders.length === 0 ? (
        <View style={[styles.emptyLine, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="bell-plus-outline" size={20} color={colors.mutedText} />
          <ThemedText style={[styles.emptyLineText, { color: colors.mutedText }]}>
            暂无自定义提醒，从自选选择股票后设置价格、涨跌幅、均线、量能或 AI 信号。
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.eventList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {reminders.map((reminder, index) => (
            <View
              key={reminder.id}
              style={[
                styles.ruleRow,
                index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
              ]}>
              <View style={styles.ruleCopy}>
                <ThemedText style={styles.ruleTitle}>{getReminderLabel(reminder)}</ThemedText>
                <ThemedText style={[styles.ruleMeta, { color: colors.mutedText }]}>
                  {reminder.timeRange} · {reminder.validDays} 个交易日 · {reminder.channels.includes('serverchan') ? '站内+微信' : '站内'}
                </ThemedText>
              </View>
              <View style={styles.ruleActions}>
                <Pressable onPress={() => onToggle(reminder)} style={styles.iconBtnSmall}>
                  <MaterialCommunityIcons
                    name={reminder.enabled ? 'bell-ring' : 'bell-off-outline'}
                    size={14}
                    color={reminder.enabled ? BLUE : colors.mutedText}
                  />
                </Pressable>
                <Pressable onPress={() => onDelete(reminder)} style={styles.iconBtnSmall}>
                  <MaterialCommunityIcons name="trash-can-outline" size={14} color={CORAL} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

function SignalTimeline({
  detail,
  events,
  colors,
}: {
  detail: StockWatchItem | null;
  events: StockAlertEvent[];
  colors: ThemeColors;
}) {
  const symbolEvents = detail
    ? events.filter((event) => event.symbolCode === detail.symbolCode)
    : [];
  return (
    <>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>分时信号时间线</ThemedText>
        <ThemedText style={[styles.sectionHint, { color: colors.mutedText }]}>
          观察/确认信号可追溯
        </ThemedText>
      </View>
      {symbolEvents.length === 0 ? (
        <View style={[styles.emptyLine, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="timeline-clock-outline" size={20} color={colors.mutedText} />
          <ThemedText style={[styles.emptyLineText, { color: colors.mutedText }]}>
            暂无信号记录，触发后这里会展示精确时刻与价格。
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.eventList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {symbolEvents.slice(0, 5).map((event, index) => (
            <View key={event.id} style={[styles.eventRow, index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth }]}>
              <View style={styles.eventHead}>
                <ThemedText style={styles.eventTitle}>
                  {formatTriggerTime(event.triggerTime)} · {event.signalStrength === 'confirmed' ? '确认信号' : '观察信号'}
                </ThemedText>
                <View style={[styles.pushPill, { backgroundColor: event.pushed ? '#e7f6ef' : '#e7ecff' }]}>
                  <ThemedText style={[styles.pushPillText, { color: event.pushed ? '#2e8f62' : BLUE }]}>
                    {getDirectionLabel(event.direction)}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={[styles.eventDesc, { color: colors.mutedText }]}>
                触发价 {formatPrice(event.triggerPrice)} · 分时均价 {formatPrice(event.avgPrice)} · {event.conditions[0] ?? '--'}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </>
  );
}

function ReminderConfigScreen({
  colors,
  error,
  isDark,
  isSaving,
  onBack,
  onDelete,
  onSave,
  onToggle,
  reminders,
  symbol,
  watchItem,
}: {
  colors: ThemeColors;
  error: string | null;
  isDark: boolean;
  isSaving: boolean;
  onBack: () => void;
  onDelete: (reminder: StockReminder) => void;
  onSave: (input: StockReminderInput, editingId?: string) => void;
  onToggle: (reminder: StockReminder) => void;
  reminders: StockReminder[];
  symbol: string;
  watchItem: StockWatchItem | null;
}) {
  const [draft, setDraft] = useState<StockReminderInput>({
    ruleType: 'price',
    direction: 'up',
    threshold: 1330,
    timeRange: '09:30-15:00',
    validDays: 5,
    channels: ['app', 'serverchan'],
  });
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const pageSurface = isDark ? colors.surface : '#f8faff';

  function startEdit(reminder: StockReminder) {
    setDraft({
      ruleType: reminder.ruleType,
      direction: reminder.direction,
      threshold: reminder.threshold,
      timeRange: reminder.timeRange,
      validDays: reminder.validDays,
      channels: [...reminder.channels],
    });
    setEditingId(reminder.id);
  }

  function save() {
    onSave(draft, editingId);
    if (editingId) {
      setEditingId(undefined);
      setDraft((current) => ({ ...current, ruleType: 'price', direction: 'up', threshold: 1330, validDays: 5, channels: ['app', 'serverchan'] }));
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: colors.background }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View style={[styles.screenShell, { backgroundColor: pageSurface }]}>
        <DetailHeader
          colors={colors}
          enabled={watchItem?.enabled ?? true}
          name={watchItem?.name ?? symbol}
          onBack={onBack}
          symbol={watchItem?.symbolCode ?? symbol}
        />
        <ScrollView contentContainerStyle={styles.detailContent} showsVerticalScrollIndicator={false}>
          {error ? (
            <View style={[styles.errorBanner, { backgroundColor: isDark ? '#3b242c' : '#fff1f4' }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={CORAL} />
              <ThemedText style={[styles.errorBannerText, { color: colors.mutedText }]}>{error}</ThemedText>
            </View>
          ) : null}

          <View style={[styles.priceHero, isDark && styles.priceHeroDark]}>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <ThemedText style={styles.liveText}>真实行情 · 提醒规则配置</ThemedText>
            </View>
            <View style={styles.priceLine}>
              <ThemedText style={styles.priceStrong}>{formatPrice(watchItem?.latestPrice ?? 0)}</ThemedText>
              <ThemedText style={[styles.priceChange, { color: priceColor(watchItem?.changePct) }]}>
                {watchItem?.changePct != null ? `${watchItem.changePct >= 0 ? '+' : ''}${watchItem.changePct.toFixed(2)}%` : '--'}
              </ThemedText>
            </View>
            <View style={styles.priceGrid}>
              <PriceCell label="分时均价" value={formatPrice(watchItem?.avgPrice ?? 0)} />
              <PriceCell label="信号状态" value={getSignalStatusLabel(watchItem?.signalStatus ?? 'data-missing')} />
              <PriceCell label="买入触发" value={watchItem?.analysis ? formatPrice(watchItem.analysis.rule.buyTrigger) : '--'} />
              <PriceCell label="止损触发" value={watchItem?.analysis ? formatPrice(watchItem.analysis.rule.stopLoss) : '--'} />
            </View>
          </View>

          <View style={styles.sectionHead}>
            <ThemedText style={styles.sectionTitle}>提醒类型</ThemedText>
            {editingId ? (
              <Pressable onPress={() => setEditingId(undefined)}>
                <ThemedText style={[styles.sectionHint, { color: BLUE }]}>取消编辑</ThemedText>
              </Pressable>
            ) : null}
          </View>
          <View style={[styles.ruleTypeGrid, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            {(['price', 'change', 'avg', 'volume', 'ai'] as StockReminderRuleType[]).map((type) => (
              <Pressable
                key={type}
                onPress={() => {
                  setDraft((current) => ({ ...current, ruleType: type, direction: type === 'ai' ? 'buy' : 'up' }));
                }}
                style={[styles.ruleTypeCell, draft.ruleType === type && styles.ruleTypeCellActive]}>
                <ThemedText style={[styles.ruleTypeText, draft.ruleType === type && { color: '#c9f36a' }]}>
                  {getRuleTypeLabel(type)}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={styles.settingsTitle}>提醒条件</ThemedText>
            {draft.ruleType === 'ai' ? (
              <View style={styles.directionRow}>
                {(['buy', 'sell', 'stop'] as StockReminderType[]).map((direction) => (
                  <Pressable
                    key={direction}
                    onPress={() => setDraft((current) => ({ ...current, direction }))}
                    style={[styles.directionButton, draft.direction === direction && styles.directionButtonActive]}>
                    <ThemedText style={[styles.directionText, draft.direction === direction && { color: '#151b3b' }]}>
                      {getDirectionLabel(direction)}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
            ) : (
              <>
                <View style={styles.directionRow}>
                  <Pressable
                    onPress={() => setDraft((current) => ({ ...current, direction: 'up' }))}
                    style={[styles.directionButton, draft.direction === 'up' && styles.directionButtonActive]}>
                    <ThemedText style={[styles.directionText, draft.direction === 'up' && { color: '#151b3b' }]}>
                      {draft.ruleType === 'avg' ? '上穿均线' : '向上突破'}
                    </ThemedText>
                  </Pressable>
                  <Pressable
                    onPress={() => setDraft((current) => ({ ...current, direction: 'down' }))}
                    style={[styles.directionButton, draft.direction === 'down' && styles.directionButtonActive]}>
                    <ThemedText style={[styles.directionText, draft.direction === 'down' && { color: '#151b3b' }]}>
                      {draft.ruleType === 'avg' ? '下穿均线' : '向下跌破'}
                    </ThemedText>
                  </Pressable>
                </View>
                {draft.ruleType !== 'avg' ? (
                  <View style={[styles.thresholdRow, { backgroundColor: isDark ? '#1c2440' : '#f3f6fb', borderColor: colors.line }]}>
                    <Pressable
                      onPress={() => setDraft((current) => ({ ...current, threshold: Number((current.threshold - (draft.ruleType === 'change' ? 0.1 : 1)).toFixed(2)) }))}
                      style={styles.stepButton}>
                      <MaterialCommunityIcons name="minus" size={14} color={colors.text} />
                    </Pressable>
                    <ThemedText style={styles.thresholdValue}>
                      {draft.ruleType === 'change' ? `${draft.threshold.toFixed(1)}%` : draft.threshold.toFixed(2)}
                    </ThemedText>
                    <Pressable
                      onPress={() => setDraft((current) => ({ ...current, threshold: Number((current.threshold + (draft.ruleType === 'change' ? 0.1 : 1)).toFixed(2)) }))}
                      style={styles.stepButton}>
                      <MaterialCommunityIcons name="plus" size={14} color={colors.text} />
                    </Pressable>
                  </View>
                ) : null}
              </>
            )}
          </View>

          <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={styles.settingsTitle}>生效设置</ThemedText>
            <View style={styles.settingRow}>
              <ThemedText style={styles.settingLabel}>交易时段</ThemedText>
              <ThemedText style={[styles.settingValue, { color: colors.mutedText }]}>09:30-11:30 · 13:00-15:00</ThemedText>
            </View>
            <View style={styles.settingRow}>
              <ThemedText style={styles.settingLabel}>有效交易日</ThemedText>
              <View style={styles.stepperInline}>
                <Pressable
                  onPress={() => setDraft((current) => ({ ...current, validDays: Math.max(1, current.validDays - 1) }))}
                  style={styles.stepButton}>
                  <MaterialCommunityIcons name="minus" size={14} color={colors.text} />
                </Pressable>
                <ThemedText style={styles.thresholdValue}>{draft.validDays} 天</ThemedText>
                <Pressable
                  onPress={() => setDraft((current) => ({ ...current, validDays: Math.min(30, current.validDays + 1) }))}
                  style={styles.stepButton}>
                  <MaterialCommunityIcons name="plus" size={14} color={colors.text} />
                </Pressable>
              </View>
            </View>
            <View style={styles.settingRow}>
              <ThemedText style={styles.settingLabel}>站内消息</ThemedText>
              <View style={[styles.togglePill, draft.channels.includes('app') && styles.togglePillOn]}>
                <View style={[styles.toggleKnob, draft.channels.includes('app') && styles.toggleKnobOn]} />
              </View>
            </View>
            <View style={styles.settingRow}>
              <ThemedText style={styles.settingLabel}>Server酱 微信</ThemedText>
              <Pressable
                onPress={() => setDraft((current) => ({
                  ...current,
                  channels: current.channels.includes('serverchan')
                    ? current.channels.filter((channel) => channel !== 'serverchan')
                    : [...current.channels, 'serverchan'],
                }))}
                style={[styles.togglePill, draft.channels.includes('serverchan') && styles.togglePillOn]}>
                <View style={[styles.toggleKnob, draft.channels.includes('serverchan') && styles.toggleKnobOn]} />
              </Pressable>
            </View>
          </View>

          <View style={styles.sectionHead}>
            <ThemedText style={styles.sectionTitle}>已设置提醒</ThemedText>
            <ThemedText style={[styles.sectionHint, { color: colors.mutedText }]}>{reminders.length} 条</ThemedText>
          </View>
          {reminders.length === 0 ? (
            <View style={[styles.emptyLine, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="bell-plus-outline" size={20} color={colors.mutedText} />
              <ThemedText style={[styles.emptyLineText, { color: colors.mutedText }]}>
                暂无提醒规则，保存后交易时段自动监听。
              </ThemedText>
            </View>
          ) : (
            <View style={[styles.eventList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              {reminders.map((reminder, index) => (
                <View
                  key={reminder.id}
                  style={[
                    styles.ruleRow,
                    index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
                  ]}>
                  <Pressable onPress={() => startEdit(reminder)} style={styles.ruleCopy}>
                    <ThemedText style={styles.ruleTitle}>{getReminderLabel(reminder)}</ThemedText>
                    <ThemedText style={[styles.ruleMeta, { color: colors.mutedText }]}>
                      {reminder.timeRange} · {reminder.validDays} 个交易日 · {reminder.channels.includes('serverchan') ? '站内+微信' : '站内'}
                    </ThemedText>
                  </Pressable>
                  <View style={styles.ruleActions}>
                    <Pressable onPress={() => onToggle(reminder)} style={styles.iconBtnSmall}>
                      <MaterialCommunityIcons
                        name={reminder.enabled ? 'bell-ring' : 'bell-off-outline'}
                        size={14}
                        color={reminder.enabled ? BLUE : colors.mutedText}
                      />
                    </Pressable>
                    <Pressable onPress={() => onDelete(reminder)} style={styles.iconBtnSmall}>
                      <MaterialCommunityIcons name="trash-can-outline" size={14} color={CORAL} />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          <Pressable
            onPress={save}
            style={({ pressed }) => [styles.actionButton, styles.primaryButton, pressed && styles.pressed, { marginTop: 12 }]}>
            {isSaving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <MaterialCommunityIcons name="bell-ring" size={16} color="#fff" />
            )}
            <ThemedText style={styles.primaryButtonText}>{editingId ? '保存修改' : '保存并开启提醒'}</ThemedText>
          </Pressable>
          <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
            仅供信息参考，不构成投资建议
          </ThemedText>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

function EventsView({
  colors,
  events,
  isDark,
  onMarkRead,
  onOpen,
}: {
  colors: ThemeColors;
  events: StockAlertEvent[];
  isDark: boolean;
  onMarkRead: () => void;
  onOpen: (symbol: string) => void;
}) {
  return (
    <>
      <View style={[styles.summaryHero, isDark && styles.summaryHeroDark]}>
        <View>
          <ThemedText style={styles.summaryTitle}>今日分时信号 {events.length} 条</ThemedText>
          <ThemedText style={styles.summarySub}>触发判定只使用不超过 15 秒的真实分时快照</ThemedText>
        </View>
        <View style={styles.summaryCount}>
          <ThemedText style={styles.summaryCountText}>{events.length}</ThemedText>
        </View>
      </View>
      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>提醒记录</ThemedText>
        <Pressable onPress={onMarkRead}>
          <ThemedText style={[styles.sectionHint, { color: BLUE }]}>全部已读</ThemedText>
        </Pressable>
      </View>
      {events.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="bell-check-outline" size={34} color={GREEN} />
          <ThemedText style={[styles.emptyTitle, { color: colors.text }]}>暂无提醒</ThemedText>
          <ThemedText style={[styles.emptyBody, { color: colors.mutedText }]}>
            分时信号触发后会同时写入站内消息并通过 Server酱 推送微信。
          </ThemedText>
        </View>
      ) : (
        <View style={[styles.eventList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {events.map((event, index) => (
            <Pressable
              key={event.id}
              onPress={() => onOpen(event.symbolCode)}
              style={({ pressed }) => [
                styles.eventRow,
                index > 0 && { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
                pressed && styles.pressed,
              ]}>
              <View style={styles.eventHead}>
                <ThemedText style={styles.eventTitle}>
                  {event.name} · 分时{getDirectionLabel(event.direction)}信号触发
                </ThemedText>
                <View style={[styles.pushPill, { backgroundColor: event.pushed ? '#e7f6ef' : '#e7ecff' }]}>
                  <ThemedText style={[styles.pushPillText, { color: event.pushed ? '#2e8f62' : BLUE }]}>
                    {event.pushed ? '微信已推送' : '站内已保留'}
                  </ThemedText>
                </View>
              </View>
              <ThemedText style={[styles.eventDesc, { color: colors.mutedText }]}>
                触发价 {formatPrice(event.triggerPrice)} · 分时均价 {formatPrice(event.avgPrice)} · {event.conditions[0] ?? '--'}
              </ThemedText>
              <ThemedText style={[styles.eventMeta, { color: colors.mutedText }]}>
                {formatTriggerTime(event.triggerTime)} · {event.signalStrength === 'confirmed' ? '确认信号' : '观察信号'}
                {event.pushedMessage && event.pushedMessage !== 'pushed' ? ` · ${event.pushedMessage}` : ''}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

function SettingsView({
  colors,
  isDark,
  onChangeSendKey,
  onSave,
  onTestPush,
  pushMessage,
  sendKey,
  settings,
}: {
  colors: ThemeColors;
  isDark: boolean;
  onChangeSendKey: (value: string) => void;
  onSave: () => void;
  onTestPush: () => void;
  pushMessage: string | null;
  sendKey: string;
  settings: StockAlertSettings | null;
}) {
  return (
    <>
      <View style={[styles.settingsCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={styles.settingsHead}>
          <ThemedText style={styles.settingsTitle}>Server酱 推送设置</ThemedText>
          <View style={[styles.boundBadge, { backgroundColor: settings?.sendKeyBound ? '#e7f6ef' : '#fff3e2' }]}>
            <ThemedText style={[styles.boundBadgeText, { color: settings?.sendKeyBound ? '#2e8f62' : '#b06d14' }]}>
              {settings?.sendKeyBound ? '已绑定' : '未绑定'}
            </ThemedText>
          </View>
        </View>
        <View style={[styles.keyRow, { backgroundColor: isDark ? '#1c2440' : '#f3f6fb', borderColor: colors.line }]}>
          <ThemedText style={styles.keyValue}>{settings?.sendKeyMasked ?? '未设置'}</ThemedText>
          <ThemedText style={[styles.keyHint, { color: colors.mutedText }]}>仅显示掩码 · 支持 SCT / SC3</ThemedText>
        </View>
        <TextInput
          autoCapitalize="none"
          onChangeText={onChangeSendKey}
          placeholder="粘贴新的 SendKey（留空则保持原值）"
          placeholderTextColor={colors.mutedText}
          secureTextEntry
          style={[styles.sendKeyInput, { backgroundColor: colors.surface, borderColor: colors.line, color: colors.text }]}
          value={sendKey}
        />
        <ThemedText style={[styles.quotaLine, { color: colors.mutedText }]}>
          免费版每日 5 条额度，超出后仍可收到站内提醒；推送失败原因会记录在消息里。
        </ThemedText>
        <View style={styles.settingsActions}>
          <Pressable
            onPress={onSave}
            style={({ pressed }) => [styles.actionButton, styles.primaryButton, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="content-save-outline" size={16} color="#fff" />
            <ThemedText style={styles.primaryButtonText}>保存 Key</ThemedText>
          </Pressable>
          <Pressable
            onPress={onTestPush}
            style={({ pressed }) => [styles.actionButton, { borderColor: colors.line }, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="send-outline" size={16} color={colors.text} />
            <ThemedText>测试推送</ThemedText>
          </Pressable>
        </View>
        {pushMessage ? (
          <ThemedText style={[styles.pushMessage, { color: GREEN }]}>{pushMessage}</ThemedText>
        ) : null}
      </View>
      <View style={[styles.sourceLine, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="shield-lock-outline" size={15} color={colors.mutedText} />
        <ThemedText style={[styles.sourceText, { color: colors.mutedText }]}>
          SendKey 仅服务端加密保存，不进入客户端 bundle，也不写入仓库。
        </ThemedText>
      </View>
    </>
  );
}

function DetailHeader({
  colors,
  enabled,
  name,
  onBack,
  onToggle,
  symbol,
}: {
  colors: ThemeColors;
  enabled: boolean;
  name: string;
  onBack: () => void;
  onToggle?: () => void;
  symbol?: string;
}) {
  return (
    <View style={[styles.detailHeader, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <Pressable onPress={onBack} style={styles.iconButton}>
        <MaterialCommunityIcons name="arrow-left" size={20} color={colors.text} />
      </Pressable>
      <View style={styles.detailTitleStack}>
        <ThemedText style={styles.detailTitle}>{name}</ThemedText>
        <ThemedText style={[styles.detailSubtitle, { color: colors.mutedText }]}>{symbol ?? ''}</ThemedText>
      </View>
      <Pressable onPress={onToggle} style={[styles.iconButton, { borderColor: colors.line }]}>
        <MaterialCommunityIcons
          name={enabled ? 'bell-ring' : 'bell-off-outline'}
          size={19}
          color={enabled ? BLUE : colors.mutedText}
        />
      </Pressable>
    </View>
  );
}

function StatusPill({ status }: { status: StockWatchItem['signalStatus'] }) {
  const color = STATUS_TONES[status] ?? '#9aa3b7';
  return (
    <View style={[styles.statusPill, { backgroundColor: `${color}1f` }]}>
      <View style={[styles.statusDot, { backgroundColor: color }]} />
      <ThemedText style={[styles.statusText, { color }]}>{getSignalStatusLabel(status)}</ThemedText>
    </View>
  );
}

function getRuleTypeLabel(type: StockReminderRuleType) {
  const labels: Record<StockReminderRuleType, string> = {
    price: '价格',
    change: '涨跌幅',
    avg: '分时均线',
    volume: '量能',
    ai: 'AI信号',
  };
  return labels[type] ?? type;
}

function getReminderLabel(reminder: StockReminder) {
  const type = getRuleTypeLabel(reminder.ruleType);
  if (reminder.ruleType === 'ai') {
    return `${type} · ${getDirectionLabel(reminder.direction as StockReminderType)}`;
  }
  if (reminder.ruleType === 'avg') {
    return `${type} · ${reminder.direction === 'up' ? '上穿均线' : '下穿均线'}`;
  }
  const action = reminder.direction === 'up' ? '向上突破' : '向下跌破';
  return `${type} · ${action} ${reminder.threshold.toFixed(2)}`;
}

function formatPrice(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '--';
  return value.toFixed(2);
}

function priceColor(value?: number) {
  if (value == null || value === 0) return '#6b7892';
  return value > 0 ? CORAL : GREEN;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenShell: { flex: 1, width: '100%', maxWidth: 430, alignSelf: 'center' },
  overviewHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  overviewTitle: { fontSize: 22, fontWeight: '900' },
  headerCaption: { fontSize: 11, fontWeight: '600', marginTop: 3 },
  refreshButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  tabs: {
    borderRadius: 8,
    flexDirection: 'row',
    gap: 6,
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 4,
  },
  tabButton: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 36,
    justifyContent: 'center',
    position: 'relative',
  },
  tabText: { fontSize: 12, fontWeight: '800' },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: '#ff5d6c',
    borderRadius: 9,
    height: 16,
    justifyContent: 'center',
    minWidth: 16,
    paddingHorizontal: 4,
    position: 'absolute',
    right: 6,
    top: -4,
  },
  unreadBadgeText: { color: '#fff', fontSize: 9, fontWeight: '900' },
  overviewContent: { paddingBottom: 28, paddingHorizontal: 16 },
  hero: {
    backgroundColor: '#151b3b',
    borderRadius: 16,
    marginTop: 2,
    padding: 14,
  },
  heroDark: { backgroundColor: '#101426' },
  heroEyebrow: { color: '#c9f36a', fontSize: 10, fontWeight: '900', marginBottom: 8 },
  searchBox: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontSize: 12, minWidth: 0, paddingVertical: 8 },
  analyzeButton: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 5,
    height: 32,
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  analyzeButtonText: { color: '#151b3b', fontSize: 10, fontWeight: '900' },
  heroMeta: { color: '#aebbd0', fontSize: 9, fontWeight: '700', marginTop: 9 },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
    marginTop: 16,
  },
  sectionTitle: { fontSize: 15, fontWeight: '900' },
  sectionHint: { fontSize: 10, fontWeight: '700' },
  watchList: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  watchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 72,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  watchMain: { flex: 1, minWidth: 0 },
  watchNameRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  stockName: { fontSize: 13, fontWeight: '900' },
  bellButton: { padding: 2 },
  stockCode: { fontSize: 9.5, fontWeight: '700', marginTop: 3 },
  statusPill: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: 5,
    flexDirection: 'row',
    gap: 5,
    marginTop: 6,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  statusDot: { borderRadius: 4, height: 6, width: 6 },
  statusText: { fontSize: 9, fontWeight: '900' },
  watchQuote: { alignItems: 'flex-end' },
  quotePrice: { fontFamily: 'Arial', fontSize: 13, fontWeight: '900', fontVariant: ['tabular-nums'] },
  quoteSub: { fontSize: 9, fontWeight: '700', marginTop: 2 },
  setReminderButton: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 6,
    flexDirection: 'row',
    gap: 3,
    height: 28,
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  setReminderText: { color: '#151b3b', fontSize: 8.5, fontWeight: '900' },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 78,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  searchResultRight: { alignItems: 'flex-end', justifyContent: 'center' },
  tagRow: { flexDirection: 'row', gap: 4, marginTop: 5 },
  tagPill: { borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  tagPillText: { fontSize: 8, fontWeight: '900' },
  addResultButton: {
    alignItems: 'center',
    borderColor: '#4b6bff',
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    height: 26,
    justifyContent: 'center',
    marginTop: 6,
    minWidth: 72,
    paddingHorizontal: 7,
  },
  addResultAdded: { borderColor: '#cbe8d9', backgroundColor: '#e7f6ef' },
  addResultText: { fontSize: 8.5, fontWeight: '900' },
  ruleTypeGrid: {
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 3,
    padding: 3,
  },
  ruleTypeCell: {
    alignItems: 'center',
    borderRadius: 5,
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
  },
  ruleTypeCellActive: { backgroundColor: '#151b3b' },
  ruleTypeText: { color: '#7483a2', fontSize: 9, fontWeight: '900' },
  directionRow: { flexDirection: 'row', gap: 6, marginTop: 8 },
  directionButton: {
    alignItems: 'center',
    backgroundColor: '#f3f6fb',
    borderColor: '#dce5f6',
    borderRadius: 6,
    borderWidth: 1,
    flex: 1,
    height: 34,
    justifyContent: 'center',
  },
  directionButtonActive: { backgroundColor: '#c9f36a', borderColor: '#c9f36a' },
  directionText: { fontSize: 10, fontWeight: '900', color: '#7483a2' },
  thresholdRow: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
    minHeight: 40,
    paddingHorizontal: 8,
  },
  thresholdValue: { fontFamily: 'Arial', fontSize: 14, fontWeight: '900' },
  stepButton: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderColor: '#dce5f6',
    borderRadius: 5,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 26,
  },
  settingRow: {
    alignItems: 'center',
    borderTopColor: '#dce5f6',
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 44,
  },
  settingLabel: { fontSize: 10.5, fontWeight: '900' },
  settingValue: { fontSize: 9, fontWeight: '700' },
  stepperInline: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  togglePill: {
    alignItems: 'center',
    backgroundColor: '#d9dfec',
    borderRadius: 10,
    flexDirection: 'row',
    height: 20,
    justifyContent: 'flex-start',
    padding: 2,
    width: 36,
  },
  togglePillOn: { backgroundColor: '#4b6bff', justifyContent: 'flex-end' },
  toggleKnob: { backgroundColor: '#fff', borderRadius: 8, height: 16, width: 16 },
  toggleKnobOn: { backgroundColor: '#fff' },
  ruleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    minHeight: 54,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  ruleCopy: { flex: 1, minWidth: 0 },
  ruleTitle: { fontSize: 10.5, fontWeight: '900' },
  ruleMeta: { fontSize: 8.5, fontWeight: '700', marginTop: 3 },
  ruleActions: { flexDirection: 'row', gap: 6 },
  iconBtnSmall: {
    alignItems: 'center',
    backgroundColor: '#f3f6fb',
    borderColor: '#dce5f6',
    borderRadius: 6,
    borderWidth: 1,
    height: 28,
    justifyContent: 'center',
    width: 28,
  },
  sourceLine: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
    padding: 10,
  },
  sourceText: { flex: 1, fontSize: 9, fontWeight: '700', lineHeight: 15 },
  emptyCard: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    padding: 26,
  },
  emptyTitle: { fontSize: 14, fontWeight: '900', marginTop: 10 },
  emptyBody: { fontSize: 11, fontWeight: '600', lineHeight: 18, marginTop: 6, textAlign: 'center' },
  errorBanner: {
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
    padding: 10,
  },
  errorBannerText: { flex: 1, fontSize: 10.5, fontWeight: '700', lineHeight: 16 },
  pressed: { opacity: 0.75 },
  detailHeader: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 56,
    paddingHorizontal: 12,
  },
  detailTitleStack: { alignItems: 'center', flex: 1 },
  detailTitle: { fontSize: 15, fontWeight: '900' },
  detailSubtitle: { fontSize: 9, fontWeight: '700', marginTop: 1 },
  iconButton: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 8,
    height: 36,
    justifyContent: 'center',
    width: 36,
  },
  detailContent: { paddingBottom: 28, paddingHorizontal: 16, paddingTop: 12 },
  priceHero: {
    backgroundColor: '#151b3b',
    borderRadius: 16,
    padding: 14,
  },
  priceHeroDark: { backgroundColor: '#101426' },
  liveBadge: { alignItems: 'center', flexDirection: 'row', gap: 7, marginBottom: 9 },
  liveDot: {
    backgroundColor: '#c9f36a',
    borderRadius: 4,
    height: 7,
    shadowColor: '#c9f36a',
    shadowOpacity: 0.7,
    shadowRadius: 4,
    width: 7,
  },
  liveText: { color: '#c9f36a', fontSize: 9.5, fontWeight: '900' },
  priceLine: { alignItems: 'baseline', flexDirection: 'row', gap: 10 },
  priceStrong: { color: '#fff', fontFamily: 'Arial', fontSize: 30, fontWeight: '900' },
  priceChange: { fontSize: 13, fontWeight: '900' },
  priceGrid: {
    borderTopColor: 'rgba(255,255,255,.12)',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 12,
  },
  priceCellLabel: { color: '#aebbd0', fontSize: 8.5, fontWeight: '700', marginBottom: 3 },
  priceCellValue: { color: '#fff', fontSize: 10.5, fontWeight: '900' },
  chartCard: { borderRadius: 8, borderWidth: 1, padding: 10 },
  chartLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 8 },
  legendItem: { alignItems: 'center', flexDirection: 'row', gap: 5 },
  legendLine: { borderRadius: 2, height: 3, width: 16 },
  legendText: { fontSize: 9, fontWeight: '800', color: '#6b7892' },
  axisLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  axisText: { fontSize: 8, fontWeight: '700' },
  aiCard: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  aiHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  aiHeadTitle: { color: '#fff', fontSize: 10.5, fontWeight: '900' },
  aiHeadBadge: { color: '#c9f36a', fontSize: 8.5, fontWeight: '900' },
  zoneGrid: { flexDirection: 'row' },
  zoneCell: {
    borderLeftColor: '#dce5f6',
    borderLeftWidth: 1,
    flex: 1,
    padding: 10,
  },
  zoneLabel: { color: '#7483a2', fontSize: 8.5, fontWeight: '800', marginBottom: 4 },
  zoneValue: { fontFamily: 'Arial', fontSize: 13, fontWeight: '900' },
  zoneNote: { color: '#7483a2', fontSize: 7.5, fontWeight: '700', marginTop: 4, lineHeight: 11 },
  eventList: { borderRadius: 8, borderWidth: 1, overflow: 'hidden' },
  eventRow: { padding: 11 },
  eventHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  eventTitle: { fontSize: 10.5, fontWeight: '900', flex: 1, marginRight: 8 },
  pushPill: { borderRadius: 5, paddingHorizontal: 7, paddingVertical: 3 },
  pushPillText: { fontSize: 8, fontWeight: '900' },
  eventDesc: { fontSize: 9.5, fontWeight: '700', lineHeight: 15, marginTop: 6 },
  eventMeta: { fontSize: 8, fontWeight: '700', marginTop: 5 },
  emptyLine: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    padding: 14,
  },
  emptyLineText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 16 },
  reminderBar: {
    alignItems: 'center',
    backgroundColor: '#e7f6ef',
    borderRadius: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 12,
    padding: 10,
  },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  actionButton: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    height: 40,
    justifyContent: 'center',
  },
  primaryButton: { backgroundColor: '#4b6bff', borderColor: '#4b6bff' },
  primaryButtonText: { color: '#fff', fontSize: 11, fontWeight: '900' },
  dataCard: {
    alignItems: 'flex-start',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 10,
  },
  dataText: { flex: 1, fontSize: 8.5, fontWeight: '700', lineHeight: 14 },
  disclaimer: { fontSize: 8, fontWeight: '700', marginTop: 10, textAlign: 'center' },
  summaryHero: {
    alignItems: 'center',
    backgroundColor: '#151b3b',
    borderRadius: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
    padding: 14,
  },
  summaryHeroDark: { backgroundColor: '#101426' },
  summaryTitle: { color: '#fff', fontSize: 12.5, fontWeight: '900' },
  summarySub: { color: '#aebbd0', fontSize: 8.5, fontWeight: '700', marginTop: 4 },
  summaryCount: {
    alignItems: 'center',
    backgroundColor: '#c9f36a',
    borderRadius: 10,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  summaryCountText: { color: '#151b3b', fontSize: 18, fontWeight: '900' },
  settingsCard: { borderRadius: 8, borderWidth: 1, marginTop: 2, padding: 12 },
  settingsHead: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  settingsTitle: { fontSize: 13, fontWeight: '900' },
  boundBadge: { borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4 },
  boundBadgeText: { fontSize: 9, fontWeight: '900' },
  keyRow: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 40,
    paddingHorizontal: 10,
  },
  keyValue: { fontFamily: 'Arial', fontSize: 11, fontWeight: '900' },
  keyHint: { fontSize: 8, fontWeight: '800' },
  sendKeyInput: {
    borderRadius: 7,
    borderWidth: 1,
    fontSize: 11,
    marginTop: 10,
    minHeight: 42,
    paddingHorizontal: 10,
  },
  quotaLine: { fontSize: 8.5, fontWeight: '700', lineHeight: 14, marginTop: 10 },
  settingsActions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  pushMessage: { fontSize: 10, fontWeight: '800', marginTop: 10 },
});
