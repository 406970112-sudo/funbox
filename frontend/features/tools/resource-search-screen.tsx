import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { startTransition, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { appLayout } from '@/constants/app-theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  listResourceSearchSources,
  getResourceSearchErrorMessage,
  resolveResourceResult,
  searchResourceSource,
} from '@/lib/resource-search-api';
import {
  addResourceSearchHistory,
  loadResourceSearchHistory,
  saveResourceSearchHistory,
} from '@/lib/resource-search-history';
import {
  getDefaultResourceSearchSourceIds,
  getResourceSearchQueue,
  normalizeResourceSearchQuery,
} from '@/lib/resource-search';
import type {
  ResourceResultCategory,
  ResourceSearchResult,
  ResourceSearchSource,
  ResourceSearchSourceResponse,
  ResourceSearchSourceStatus,
} from '@/types/resource-search';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type SearchPhase = 'loading' | 'results' | 'search';
type SortMode = 'relevance' | 'source';

const HERO_COLOR = '#151b3b';
const BRAND_BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff6b8f';

const CATEGORY_OPTIONS: { id: ResourceResultCategory; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'media', label: '影视' },
  { id: 'software', label: '软件' },
  { id: 'document', label: '资料' },
];

export function ResourceSearchScreen() {
  const router = useRouter();
  const { colors, colorScheme } = useAppTheme();
  const [phase, setPhase] = useState<SearchPhase>('search');
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [sources, setSources] = useState<ResourceSearchSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourcesError, setSourcesError] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [sourceOptionsVisible, setSourceOptionsVisible] = useState(false);
  const [sourceStatusVisible, setSourceStatusVisible] = useState(false);
  const [responses, setResponses] = useState<Partial<Record<string, ResourceSearchSourceResponse>>>({});
  const [pendingSourceIds, setPendingSourceIds] = useState<string[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<ResourceResultCategory>('all');
  const [sourceFilter, setSourceFilter] = useState<string | 'all'>('all');
  const [sortMode, setSortMode] = useState<SortMode>('relevance');
  const [selectedResult, setSelectedResult] = useState<ResourceSearchResult | null>(null);
  const [resolvedTargets, setResolvedTargets] = useState<Record<string, string>>({});
  const [resolvingResultId, setResolvingResultId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const [detailError, setDetailError] = useState('');
  const requestControllerRef = useRef<AbortController | null>(null);
  const searchRunRef = useRef(0);

  const selectedSources = getResourceSearchQueue(sources, selectedSourceIds);
  const allSourcesSelected = sources.length > 0 && selectedSourceIds.length === sources.length;
  const pageBackground = colorScheme === 'dark' ? colors.background : '#eef4ff';
  const completedResponses = Object.values(responses).filter(
    (response): response is ResourceSearchSourceResponse => Boolean(response),
  );
  const allResults = completedResponses.flatMap((response) => response.results);
  const availableSourceFilters = selectedSources.filter((source) => (responses[source.id]?.count || 0) > 0);
  const failedSourceCount = completedResponses.filter((response) =>
    ['direct', 'error', 'restricted', 'timeout', 'unavailable'].includes(response.status),
  ).length;
  const visibleResults = sortResults(
    allResults.filter((result) => {
      const matchesSource = sourceFilter === 'all' || result.sourceId === sourceFilter;
      const matchesCategory =
        categoryFilter === 'all' || getResultCategory(result) === categoryFilter;
      return matchesSource && matchesCategory;
    }),
    sortMode,
  );

  useEffect(() => {
    let active = true;
    setSourcesLoading(true);
    void Promise.all([listResourceSearchSources(), loadResourceSearchHistory()])
      .then(([loadedSources, loadedHistory]) => {
        if (!active) return;
        setSources(loadedSources);
        setSelectedSourceIds(getDefaultResourceSearchSourceIds(loadedSources));
        setHistory(loadedHistory);
      })
      .catch((error) => {
        if (active) setSourcesError(getResourceSearchErrorMessage(error));
      })
      .finally(() => {
        if (active) setSourcesLoading(false);
      });
    return () => {
      active = false;
      requestControllerRef.current?.abort();
    };
  }, []);

  function goBack() {
    if (phase === 'loading') {
      cancelSearch();
      return;
    }
    if (phase === 'results') {
      setFeedback('');
      startTransition(() => setPhase('search'));
      return;
    }
    router.back();
  }

  function toggleSource(sourceId: string) {
    setFeedback('');
    setSelectedSourceIds((current) =>
      current.includes(sourceId)
        ? current.filter((item) => item !== sourceId)
        : [...current, sourceId],
    );
  }

  function toggleAllSources() {
    setSelectedSourceIds(
      allSourcesSelected ? [] : sources.map((source) => source.id),
    );
    setFeedback('');
  }

  function restoreDefaultSources() {
    setSelectedSourceIds(getDefaultResourceSearchSourceIds(sources));
    setFeedback('已恢复默认搜索源。');
  }

  async function runSearch(value = query) {
    const nextQuery = normalizeResourceSearchQuery(value);
    const queue = getResourceSearchQueue(sources, selectedSourceIds);
    if (!nextQuery) {
      setFeedback('先输入想找的电影、剧集、软件或资料。');
      return;
    }
    if (!queue.length) {
      setFeedback('至少选择一个搜索站点。');
      return;
    }

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const runID = searchRunRef.current + 1;
    searchRunRef.current = runID;
    setQuery(nextQuery);
    setActiveQuery(nextQuery);
    void addResourceSearchHistory(nextQuery).then(setHistory);
    setResponses({});
    setPendingSourceIds(queue.map((source) => source.id));
    setCategoryFilter('all');
    setSourceFilter('all');
    setSelectedResult(null);
    setFeedback('');
    setDetailError('');
    startTransition(() => setPhase('loading'));

    await Promise.all(
      queue.map(async (source) => {
        let response: ResourceSearchSourceResponse;
        try {
          response = await searchResourceSource(nextQuery, source.id, controller.signal);
        } catch (error) {
          if (controller.signal.aborted || searchRunRef.current !== runID) {
            return;
          }
          response = {
            count: 0,
            durationMs: 0,
            fallbackUrl: source.url,
            message: getResourceSearchErrorMessage(error),
            query: nextQuery,
            results: [],
            sourceId: source.id,
            status: 'error',
          };
        }
        if (controller.signal.aborted || searchRunRef.current !== runID) {
          return;
        }
        setResponses((current) => ({ ...current, [source.id]: response }));
        setPendingSourceIds((current) => current.filter((item) => item !== source.id));
      }),
    );

    if (!controller.signal.aborted && searchRunRef.current === runID) {
      setPendingSourceIds([]);
      startTransition(() => setPhase('results'));
    }
  }

  function cancelSearch() {
    requestControllerRef.current?.abort();
    requestControllerRef.current = null;
    searchRunRef.current += 1;
    setPendingSourceIds([]);
    setResponses({});
    setFeedback('');
    startTransition(() => setPhase('search'));
  }

  async function openURL(url: string, fallbackMessage: string) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      setFeedback(fallbackMessage);
      return false;
    }
  }

  async function openSelectedResource() {
    if (!selectedResult || resolvingResultId) {
      return;
    }
    setDetailError('');
    let targetURL = resolvedTargets[selectedResult.id] || selectedResult.targetUrl;
    if (!targetURL && selectedResult.requiresResolve) {
      setResolvingResultId(selectedResult.id);
      try {
        const resolved = await resolveResourceResult(selectedResult.id);
        targetURL = resolved.targetUrl;
        setResolvedTargets((current) => ({ ...current, [selectedResult.id]: resolved.targetUrl }));
        if (resolved.extractionCode) {
          await Clipboard.setStringAsync(resolved.extractionCode);
        }
      } catch (error) {
        setDetailError(getResourceSearchErrorMessage(error));
        return;
      } finally {
        setResolvingResultId(null);
      }
    }
    if (!targetURL) {
      setDetailError('该来源暂未提供可直接打开的资源链接。');
      return;
    }
    await openURL(targetURL, '无法打开资源链接，请查看原站记录。');
  }

  function useHistoryItem(value: string) {
    setHistoryVisible(false);
    void runSearch(value);
  }

  function applySourceOptions() {
    setSourceOptionsVisible(false);
    if (phase !== 'search') {
      void runSearch(activeQuery || query);
    }
  }

  const topBarTitle = phase === 'results' ? '搜索结果' : '资源搜索';

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: pageBackground }]} edges={['top']}>
      <View style={[styles.screenShell, { backgroundColor: pageBackground }]}>
        <View style={[styles.topBar, { backgroundColor: colors.surface, borderBottomColor: colors.line }]}>
          <Pressable accessibilityLabel="返回" accessibilityRole="button" onPress={goBack} style={styles.topBarSide}>
            <MaterialCommunityIcons name="arrow-left" size={23} color={colors.text} />
          </Pressable>
          <ThemedText style={styles.topBarTitle}>{topBarTitle}</ThemedText>
          <Pressable
            accessibilityLabel={phase === 'search' ? '搜索历史' : '搜索源筛选'}
            accessibilityRole="button"
            onPress={() => (phase === 'search' ? setHistoryVisible(true) : setSourceOptionsVisible(true))}
            style={[styles.topBarAction, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
            <MaterialCommunityIcons
              name={phase === 'search' ? 'history' : 'tune-variant'}
              size={20}
              color={colors.text}
            />
          </Pressable>
        </View>

        <View style={styles.body}>
          {phase === 'search' ? (
            <SearchLanding
              allSelected={allSourcesSelected}
              feedback={feedback}
              loading={sourcesLoading}
              error={sourcesError}
              onQueryChange={(value) => {
                setQuery(value);
                if (feedback) setFeedback('');
              }}
              onSearch={() => void runSearch()}
              onRetrySources={() => {
                setSourcesLoading(true);
                setSourcesError('');
                void listResourceSearchSources()
                  .then((loadedSources) => {
                    setSources(loadedSources);
                    setSelectedSourceIds(getDefaultResourceSearchSourceIds(loadedSources));
                  })
                  .catch((loadError) => setSourcesError(getResourceSearchErrorMessage(loadError)))
                  .finally(() => setSourcesLoading(false));
              }}
              onToggleAll={toggleAllSources}
              onToggleSource={toggleSource}
              query={query}
              sources={sources}
              selectedSourceIds={selectedSourceIds}
            />
          ) : null}
          {phase === 'loading' ? (
            <LoadingPanel
              activeQuery={activeQuery}
              onCancel={cancelSearch}
              pendingSourceIds={pendingSourceIds}
              responses={responses}
              selectedSources={selectedSources}
            />
          ) : null}
          {phase === 'results' ? (
            <ResultsPanel
              activeQuery={activeQuery}
              categoryFilter={categoryFilter}
              failedSourceCount={failedSourceCount}
              feedback={feedback}
              onCategoryChange={setCategoryFilter}
              onOpenSourceStatus={() => setSourceStatusVisible(true)}
              onQueryChange={setQuery}
              onResultPress={(result) => {
                setSelectedResult(result);
                setDetailError('');
              }}
              onSearch={() => void runSearch()}
              onSortChange={() => setSortMode((current) => (current === 'relevance' ? 'source' : 'relevance'))}
              onSourceChange={setSourceFilter}
              query={query}
              resultCount={allResults.length}
              results={visibleResults}
              sortMode={sortMode}
              sourceFilter={sourceFilter}
              sourceFilters={availableSourceFilters}
              sources={sources}
            />
          ) : null}
        </View>

        <ToolBottomNavigation />
      </View>

      <HistorySheet
        history={history}
        onClear={() => {
          setHistory([]);
          void saveResourceSearchHistory([]);
        }}
        onClose={() => setHistoryVisible(false)}
        onSelect={useHistoryItem}
        visible={historyVisible}
      />
      <SourceOptionsSheet
        allSelected={allSourcesSelected}
        onApply={applySourceOptions}
        onClose={() => setSourceOptionsVisible(false)}
        onRestoreDefaults={restoreDefaultSources}
        onToggleAll={toggleAllSources}
        onToggleSource={toggleSource}
        selectedSourceIds={selectedSourceIds}
        sources={sources}
        visible={sourceOptionsVisible}
      />
      <SourceStatusSheet
        onClose={() => setSourceStatusVisible(false)}
        onOpenURL={(url) => void openURL(url, '无法打开来源站点，请稍后重试。')}
        responses={responses}
        sources={selectedSources}
        visible={sourceStatusVisible}
      />
      <ResultDetailSheet
        error={detailError}
        onClose={() => setSelectedResult(null)}
        onOpenOrigin={() => {
          if (selectedResult) {
            void openURL(selectedResult.originUrl, '无法打开原站记录，请稍后重试。');
          }
        }}
        onOpenResource={() => void openSelectedResource()}
        resolving={Boolean(selectedResult && resolvingResultId === selectedResult.id)}
        result={selectedResult}
        resolvedURL={selectedResult ? resolvedTargets[selectedResult.id] : undefined}
        sources={sources}
      />
    </SafeAreaView>
  );
}

type SearchLandingProps = {
  allSelected: boolean;
  error: string;
  feedback: string;
  loading: boolean;
  onQueryChange: (value: string) => void;
  onRetrySources: () => void;
  onSearch: () => void;
  onToggleAll: () => void;
  onToggleSource: (sourceId: string) => void;
  query: string;
  selectedSourceIds: string[];
  sources: ResourceSearchSource[];
};

function SearchLanding({
  allSelected,
  error,
  feedback,
  loading,
  onQueryChange,
  onRetrySources,
  onSearch,
  onToggleAll,
  onToggleSource,
  query,
  sources,
  selectedSourceIds,
}: SearchLandingProps) {
  const { colors } = useAppTheme();

  return (
    <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
      <View style={styles.hero}>
        <View style={styles.heroTextureTop} />
        <View style={styles.heroTextureBottom} />
        <View style={styles.heroMeta}>
          <MaterialCommunityIcons name="radar" size={18} color={LIME} />
          <ThemedText style={styles.heroMetaText}>
            聚合 {sources.length} 个搜索站点
          </ThemedText>
        </View>
        <ThemedText style={styles.heroTitle}>一次输入{`\n`}直接查看多源结果</ThemedText>
        <View style={styles.heroSearch}>
          <MaterialCommunityIcons name="magnify" size={20} color={colors.mutedText} />
          <TextInput
            accessibilityLabel="资源搜索关键词"
            onChangeText={onQueryChange}
            onSubmitEditing={onSearch}
            placeholder="电影、剧集、软件或资料"
            placeholderTextColor={colors.mutedText}
            returnKeyType="search"
            style={[styles.heroInput, { color: colors.text }]}
            value={query}
          />
          <Pressable accessibilityLabel="开始聚合搜索" accessibilityRole="button" onPress={onSearch} style={styles.heroSearchButton}>
            <MaterialCommunityIcons name="arrow-right" size={21} color={HERO_COLOR} />
          </Pressable>
        </View>
        {feedback ? <ThemedText style={styles.heroFeedback}>{feedback}</ThemedText> : null}
      </View>

      {loading ? (
        <View style={[styles.sourceState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ActivityIndicator color={colors.primary} size="small" />
          <ThemedText style={[styles.sourceStateText, { color: colors.mutedText }]}>正在加载真实站点配置…</ThemedText>
        </View>
      ) : null}
      {!loading && error ? (
        <Pressable accessibilityRole="button" onPress={onRetrySources} style={[styles.sourceState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="alert-circle-outline" size={18} color={CORAL} />
          <ThemedText style={[styles.sourceStateText, { color: colors.mutedText }]}>{error}</ThemedText>
          <ThemedText style={[styles.sourceStateAction, { color: colors.primary }]}>重试</ThemedText>
        </Pressable>
      ) : null}
      {!loading && !error && sources.length === 0 ? (
        <View style={[styles.sourceState, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="database-off-outline" size={18} color={colors.mutedText} />
          <ThemedText style={[styles.sourceStateText, { color: colors.mutedText }]}>管理员尚未配置可用搜索站点。</ThemedText>
        </View>
      ) : null}

      <View style={styles.sectionHeader}>
        <View>
          <ThemedText style={styles.sectionTitle}>搜索站点</ThemedText>
          <ThemedText style={[styles.sectionMetaLeft, { color: colors.mutedText }]}>已选择 {selectedSourceIds.length} 个来源</ThemedText>
        </View>
        <Pressable accessibilityRole="button" onPress={onToggleAll}>
          <ThemedText style={[styles.sectionAction, { color: colors.primary }]}>{allSelected ? '取消全选' : '全选'}</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.sourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {sources.map((source, index) => {
          const selected = selectedSourceIds.includes(source.id);
          return (
            <Pressable
              accessibilityLabel={`${source.name}，${selected ? '已选择' : '未选择'}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              key={source.id}
              onPress={() => onToggleSource(source.id)}
              style={[
                styles.sourceRow,
                index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
              ]}>
              <SourceLogo source={source} />
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                <ThemedText numberOfLines={1} style={[styles.sourceDescription, { color: colors.mutedText }]}>
                  {source.description} · {source.domain}
                </ThemedText>
              </View>
              <View style={[styles.checkbox, { backgroundColor: selected ? colors.primary : 'transparent', borderColor: selected ? colors.primary : colors.line }]}>
                {selected ? <MaterialCommunityIcons name="check" size={15} color="#ffffff" /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

type LoadingPanelProps = {
  activeQuery: string;
  onCancel: () => void;
  pendingSourceIds: string[];
  responses: Partial<Record<string, ResourceSearchSourceResponse>>;
  selectedSources: ResourceSearchSource[];
};

function LoadingPanel({ activeQuery, onCancel, pendingSourceIds, responses, selectedSources }: LoadingPanelProps) {
  const { colors } = useAppTheme();
  const completed = selectedSources.length - pendingSourceIds.length;
  const progress = selectedSources.length ? (completed / selectedSources.length) * 100 : 0;

  return (
    <ScrollView contentContainerStyle={styles.scrollContent}>
      <CompactSearchBar query={activeQuery} />
      <View style={styles.loadingHeading}>
        <View>
          <ThemedText style={styles.resultsTitle}>正在聚合</ThemedText>
          <ThemedText style={[styles.resultsSubtitle, { color: colors.mutedText }]}>已完成 {completed} / {selectedSources.length} 个来源</ThemedText>
        </View>
        <ActivityIndicator color={colors.primary} size="small" />
      </View>
      <View style={styles.progressCard}>
        <View style={styles.progressTop}>
          <View style={styles.progressLabel}>
            <MaterialCommunityIcons name="radar" size={17} color={LIME} />
            <ThemedText style={styles.progressLabelText}>多源检索进行中</ThemedText>
          </View>
          <ThemedText style={styles.progressCount}>{completed} / {selectedSources.length}</ThemedText>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(progress)}%` as `${number}%` }]} />
        </View>
      </View>

      <View style={[styles.sourceList, styles.loadingSourceList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        {selectedSources.map((source, index) => {
          const response = responses[source.id];
          const pending = pendingSourceIds.includes(source.id);
          const presentation = getSourcePresentation(response?.status, response?.count, pending, colors);
          return (
            <View
              key={source.id}
              style={[
                styles.sourceStatusRow,
                index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
              ]}>
              <SourceLogo source={source} compact />
              <View style={styles.sourceCopy}>
                <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                <ThemedText numberOfLines={1} style={[styles.sourceDescription, { color: colors.mutedText }]}>
                  {response?.message || source.domain}
                </ThemedText>
              </View>
              {pending ? (
                <ActivityIndicator color={colors.primary} size="small" />
              ) : (
                <View style={styles.sourceStatusValue}>
                  <MaterialCommunityIcons name={presentation.icon} size={15} color={presentation.color} />
                  <ThemedText style={[styles.sourceStatusText, { color: presentation.color }]}>{presentation.label}</ThemedText>
                </View>
              )}
            </View>
          );
        })}
      </View>
      <Pressable accessibilityRole="button" onPress={onCancel} style={[styles.secondaryButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="close" size={18} color={colors.text} />
        <ThemedText style={styles.secondaryButtonText}>停止搜索</ThemedText>
      </Pressable>
    </ScrollView>
  );
}

type ResultsPanelProps = {
  activeQuery: string;
  categoryFilter: ResourceResultCategory;
  failedSourceCount: number;
  feedback: string;
  onCategoryChange: (category: ResourceResultCategory) => void;
  onOpenSourceStatus: () => void;
  onQueryChange: (value: string) => void;
  onResultPress: (result: ResourceSearchResult) => void;
  onSearch: () => void;
  onSortChange: () => void;
  onSourceChange: (sourceId: string | 'all') => void;
  query: string;
  resultCount: number;
  results: ResourceSearchResult[];
  sortMode: SortMode;
  sourceFilter: string | 'all';
  sourceFilters: ResourceSearchSource[];
  sources: ResourceSearchSource[];
};

function ResultsPanel({
  activeQuery,
  categoryFilter,
  failedSourceCount,
  feedback,
  onCategoryChange,
  onOpenSourceStatus,
  onQueryChange,
  onResultPress,
  onSearch,
  onSortChange,
  onSourceChange,
  query,
  resultCount,
  results,
  sortMode,
  sourceFilter,
  sourceFilters,
  sources,
}: ResultsPanelProps) {
  const { colors } = useAppTheme();

  return (
    <ScrollView contentContainerStyle={styles.resultsContent} keyboardShouldPersistTaps="handled">
      <View style={[styles.compactSearch, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.primary} />
        <TextInput
          accessibilityLabel="修改搜索关键词"
          onChangeText={onQueryChange}
          onSubmitEditing={onSearch}
          returnKeyType="search"
          style={[styles.compactSearchInput, { color: colors.text }]}
          value={query}
        />
        <Pressable accessibilityLabel="重新搜索" accessibilityRole="button" onPress={onSearch} style={styles.compactSearchButton}>
          <MaterialCommunityIcons name="magnify" size={19} color="#ffffff" />
        </Pressable>
      </View>

      <View style={styles.resultSummary}>
        <View>
          <ThemedText style={styles.resultsTitle}>找到 {resultCount} 条结果</ThemedText>
          <ThemedText style={[styles.resultsSubtitle, { color: colors.mutedText }]}>“{activeQuery}”</ThemedText>
        </View>
        <Pressable accessibilityRole="button" onPress={onSortChange} style={styles.sortButton}>
          <ThemedText style={[styles.sortLabel, { color: colors.mutedText }]}>{sortMode === 'relevance' ? '综合排序' : '来源排序'}</ThemedText>
          <MaterialCommunityIcons name="sort-variant" size={16} color={colors.mutedText} />
        </Pressable>
      </View>

      {failedSourceCount ? (
        <Pressable
          accessibilityRole="button"
          onPress={onOpenSourceStatus}
          style={[styles.partialNotice, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="information-outline" size={18} color={colors.primary} />
          <ThemedText style={styles.partialNoticeText}>{failedSourceCount} 个来源需原站/暂不可聚合</ThemedText>
          <ThemedText style={[styles.partialNoticeAction, { color: colors.primary }]}>查看</ThemedText>
        </Pressable>
      ) : null}

      <View style={[styles.segments, { backgroundColor: colors.surfaceMuted }]}>
        {CATEGORY_OPTIONS.map((item) => {
          const active = categoryFilter === item.id;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={item.id}
              onPress={() => onCategoryChange(item.id)}
              style={[styles.segment, active ? { backgroundColor: colors.surface } : undefined]}>
              <ThemedText style={[styles.segmentText, { color: active ? colors.text : colors.mutedText }]}>{item.label}</ThemedText>
            </Pressable>
          );
        })}
      </View>

      {sourceFilters.length ? (
        <ScrollView contentContainerStyle={styles.filterRow} horizontal showsHorizontalScrollIndicator={false}>
          <SourceFilter
            active={sourceFilter === 'all'}
            label={`全部 ${resultCount}`}
            onPress={() => onSourceChange('all')}
          />
          {sourceFilters.map((source) => (
            <SourceFilter
              active={sourceFilter === source.id}
              key={source.id}
              label={`${source.name} ${source.id === 'laoer-motewan' ? resultCount : ''}`.trim()}
              onPress={() => onSourceChange(source.id)}
            />
          ))}
        </ScrollView>
      ) : null}

      {results.length ? (
        <View style={[styles.resultList, { borderTopColor: colors.line }]}>
          {results.map((result, index) => (
            <ResultRow
              index={index}
              key={result.id}
              onPress={() => onResultPress(result)}
              result={result}
              source={sources.find((item) => item.id === result.sourceId) ?? null}
            />
          ))}
        </View>
      ) : (
        <View style={styles.emptyResults}>
          <View style={[styles.emptyIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="file-search-outline" size={28} color={colors.primary} />
          </View>
          <ThemedText style={styles.emptyTitle}>暂未找到匹配结果</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>可调整关键词或查看来源状态</ThemedText>
          <Pressable accessibilityRole="button" onPress={onOpenSourceStatus} style={[styles.emptyAction, { borderColor: colors.line }]}>
            <ThemedText style={styles.emptyActionText}>查看来源状态</ThemedText>
          </Pressable>
        </View>
      )}
      {feedback ? <FeedbackLine message={feedback} /> : null}
    </ScrollView>
  );
}

function CompactSearchBar({ query }: { query: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.compactSearch, { backgroundColor: colors.surface, borderColor: colors.line }]}>
      <MaterialCommunityIcons name="magnify" size={20} color={colors.primary} />
      <ThemedText numberOfLines={1} style={styles.compactSearchText}>{query}</ThemedText>
    </View>
  );
}

function ResultRow({ index, onPress, result, source }: { index: number; onPress: () => void; result: ResourceSearchResult; source: ResourceSearchSource | null }) {
  const { colors } = useAppTheme();
  const meta = [result.diskType || result.category, result.size, result.updatedAt].filter(Boolean).join(' · ');
  return (
    <Pressable
      accessibilityLabel={`${result.title}，查看资源详情`}
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.resultRow,
        index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined,
      ]}>
      <SourceLogo source={source} compact />
      <View style={styles.resultCopy}>
        <ThemedText numberOfLines={2} style={styles.resultTitle}>{result.title}</ThemedText>
        <ThemedText numberOfLines={1} style={[styles.resultMeta, { color: colors.mutedText }]}>{meta || source?.name || '第三方来源'}</ThemedText>
        {index === 0 ? (
          <View style={styles.matchLine}>
            <MaterialCommunityIcons name="creation-outline" size={12} color={colors.primary} />
            <ThemedText style={[styles.matchText, { color: colors.primary }]}>匹配度最高 · 可按需解析</ThemedText>
          </View>
        ) : null}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={19} color={colors.mutedText} />
    </Pressable>
  );
}

function SourceFilter({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[styles.filterButton, { backgroundColor: active ? HERO_COLOR : colors.surface, borderColor: active ? HERO_COLOR : colors.line }]}>
      <ThemedText style={[styles.filterText, { color: active ? '#ffffff' : colors.mutedText }]}>{label}</ThemedText>
    </Pressable>
  );
}

type ResultDetailSheetProps = {
  error: string;
  onClose: () => void;
  onOpenOrigin: () => void;
  onOpenResource: () => void;
  resolving: boolean;
  resolvedURL?: string;
  result: ResourceSearchResult | null;
  sources: ResourceSearchSource[];
};

function ResultDetailSheet({ error, onClose, onOpenOrigin, onOpenResource, resolving, resolvedURL, result, sources }: ResultDetailSheetProps) {
  const { colors } = useAppTheme();
  if (!result) return null;
  const source = sources.find((item) => item.id === result.sourceId) ?? null;
  const linkReady = Boolean(resolvedURL || result.targetUrl);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭资源详情" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.detailSheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <ThemedText style={styles.sheetTitle}>资源详情</ThemedText>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose} style={[styles.sheetClose, { backgroundColor: colors.surfaceMuted }]}>
              <MaterialCommunityIcons name="close" size={20} color={colors.text} />
            </Pressable>
          </View>
          <View style={[styles.detailSource, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
            <SourceLogo source={source} compact />
            <View style={styles.sourceCopy}>
              <ThemedText style={styles.sourceName}>{source?.name || '第三方来源'}</ThemedText>
              <ThemedText style={[styles.sourceDescription, { color: colors.mutedText }]}>{source?.domain ? `${source.domain} · 第三方来源` : '第三方来源'}</ThemedText>
            </View>
            <View style={styles.availableState}>
              <MaterialCommunityIcons name={linkReady ? 'check-circle-outline' : 'link-variant'} size={15} color={colors.success} />
              <ThemedText style={[styles.availableText, { color: colors.success }]}>{linkReady ? '链接可用' : '可解析'}</ThemedText>
            </View>
          </View>
          <ThemedText style={styles.detailTitle}>{result.title}</ThemedText>
          <ThemedText style={[styles.detailDescription, { color: colors.mutedText }]}>结果已整理为统一格式，打开后直接进入资源链接。</ThemedText>
          <View style={styles.facts}>
            <Fact label="资源类型" value={result.diskType || result.category || '资源'} />
            <Fact label="文件大小" value={result.size || '未标注'} />
            <Fact label="更新时间" value={result.updatedAt || '来源未标注'} />
          </View>
          {error ? <FeedbackLine message={error} danger /> : null}
          <Pressable
            accessibilityRole="button"
            disabled={resolving}
            onPress={onOpenResource}
            style={[styles.primaryButton, resolving ? styles.disabled : undefined]}>
            {resolving ? <ActivityIndicator color="#ffffff" size="small" /> : <MaterialCommunityIcons name="link-variant" size={19} color="#ffffff" />}
            <ThemedText style={styles.primaryButtonText}>{resolving ? '正在解析链接' : '打开资源链接'}</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onOpenOrigin} style={[styles.detailSecondary, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name="open-in-new" size={18} color={colors.text} />
            <ThemedText style={styles.secondaryButtonText}>查看原站记录</ThemedText>
          </Pressable>
          <View style={styles.legalNote}>
            <MaterialCommunityIcons name="shield-check-outline" size={15} color={colors.mutedText} />
            <ThemedText style={[styles.legalText, { color: colors.mutedText }]}>结果来自第三方公开页面，FunBox 不存储资源内容。请在访问前确认来源与内容合规性。</ThemedText>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.fact, { backgroundColor: colors.surfaceMuted }]}>
      <ThemedText style={[styles.factLabel, { color: colors.mutedText }]}>{label}</ThemedText>
      <ThemedText numberOfLines={1} style={styles.factValue}>{value}</ThemedText>
    </View>
  );
}

type SourceStatusSheetProps = {
  onClose: () => void;
  onOpenURL: (url: string) => void;
  responses: Partial<Record<string, ResourceSearchSourceResponse>>;
  sources: ResourceSearchSource[];
  visible: boolean;
};

function SourceStatusSheet({ onClose, onOpenURL, responses, sources, visible }: SourceStatusSheetProps) {
  const { colors } = useAppTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭来源状态" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>来源状态</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>本次聚合搜索</ThemedText>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose}>
              <MaterialCommunityIcons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={styles.statusSheetList}>
            {sources.map((source, index) => {
              const response = responses[source.id];
              const presentation = getSourcePresentation(response?.status, response?.count, false, colors);
              return (
                <View key={source.id} style={[styles.statusSheetRow, index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined]}>
                  <SourceLogo source={source} compact />
                  <View style={styles.sourceCopy}>
                    <ThemedText style={styles.sourceName}>{source.name}</ThemedText>
                    <ThemedText numberOfLines={2} style={[styles.sourceDescription, { color: colors.mutedText }]}>{response?.message || `${response?.count || 0} 条结果`}</ThemedText>
                  </View>
                  {response?.status === 'success' || response?.status === 'empty' ? (
                    <ThemedText style={[styles.sourceStatusText, { color: presentation.color }]}>{presentation.label}</ThemedText>
                  ) : (
                    <Pressable accessibilityLabel={`打开${source.name}`} accessibilityRole="button" onPress={() => onOpenURL(response?.fallbackUrl || source.url)} style={styles.externalIconButton}>
                      <MaterialCommunityIcons name="open-in-new" size={17} color={colors.primary} />
                    </Pressable>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

type SourceOptionsSheetProps = {
  allSelected: boolean;
  onApply: () => void;
  onClose: () => void;
  onRestoreDefaults: () => void;
  onToggleAll: () => void;
  onToggleSource: (sourceId: string) => void;
  selectedSourceIds: string[];
  sources: ResourceSearchSource[];
  visible: boolean;
};

function SourceOptionsSheet({ allSelected, onApply, onClose, onRestoreDefaults, onToggleAll, onToggleSource, selectedSourceIds, sources, visible }: SourceOptionsSheetProps) {
  const { colors } = useAppTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭搜索源选项" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>搜索源筛选</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>已选择 {selectedSourceIds.length} 个来源</ThemedText>
            </View>
            <Pressable accessibilityLabel="关闭" accessibilityRole="button" onPress={onClose}>
              <MaterialCommunityIcons name="close" size={21} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView style={styles.optionsList}>
            {sources.map((source, index) => {
              const selected = selectedSourceIds.includes(source.id);
              return (
                <Pressable key={source.id} onPress={() => onToggleSource(source.id)} style={[styles.optionRow, index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined]}>
                  <SourceLogo source={source} compact />
                  <ThemedText style={[styles.sourceName, styles.optionName]}>{source.name}</ThemedText>
                  <View style={[styles.checkbox, { backgroundColor: selected ? colors.primary : 'transparent', borderColor: selected ? colors.primary : colors.line }]}>
                    {selected ? <MaterialCommunityIcons name="check" size={15} color="#ffffff" /> : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.sheetActions}>
            <Pressable accessibilityRole="button" onPress={onToggleAll} style={[styles.sheetActionButton, { borderColor: colors.line }]}>
              <ThemedText style={styles.sheetActionText}>{allSelected ? '取消全选' : '选择全部'}</ThemedText>
            </Pressable>
            <Pressable accessibilityRole="button" onPress={onRestoreDefaults} style={[styles.sheetActionButton, { borderColor: colors.line }]}>
              <ThemedText style={styles.sheetActionText}>恢复默认</ThemedText>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" disabled={!selectedSourceIds.length} onPress={onApply} style={[styles.primaryButton, !selectedSourceIds.length ? styles.disabled : undefined]}>
            <ThemedText style={styles.primaryButtonText}>应用并搜索</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

type HistorySheetProps = {
  history: string[];
  onClear: () => void;
  onClose: () => void;
  onSelect: (value: string) => void;
  visible: boolean;
};

function HistorySheet({ history, onClear, onClose, onSelect, visible }: HistorySheetProps) {
  const { colors } = useAppTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭搜索历史" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>最近搜索</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>选择一项重新搜索</ThemedText>
            </View>
            <Pressable accessibilityRole="button" onPress={onClear}>
              <ThemedText style={[styles.sheetLink, { color: colors.primary }]}>清空</ThemedText>
            </Pressable>
          </View>
          {history.length ? history.map((item, index) => (
            <Pressable key={item} onPress={() => onSelect(item)} style={[styles.historyRow, index > 0 ? { borderTopColor: colors.line, borderTopWidth: 1 } : undefined]}>
              <MaterialCommunityIcons name="history" size={18} color={colors.mutedText} />
              <ThemedText style={styles.historyText}>{item}</ThemedText>
              <MaterialCommunityIcons name="arrow-right" size={18} color={colors.mutedText} />
            </Pressable>
          )) : <ThemedText style={[styles.emptyHistory, { color: colors.mutedText }]}>还没有搜索记录</ThemedText>}
        </View>
      </View>
    </Modal>
  );
}

function SourceLogo({ compact = false, source }: { compact?: boolean; source: ResourceSearchSource | null }) {
  if (!source) {
    return (
      <View style={[styles.sourceLogo, compact ? styles.sourceLogoCompact : undefined, { backgroundColor: '#eef1f7' }]}>
        <ThemedText style={[styles.sourceLogoText, compact ? styles.sourceLogoTextCompact : undefined, { color: '#7483a2' }]}>?</ThemedText>
      </View>
    );
  }
  return (
    <View style={[styles.sourceLogo, compact ? styles.sourceLogoCompact : undefined, { backgroundColor: source.logoBackground }]}>
      <ThemedText style={[styles.sourceLogoText, compact ? styles.sourceLogoTextCompact : undefined, { color: source.logoColor }]}>{source.logo}</ThemedText>
    </View>
  );
}

function FeedbackLine({ danger = false, message }: { danger?: boolean; message: string }) {
  const { colors } = useAppTheme();
  const color = danger ? colors.accent : colors.primary;
  return (
    <View style={styles.feedbackLine}>
      <MaterialCommunityIcons name={danger ? 'alert-circle-outline' : 'information-outline'} size={16} color={color} />
      <ThemedText style={[styles.feedbackText, { color: colors.mutedText }]}>{message}</ThemedText>
    </View>
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
        const color = item.selected ? colors.primary : colors.tabInactive;
        return (
          <Pressable accessibilityLabel={item.label} accessibilityRole="tab" accessibilityState={{ selected: Boolean(item.selected) }} key={item.label} onPress={item.onPress} style={styles.bottomNavItem}>
            <MaterialCommunityIcons name={item.icon} size={22} color={color} />
            <ThemedText style={[styles.bottomNavLabel, { color }]}>{item.label}</ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

function getResultCategory(result: ResourceSearchResult): ResourceResultCategory {
  const value = `${result.category} ${result.title}`.toLowerCase();
  if (/(apk|android|ios|windows|mac|linux|软件|插件|工具)/i.test(value)) return 'software';
  if (/(pdf|epub|mobi|书籍|资料|教程|课件|文档|小说)/i.test(value)) return 'document';
  if (/(4k|hdr|电影|电视剧|剧集|动漫|综艺|纪录片|蓝光|remux|字幕)/i.test(value)) return 'media';
  return 'resource';
}

function sortResults(results: ResourceSearchResult[], mode: SortMode) {
  if (mode === 'relevance') return results;
  return [...results].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
}

function getSourcePresentation(
  status: ResourceSearchSourceStatus | undefined,
  count: number | undefined,
  pending: boolean,
  colors: ReturnType<typeof useAppTheme>['colors'],
) {
  if (pending || !status) return { color: colors.primary, icon: 'progress-clock' as IconName, label: '搜索中' };
  const values: Record<ResourceSearchSourceStatus, { color: string; icon: IconName; label: string }> = {
    direct: { color: colors.primary, icon: 'open-in-new', label: '去原站' },
    empty: { color: colors.mutedText, icon: 'minus-circle-outline', label: '无结果' },
    error: { color: CORAL, icon: 'alert-circle-outline', label: '失败' },
    restricted: { color: CORAL, icon: 'shield-lock-outline', label: '需原站' },
    success: { color: colors.success, icon: 'check-circle-outline', label: `${count || 0} 条` },
    timeout: { color: CORAL, icon: 'clock-alert-outline', label: '超时' },
    unavailable: { color: colors.mutedText, icon: 'cloud-off-outline', label: '不可用' },
  };
  return values[status];
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  screenShell: { alignSelf: 'center', flex: 1, maxWidth: appLayout.screenMaxWidth, overflow: 'hidden', width: '100%' },
  topBar: { alignItems: 'center', borderBottomWidth: 1, flexDirection: 'row', height: 64, justifyContent: 'space-between', paddingHorizontal: 16 },
  topBarSide: { alignItems: 'flex-start', height: 40, justifyContent: 'center', width: 40 },
  topBarTitle: { fontSize: 17, fontWeight: '900', lineHeight: 23 },
  topBarAction: { alignItems: 'center', borderRadius: 13, borderWidth: 1, height: 40, justifyContent: 'center', width: 40 },
  body: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: 30, paddingHorizontal: 16, paddingTop: 16 },
  resultsContent: { paddingBottom: 30, paddingHorizontal: 16, paddingTop: 14 },
  sourceState: { alignItems: 'center', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 9, marginTop: 12, minHeight: 48, paddingHorizontal: 12 },
  sourceStateText: { flex: 1, fontSize: 10, fontWeight: '700', lineHeight: 15 },
  sourceStateAction: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  hero: { backgroundColor: HERO_COLOR, borderRadius: 24, minHeight: 248, overflow: 'hidden', padding: 22, position: 'relative' },
  heroTextureTop: { borderColor: 'rgba(255,255,255,0.12)', borderRadius: 18, borderWidth: 1, height: 112, position: 'absolute', right: -44, top: -30, transform: [{ rotate: '-17deg' }], width: 220 },
  heroTextureBottom: { borderColor: 'rgba(255,255,255,0.12)', borderRadius: 18, borderWidth: 1, height: 112, position: 'absolute', right: -78, top: 96, transform: [{ rotate: '-17deg' }], width: 220 },
  heroMeta: { alignItems: 'center', flexDirection: 'row', gap: 7 },
  heroMetaText: { color: LIME, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  heroTitle: { color: '#ffffff', fontSize: 28, fontWeight: '900', lineHeight: 36, marginBottom: 17, marginTop: 17 },
  heroSearch: { alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 15, flexDirection: 'row', gap: 9, height: 54, paddingLeft: 14, paddingRight: 8 },
  heroInput: { flex: 1, fontSize: 13, height: 50, minWidth: 0, padding: 0 },
  heroSearchButton: { alignItems: 'center', backgroundColor: LIME, borderRadius: 12, height: 38, justifyContent: 'center', width: 38 },
  heroFeedback: { color: CORAL, fontSize: 11, fontWeight: '700', lineHeight: 16, marginTop: 8 },
  sectionHeader: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 11, marginTop: 19, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 18, fontWeight: '900', lineHeight: 24 },
  sectionMetaLeft: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  sectionAction: { fontSize: 11, fontWeight: '900', lineHeight: 17, paddingVertical: 4 },
  sourceList: { borderRadius: 20, borderWidth: 1, overflow: 'hidden' },
  sourceRow: { alignItems: 'center', flexDirection: 'row', gap: 12, minHeight: 68, paddingHorizontal: 13, paddingVertical: 11 },
  sourceStatusRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 60, paddingHorizontal: 12, paddingVertical: 9 },
  sourceLogo: { alignItems: 'center', borderRadius: 13, height: 42, justifyContent: 'center', width: 42 },
  sourceLogoCompact: { borderRadius: 10, height: 34, width: 34 },
  sourceLogoText: { fontSize: 12, fontWeight: '900', lineHeight: 17 },
  sourceLogoTextCompact: { fontSize: 9, lineHeight: 13 },
  sourceCopy: { flex: 1, minWidth: 0 },
  sourceName: { fontSize: 12, fontWeight: '900', lineHeight: 18 },
  sourceDescription: { fontSize: 9, lineHeight: 14, marginTop: 2 },
  checkbox: { alignItems: 'center', borderRadius: 8, borderWidth: 1.5, height: 24, justifyContent: 'center', width: 24 },
  compactSearch: { alignItems: 'center', borderRadius: 16, borderWidth: 1, flexDirection: 'row', gap: 10, height: 52, paddingHorizontal: 12 },
  compactSearchText: { flex: 1, fontSize: 14, fontWeight: '800', lineHeight: 20 },
  compactSearchInput: { flex: 1, fontSize: 14, fontWeight: '800', height: 48, minWidth: 0, padding: 0 },
  compactSearchButton: { alignItems: 'center', backgroundColor: BRAND_BLUE, borderRadius: 11, height: 36, justifyContent: 'center', width: 36 },
  loadingHeading: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, paddingHorizontal: 2 },
  resultsTitle: { fontSize: 21, fontWeight: '900', lineHeight: 28 },
  resultsSubtitle: { fontSize: 10, lineHeight: 16, marginTop: 2 },
  progressCard: { backgroundColor: HERO_COLOR, borderRadius: 18, marginTop: 12, padding: 15 },
  progressTop: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  progressLabel: { alignItems: 'center', flexDirection: 'row', gap: 8 },
  progressLabelText: { color: '#ffffff', fontSize: 12, fontWeight: '900', lineHeight: 17 },
  progressCount: { color: LIME, fontSize: 11, fontWeight: '900', lineHeight: 16 },
  progressTrack: { backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 4, height: 5, marginTop: 13, overflow: 'hidden' },
  progressFill: { backgroundColor: LIME, borderRadius: 4, height: 5 },
  loadingSourceList: { marginTop: 12 },
  sourceStatusValue: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  sourceStatusText: { fontSize: 9, fontWeight: '900', lineHeight: 14 },
  secondaryButton: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, height: 46, justifyContent: 'center', marginTop: 12 },
  secondaryButtonText: { fontSize: 11, fontWeight: '900', lineHeight: 16 },
  resultSummary: { alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10, marginTop: 15, paddingHorizontal: 2 },
  sortButton: { alignItems: 'center', flexDirection: 'row', gap: 4, paddingVertical: 5 },
  sortLabel: { fontSize: 9, fontWeight: '800', lineHeight: 14 },
  partialNotice: { alignItems: 'center', borderRadius: 13, borderWidth: 1, flexDirection: 'row', gap: 8, marginBottom: 10, minHeight: 42, paddingHorizontal: 11 },
  partialNoticeText: { flex: 1, fontSize: 10, fontWeight: '800', lineHeight: 15 },
  partialNoticeAction: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  segments: { borderRadius: 13, flexDirection: 'row', gap: 3, height: 40, padding: 3 },
  segment: { alignItems: 'center', borderRadius: 10, flex: 1, justifyContent: 'center' },
  segmentText: { fontSize: 10, fontWeight: '800', lineHeight: 15 },
  filterRow: { gap: 7, paddingBottom: 8, paddingTop: 10 },
  filterButton: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 7 },
  filterText: { fontSize: 9, fontWeight: '800', lineHeight: 13 },
  resultList: { borderTopWidth: 1 },
  resultRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 83, paddingHorizontal: 2, paddingVertical: 12 },
  resultCopy: { flex: 1, minWidth: 0 },
  resultTitle: { fontSize: 12, fontWeight: '900', lineHeight: 18 },
  resultMeta: { fontSize: 9, lineHeight: 14, marginTop: 4 },
  matchLine: { alignItems: 'center', flexDirection: 'row', gap: 4, marginTop: 5 },
  matchText: { fontSize: 8, fontWeight: '900', lineHeight: 12 },
  emptyResults: { alignItems: 'center', paddingHorizontal: 24, paddingVertical: 54 },
  emptyIcon: { alignItems: 'center', borderRadius: 20, height: 58, justifyContent: 'center', width: 58 },
  emptyTitle: { fontSize: 16, fontWeight: '900', lineHeight: 22, marginTop: 15 },
  emptyText: { fontSize: 10, lineHeight: 16, marginTop: 4, textAlign: 'center' },
  emptyAction: { borderRadius: 12, borderWidth: 1, marginTop: 15, paddingHorizontal: 16, paddingVertical: 9 },
  emptyActionText: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  modalRoot: { alignItems: 'center', flex: 1, justifyContent: 'flex-end' },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(9,15,30,0.56)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, maxHeight: '82%', maxWidth: appLayout.screenMaxWidth, paddingBottom: 22, paddingHorizontal: 18, paddingTop: 18, width: '100%' },
  detailSheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, maxWidth: appLayout.screenMaxWidth, paddingBottom: 22, paddingHorizontal: 18, paddingTop: 10, width: '100%' },
  sheetHandle: { alignSelf: 'center', backgroundColor: '#d9deea', borderRadius: 4, height: 4, marginBottom: 11, width: 38 },
  sheetHeader: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  sheetTitle: { fontSize: 19, fontWeight: '900', lineHeight: 26 },
  sheetMeta: { fontSize: 10, lineHeight: 15, marginTop: 2 },
  sheetLink: { fontSize: 11, fontWeight: '900', lineHeight: 17 },
  sheetClose: { alignItems: 'center', borderRadius: 11, height: 34, justifyContent: 'center', width: 34 },
  detailSource: { alignItems: 'center', borderRadius: 15, borderWidth: 1, flexDirection: 'row', gap: 10, padding: 10 },
  availableState: { alignItems: 'center', flexDirection: 'row', gap: 4 },
  availableText: { fontSize: 8, fontWeight: '900', lineHeight: 13 },
  detailTitle: { fontSize: 20, fontWeight: '900', lineHeight: 28, marginTop: 15 },
  detailDescription: { fontSize: 10, lineHeight: 17, marginTop: 5 },
  facts: { flexDirection: 'row', gap: 8, marginTop: 13 },
  fact: { borderRadius: 12, flex: 1, minWidth: 0, padding: 10 },
  factLabel: { fontSize: 8, lineHeight: 12 },
  factValue: { fontSize: 10, fontWeight: '900', lineHeight: 15, marginTop: 3 },
  primaryButton: { alignItems: 'center', backgroundColor: BRAND_BLUE, borderRadius: 15, flexDirection: 'row', gap: 8, height: 50, justifyContent: 'center', marginTop: 14 },
  primaryButtonText: { color: '#ffffff', fontSize: 12, fontWeight: '900', lineHeight: 18 },
  detailSecondary: { alignItems: 'center', borderRadius: 14, borderWidth: 1, flexDirection: 'row', gap: 8, height: 46, justifyContent: 'center', marginTop: 8 },
  legalNote: { alignItems: 'flex-start', flexDirection: 'row', gap: 7, marginTop: 11, paddingHorizontal: 2 },
  legalText: { flex: 1, fontSize: 8, lineHeight: 13 },
  feedbackLine: { alignItems: 'flex-start', flexDirection: 'row', gap: 7, marginTop: 10, paddingHorizontal: 2 },
  feedbackText: { flex: 1, fontSize: 10, lineHeight: 16 },
  statusSheetList: { maxHeight: 430 },
  statusSheetRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 61, paddingVertical: 9 },
  externalIconButton: { alignItems: 'center', height: 34, justifyContent: 'center', width: 34 },
  optionsList: { maxHeight: 380 },
  optionRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 54, paddingVertical: 8 },
  optionName: { flex: 1 },
  sheetActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  sheetActionButton: { alignItems: 'center', borderRadius: 12, borderWidth: 1, flex: 1, height: 40, justifyContent: 'center' },
  sheetActionText: { fontSize: 10, fontWeight: '900', lineHeight: 15 },
  historyRow: { alignItems: 'center', flexDirection: 'row', gap: 10, minHeight: 50 },
  historyText: { flex: 1, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  emptyHistory: { fontSize: 13, lineHeight: 20, paddingVertical: 28, textAlign: 'center' },
  bottomNav: { borderTopWidth: 1, flexDirection: 'row', height: 72, paddingBottom: 8, paddingTop: 8 },
  bottomNavItem: { alignItems: 'center', flex: 1, gap: 3, justifyContent: 'center' },
  bottomNavLabel: { fontSize: 10, fontWeight: '800', lineHeight: 14 },
  disabled: { opacity: 0.45 },
});
