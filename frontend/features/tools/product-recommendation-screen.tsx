import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
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

import { ThemedText } from '@/components/themed-text';
import { useAuth } from '@/features/auth/auth-provider';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  buildRecommendationRequest,
  countActiveFilters,
  emptyFilter,
  filterRecommendationItems,
  formatPrice,
  formatPriceSource,
  getPlatformLabel,
  PLATFORM_OPTIONS,
  SCENARIO_OPTIONS,
  sortRecommendationItems,
  summarizeRequest,
  type RecommendationFilter,
  type RecommendationSortKey,
} from '@/lib/product-recommendation';
import {
  fetchProductRecommendationHistory,
  fetchProductRecommendationQuery,
  getProductRecommendationErrorMessage,
  queryProductRecommendation,
  submitProductRecommendationFeedback,
} from '@/lib/product-recommendation-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  AvailableFilters,
  FilterOption,
  PlatformLink,
  ProductRecommendationRequest,
  ProductRecommendationResponse,
  RecommendationHistoryItem,
  RecommendationItem,
  RecommendationPlatform,
} from '@/types/product-recommendation';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#e85d4a';
const GREEN = '#24b36b';
const AMBER = '#f1a33b';

const QUICK_EXAMPLES = ['手机', '耳机', '平板', '3000左右手机', '拍照手机'];

const SORT_OPTIONS: { id: RecommendationSortKey; label: string }[] = [
  { id: 'fit', label: '综合' },
  { id: 'price-asc', label: '价格' },
  { id: 'fit', label: '匹配度' },
];

const FOLLOW_UP_ACTIONS: { label: string; icon: IconName; apply: (input: ProductRecommendationRequest) => ProductRecommendationRequest }[] = [
  {
    label: '再便宜一点',
    icon: 'arrow-down-bold-circle-outline',
    apply: (input) => ({ ...input, budgetMax: input.budgetMax ? Math.round(input.budgetMax * 0.8) : undefined }),
  },
  {
    label: '更看重拍照',
    icon: 'camera-outline',
    apply: (input) => ({
      ...input,
      scenarios: Array.from(new Set([...(input.scenarios ?? []), '影像'])),
    }),
  },
  {
    label: '优先续航',
    icon: 'battery-charging',
    apply: (input) => ({
      ...input,
      scenarios: Array.from(new Set([...(input.scenarios ?? []), '续航'])),
    }),
  },
  {
    label: '只看京东',
    icon: 'shopping-outline',
    apply: (input) => ({ ...input, platforms: ['jd'] }),
  },
];

export function ProductRecommendationScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus } = useAuth();
  const [queryText, setQueryText] = useState('想买手机，3000 左右');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('直接说想买什么，结果不满意再筛选。');
  const [result, setResult] = useState<ProductRecommendationResponse | null>(null);
  const [showInput, setShowInput] = useState(true);
  const [selectedItem, setSelectedItem] = useState<RecommendationItem | null>(null);
  const [comparing, setComparing] = useState(false);
  const [sortKey, setSortKey] = useState<RecommendationSortKey>('fit');
  const [filterApplied, setFilterApplied] = useState<RecommendationFilter>(emptyFilter());
  const [filterDraft, setFilterDraft] = useState<RecommendationFilter>(emptyFilter());
  const [showFilter, setShowFilter] = useState(false);
  const [history, setHistory] = useState<RecommendationHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 'helpful' | 'not' | undefined>>({});

  async function refreshHistory() {
    if (authStatus !== 'authenticated' || !accessToken) return;
    try {
      const items = await fetchProductRecommendationHistory(accessToken);
      setHistory(items);
    } catch {
      // History is optional; keep local entries when the server is unavailable.
    }
  }

  async function runQuery(overrides?: Partial<ProductRecommendationRequest>) {
    const request = buildRecommendationRequest({
      query: queryText,
      category: '',
      brands: [],
      scenarios: [],
      platforms: [],
    });
    const payload = { ...request, ...overrides };
    if (!payload.query.trim()) {
      setStatusMessage('先告诉我想买什么，例如：想买手机。');
      return;
    }

    setSubmitting(true);
    setStatusMessage('正在分析需求并生成推荐...');
    try {
      const next = await queryProductRecommendation(payload, accessToken);
      setResult(next);
      setSelectedItem(null);
      setComparing(false);
      setShowInput(false);
      setSortKey('fit');
      setFilterApplied(emptyFilter());
      setFilterDraft(emptyFilter());
      setStatusMessage(
        next.ai === 'deepseek'
          ? `已生成 ${next.items.length} 款推荐，理由来自 DeepSeek 分析。`
          : `已生成 ${next.items.length} 款推荐，当前为规则匹配模式。`,
      );
      setHistory((previous) => [
        {
          queryId: next.queryId,
          query: summarizeRequest(payload),
          category: next.category,
          summary: next.summary,
          productCount: next.items.length,
          createdAt: next.generatedAt,
        },
        ...previous,
      ].slice(0, 20));
      void refreshHistory();
    } catch (error) {
      setStatusMessage(getProductRecommendationErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFeedback(item: RecommendationItem, helpful: boolean) {
    if (!result) return;
    setFeedback((current) => ({ ...current, [item.productId]: helpful ? 'helpful' : 'not' }));
    setStatusMessage(helpful ? '已记录有帮助反馈。' : '已记录反馈，我们会继续校准推荐。');
    try {
      await submitProductRecommendationFeedback(
        { queryId: result.queryId, productId: item.productId, helpful },
        accessToken,
      );
    } catch {
      // Keep the local feedback state even when the server is unavailable.
    }
  }

  function openLink(link: PlatformLink) {
    Linking.openURL(link.url).catch(() => {
      setStatusMessage('当前环境无法打开该平台链接。');
    });
  }

  async function handleHistorySelect(item: RecommendationHistoryItem) {
    setShowHistory(false);
    setSubmitting(true);
    setStatusMessage('正在加载历史推荐结果...');
    try {
      const next = await fetchProductRecommendationQuery(item.queryId, accessToken);
      setResult(next);
      setSelectedItem(null);
      setComparing(false);
      setShowInput(false);
      setSortKey('fit');
      setFilterApplied(emptyFilter());
      setStatusMessage(`已加载 ${next.items.length} 款历史推荐结果。`);
    } catch (error) {
      setStatusMessage(getProductRecommendationErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function openFilterPanel() {
    setFilterDraft({
      budgetRange: filterApplied.budgetRange,
      brands: [...filterApplied.brands],
      scenarios: [...filterApplied.scenarios],
      platforms: [...filterApplied.platforms],
    });
    setShowFilter(true);
  }

  function applyFilter() {
    setFilterApplied({
      budgetRange: filterDraft.budgetRange,
      brands: [...filterDraft.brands],
      scenarios: [...filterDraft.scenarios],
      platforms: [...filterDraft.platforms],
    });
    setShowFilter(false);
    setStatusMessage('筛选已应用到当前结果。');
  }

  const filteredItems = result
    ? sortRecommendationItems(filterRecommendationItems(result.items, filterApplied), sortKey)
    : [];
  const filterCount = countActiveFilters(filterApplied);

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <PageHeader
        eyebrow="AI Shopping"
        title="智能商品推荐"
        subtitle="先说想买什么，结果不满意再筛选"
        rightSlot={
          <View style={styles.headerActions}>
            <HeaderIconButton
              accessibilityLabel="查看历史记录"
              icon="history"
              onPress={() => {
                void refreshHistory();
                setShowHistory(true);
              }}
            />
            <HeaderIconButton accessibilityLabel="返回" icon="arrow-left" onPress={() => router.back()} />
          </View>
        }
      />

      <StatusLine
        color={submitting ? AMBER : result ? GREEN : BLUE}
        icon={submitting ? 'progress-clock' : result ? 'check-circle-outline' : 'shopping-search'}
        message={statusMessage}
      />

      {selectedItem ? (
        <DetailView
          colors={colors}
          item={selectedItem}
          onBack={() => setSelectedItem(null)}
          onOpenLink={openLink}
        />
      ) : comparing ? (
        <CompareView
          colors={colors}
          items={filteredItems.slice(0, 4)}
          onBack={() => setComparing(false)}
          onOpenLink={openLink}
        />
      ) : showInput || !result ? (
        <InputHero
          colors={colors}
          onExamplePress={setQueryText}
          onQueryChange={setQueryText}
          onStart={() => void runQuery()}
          queryText={queryText}
          submitting={submitting}
        />
      ) : (
        <ResultsView
          colors={colors}
          feedback={feedback}
          filterCount={filterCount}
          items={filteredItems}
          onCompare={() => setComparing(true)}
          onFeedback={(item, helpful) => void submitFeedback(item, helpful)}
          onFilterOpen={openFilterPanel}
          onFollowUp={(action) => {
            const request = buildRecommendationRequest({
              query: queryText,
              category: '',
              brands: [],
              scenarios: [],
              platforms: [],
            });
            const adjusted = action.apply(request);
            setQueryText(adjusted.query);
            void runQuery(adjusted);
          }}
          onOpenDetail={setSelectedItem}
          onOpenLink={openLink}
          onResetInput={() => {
            setResult(null);
            setShowInput(true);
            setStatusMessage('换个需求试试，只输入一句话就行。');
          }}
          onResetFilter={() => setFilterApplied(emptyFilter())}
          onSort={setSortKey}
          result={result}
          sortKey={sortKey}
        />
      )}

      <FilterSheet
        availableFilters={result?.availableFilters ?? emptyAvailableFilters()}
        colors={colors}
        draft={filterDraft}
        onApply={applyFilter}
        onBudgetSelect={(option) => setFilterDraft((current) => ({ ...current, budgetRange: option }))}
        onBrandToggle={(brand) => toggleDraftValue('brands', brand)}
        onClose={() => setShowFilter(false)}
        onPlatformToggle={(platform) => toggleDraftValue('platforms', platform)}
        onReset={() => setFilterDraft(emptyFilter())}
        onScenarioToggle={(scenario) => toggleDraftValue('scenarios', scenario)}
        visible={showFilter}
      />

      <HistoryModal
        colors={colors}
        items={history}
        onClose={() => setShowHistory(false)}
        onSelect={(item) => void handleHistorySelect(item)}
        visible={showHistory}
      />
    </MobileScreen>
  );

  function toggleDraftValue(key: 'brands' | 'scenarios' | 'platforms', value: string) {
    setFilterDraft((current) => {
      const values = current[key] as string[];
      return {
        ...current,
        [key]: values.includes(value) ? values.filter((item) => item !== value) : [...values, value],
      };
    });
  }
}

function InputHero({
  colors,
  onExamplePress,
  onQueryChange,
  onStart,
  queryText,
  submitting,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  onExamplePress: (text: string) => void;
  onQueryChange: (text: string) => void;
  onStart: () => void;
  queryText: string;
  submitting: boolean;
}) {
  return (
    <View style={styles.heroBlock}>
      <ThemedText style={styles.heroTitle}>想买什么？</ThemedText>
      <ThemedText style={[styles.heroSub, { color: colors.mutedText }]}>
        直接说就行，品类、预算、品牌都可以先不选
      </ThemedText>

      <View style={[styles.heroSearch, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="购买需求"
          onChangeText={onQueryChange}
          placeholder="想买什么？直接说，例如：想买手机"
          placeholderTextColor={colors.mutedText}
          style={[styles.heroInput, { color: colors.text }]}
          value={queryText}
        />
        <Pressable
          accessibilityLabel="语音输入"
          accessibilityRole="button"
          style={[styles.heroMic, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="microphone-outline" size={18} color={colors.primary} />
        </Pressable>
      </View>

      <ThemedText style={[styles.exampleLabel, { color: colors.mutedText }]}>
        不知道怎么描述？点一下试试
      </ThemedText>
      <View style={styles.exampleRow}>
        {QUICK_EXAMPLES.map((example) => (
          <Pressable
            accessibilityRole="button"
            key={example}
            onPress={() => onExamplePress(example)}
            style={[
              styles.exampleChip,
              {
                backgroundColor: queryText === example ? colors.primarySoft : colors.surface,
                borderColor: queryText === example ? BLUE : colors.line,
              },
            ]}>
            <ThemedText
              style={[styles.exampleChipText, { color: queryText === example ? BLUE : colors.text }]}>
              {example}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityLabel="AI 生成推荐"
        accessibilityRole="button"
        disabled={submitting}
        onPress={onStart}
        style={[styles.primaryButton, { backgroundColor: HERO, opacity: submitting ? 0.72 : 1 }]}>
        {submitting ? (
          <ActivityIndicator color={LIME} />
        ) : (
          <>
            <MaterialCommunityIcons name="auto-fix" size={19} color={LIME} />
            <ThemedText style={styles.primaryButtonText}>AI 生成推荐</ThemedText>
          </>
        )}
      </Pressable>
      <ThemedText style={[styles.heroHint, { color: colors.mutedText }]}>
        先看结果，不满意再展开筛选，就像京东购物一样
      </ThemedText>
    </View>
  );
}

function ResultsView({
  colors,
  feedback,
  filterCount,
  items,
  onCompare,
  onFeedback,
  onFilterOpen,
  onFollowUp,
  onOpenDetail,
  onOpenLink,
  onResetInput,
  onResetFilter,
  onSort,
  result,
  sortKey,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  feedback: Record<string, 'helpful' | 'not' | undefined>;
  filterCount: number;
  items: RecommendationItem[];
  onCompare: () => void;
  onFeedback: (item: RecommendationItem, helpful: boolean) => void;
  onFilterOpen: () => void;
  onFollowUp: (action: (typeof FOLLOW_UP_ACTIONS)[number]) => void;
  onOpenDetail: (item: RecommendationItem) => void;
  onOpenLink: (link: PlatformLink) => void;
  onResetInput: () => void;
  onResetFilter: () => void;
  onSort: (sortKey: RecommendationSortKey) => void;
  result: ProductRecommendationResponse;
  sortKey: RecommendationSortKey;
}) {
  return (
    <View style={styles.resultsBlock}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryCopy}>
          <ThemedText style={styles.summaryTitle}>为你找到 {items.length} 款{categoryText(result.category)}</ThemedText>
          <ThemedText style={[styles.summaryMeta, { color: colors.mutedText }]}>
            {result.ai === 'deepseek' ? 'DeepSeek 分析' : '规则匹配'} · 参考价以平台为准
          </ThemedText>
        </View>
        <View style={[styles.aiPill, { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.aiPillText, { color: BLUE }]}>AI 分析</ThemedText>
        </View>
      </View>

      <View style={styles.toolbar}>
        <View style={[styles.sortRow, { backgroundColor: colors.surfaceMuted }]}>
          {SORT_OPTIONS.map((option, index) => {
            const active = option.label === '价格' ? sortKey === 'price-asc' : sortKey === 'fit';
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={`${option.label}-${index}`}
                onPress={() => onSort(option.id)}
                style={[styles.sortItem, active && { backgroundColor: colors.surface }]}>
                <ThemedText style={[styles.sortItemText, { color: active ? colors.text : colors.mutedText }]}>
                  {option.label}
                </ThemedText>
              </Pressable>
            );
          })}
        </View>
        <Pressable
          accessibilityLabel="打开筛选"
          accessibilityRole="button"
          onPress={onFilterOpen}
          style={[styles.filterButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="tune-variant" size={16} color={BLUE} />
          <ThemedText style={[styles.filterButtonText, { color: colors.text }]}>筛选</ThemedText>
          {filterCount > 0 ? (
            <View style={styles.filterBadge}>
              <ThemedText style={styles.filterBadgeText}>{filterCount}</ThemedText>
            </View>
          ) : null}
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.followUpRow}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {FOLLOW_UP_ACTIONS.map((action) => (
          <Pressable
            accessibilityRole="button"
            key={action.label}
            onPress={() => onFollowUp(action)}
            style={[styles.followUpChip, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name={action.icon} size={15} color={BLUE} />
            <ThemedText style={[styles.followUpText, { color: colors.text }]}>{action.label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {items.length === 0 ? (
        <SurfaceCard style={[styles.emptyCard, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="filter-off-outline" size={30} color={colors.mutedText} />
          <ThemedText style={styles.emptyTitle}>没有符合条件的商品</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            试试重置筛选，或换一句需求重新生成
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={onResetFilter}
            style={[styles.emptyResetButton, { borderColor: colors.line }]}>
            <ThemedText style={[styles.emptyResetText, { color: BLUE }]}>重置筛选</ThemedText>
          </Pressable>
        </SurfaceCard>
      ) : (
        <View style={styles.itemList}>
          {items.map((item, index) => (
            <RecommendationCard
              colors={colors}
              feedback={feedback[item.productId]}
              index={index}
              item={item}
              key={item.productId}
              onFeedback={(helpful) => onFeedback(item, helpful)}
              onOpen={() => onOpenDetail(item)}
              onOpenLink={onOpenLink}
            />
          ))}
        </View>
      )}

      {items.length >= 2 ? (
        <Pressable
          accessibilityLabel="开始对比推荐商品"
          accessibilityRole="button"
          onPress={onCompare}
          style={[styles.compareButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="scale-balance" size={18} color={BLUE} />
          <ThemedText style={[styles.compareButtonText, { color: colors.text }]}>
            对比前 {Math.min(items.length, 4)} 款
          </ThemedText>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
        </Pressable>
      ) : null}

      <Pressable
        accessibilityLabel="换个需求重新输入"
        accessibilityRole="button"
        onPress={onResetInput}
        style={[styles.resetInputButton, { borderColor: colors.line }]}>
        <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.mutedText} />
        <ThemedText style={[styles.resetInputText, { color: colors.mutedText }]}>换个需求</ThemedText>
      </Pressable>
      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>{result.disclaimer}</ThemedText>
    </View>
  );
}

function RecommendationCard({
  colors,
  feedback,
  index,
  item,
  onFeedback,
  onOpen,
  onOpenLink,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  feedback?: 'helpful' | 'not';
  index: number;
  item: RecommendationItem;
  onFeedback: (helpful: boolean) => void;
  onOpen: () => void;
  onOpenLink: (link: PlatformLink) => void;
}) {
  return (
    <SurfaceCard style={[styles.recommendationCard, { borderTopColor: BLUE }]}>
      <View style={styles.cardHeader}>
        <View style={[styles.productIcon, { backgroundColor: item.brand === '苹果' ? '#232c4d' : colors.surfaceMuted }]}>
          <MaterialCommunityIcons name={productIcon(item)} size={22} color={item.brand === '苹果' ? LIME : BLUE} />
        </View>
        <Pressable
          accessibilityLabel={`查看${item.name}详情`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.cardMain}>
          <View style={styles.cardTitleRow}>
            <ThemedText numberOfLines={1} style={styles.cardTitle}>{item.name}</ThemedText>
            <View style={[styles.scorePill, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.scoreText, { color: BLUE }]}>{item.fitScore} 分</ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.cardBrand, { color: colors.mutedText }]}>
            {item.brand} · {formatPrice(item.referencePrice)} · {formatPriceSource(item.priceSource)}
          </ThemedText>
        </Pressable>
      </View>

      <View style={styles.reasonList}>
        {item.reasons.slice(0, 3).map((reason) => (
          <View key={`${reason.label}-${reason.text}`} style={styles.reasonRow}>
            <View style={[styles.reasonPill, { backgroundColor: reasonColor(reason.label) }]}>
              <ThemedText style={styles.reasonPillText}>{reason.label}</ThemedText>
            </View>
            <ThemedText numberOfLines={2} style={[styles.reasonText, { color: colors.text }]}>
              {reason.text}
            </ThemedText>
          </View>
        ))}
      </View>

      <ThemedText style={[styles.suitableLine, { color: colors.mutedText }]}>{item.suitableFor}</ThemedText>

      <View style={styles.platformRow}>
        {item.links.map((link) => (
          <Pressable
            accessibilityLabel={`在${link.label}查看${item.name}`}
            accessibilityRole="button"
            key={link.platform}
            onPress={() => onOpenLink(link)}
            style={[styles.platformButton, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
            <MaterialCommunityIcons name={platformIcon(link.platform)} size={15} color={platformColor(link.platform)} />
            <ThemedText style={[styles.platformButtonText, { color: platformColor(link.platform) }]}>
              {getPlatformLabel(link.platform)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.feedbackRow}>
        <ThemedText style={[styles.feedbackHint, { color: colors.mutedText }]}>
          {index === 0 ? '最推荐' : `候选 ${index + 1}`}
        </ThemedText>
        <View style={styles.feedbackActions}>
          <Pressable
            accessibilityLabel={`${item.name}有帮助`}
            accessibilityRole="button"
            onPress={() => onFeedback(true)}
            style={[styles.feedbackButton, { borderColor: feedback === 'helpful' ? GREEN : colors.line }]}>
            <MaterialCommunityIcons
              name={feedback === 'helpful' ? 'thumb-up' : 'thumb-up-outline'}
              size={14}
              color={feedback === 'helpful' ? GREEN : colors.mutedText}
            />
          </Pressable>
          <Pressable
            accessibilityLabel={`${item.name}没帮助`}
            accessibilityRole="button"
            onPress={() => onFeedback(false)}
            style={[styles.feedbackButton, { borderColor: feedback === 'not' ? CORAL : colors.line }]}>
            <MaterialCommunityIcons
              name={feedback === 'not' ? 'thumb-down' : 'thumb-down-outline'}
              size={14}
              color={feedback === 'not' ? CORAL : colors.mutedText}
            />
          </Pressable>
        </View>
      </View>
    </SurfaceCard>
  );
}

function FilterSheet({
  availableFilters,
  colors,
  draft,
  onApply,
  onBudgetSelect,
  onBrandToggle,
  onClose,
  onPlatformToggle,
  onReset,
  onScenarioToggle,
  visible,
}: {
  availableFilters: AvailableFilters;
  colors: ReturnType<typeof useAppTheme>['colors'];
  draft: RecommendationFilter;
  onApply: () => void;
  onBudgetSelect: (option: FilterOption) => void;
  onBrandToggle: (brand: string) => void;
  onClose: () => void;
  onPlatformToggle: (platform: string) => void;
  onReset: () => void;
  onScenarioToggle: (scenario: string) => void;
  visible: boolean;
}) {
  const selectedCount = countActiveFilters(draft);
  const platformOptions = PLATFORM_OPTIONS.filter((option) => availableFilters.platforms.includes(option.id));
  const scenarioOptions = SCENARIO_OPTIONS.filter((option) => availableFilters.scenarios.includes(option.id));

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭筛选" accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.filterHeader}>
            <ThemedText style={styles.filterTitle}>筛选</ThemedText>
            <View style={styles.filterHeaderActions}>
              {selectedCount > 0 ? (
                <ThemedText style={[styles.filterSelected, { color: CORAL }]}>已选 {selectedCount} 项</ThemedText>
              ) : null}
              <Pressable accessibilityRole="button" onPress={onReset} style={styles.filterResetButton}>
                <ThemedText style={[styles.filterResetText, { color: colors.mutedText }]}>重置</ThemedText>
              </Pressable>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {availableFilters.budgetRanges.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="价格"
                onToggle={(value) => {
                  const option = availableFilters.budgetRanges.find((item) => item.label === value);
                  if (option) onBudgetSelect(option);
                }}
                options={availableFilters.budgetRanges.map((option) => ({
                  id: option.label,
                  label: option.label,
                }))}
                selected={draft.budgetRange?.label ?? ''}
              />
            ) : null}

            {availableFilters.brands.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="品牌"
                multi
                onToggle={onBrandToggle}
                options={availableFilters.brands.map((brand) => ({ id: brand, label: brand }))}
                selected={draft.brands}
              />
            ) : null}

            {scenarioOptions.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="场景"
                multi
                onToggle={onScenarioToggle}
                options={scenarioOptions.map((option) => ({ id: option.id, label: option.label }))}
                selected={draft.scenarios}
              />
            ) : null}

            {platformOptions.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="平台"
                multi
                onToggle={onPlatformToggle}
                options={platformOptions.map((option) => ({ id: option.id, label: option.label }))}
                selected={draft.platforms}
              />
            ) : null}
          </ScrollView>

          <Pressable
            accessibilityLabel="应用筛选"
            accessibilityRole="button"
            onPress={onApply}
            style={[styles.filterApply, { backgroundColor: HERO }]}>
            <ThemedText style={styles.filterApplyText}>应用筛选</ThemedText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function FilterGroup({
  colors,
  label,
  multi = false,
  onToggle,
  options,
  selected,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  label: string;
  multi?: boolean;
  onToggle: (value: string) => void;
  options: { id: string; label: string }[];
  selected: string | string[];
}) {
  return (
    <View style={styles.filterGroup}>
      <ThemedText style={[styles.filterGroupTitle, { color: colors.mutedText }]}>{label}</ThemedText>
      <View style={styles.filterChips}>
        {options.map((option) => {
          const isSelected = Array.isArray(selected) ? selected.includes(option.id) : selected === option.id;
          return (
            <Pressable
              accessibilityRole={multi ? 'checkbox' : 'tab'}
              accessibilityState={{ checked: multi ? isSelected : undefined, selected: multi ? undefined : isSelected }}
              key={option.id}
              onPress={() => onToggle(option.id)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: isSelected ? colors.primarySoft : colors.surfaceMuted,
                  borderColor: isSelected ? BLUE : colors.line,
                },
              ]}>
              <ThemedText style={[styles.filterChipText, { color: isSelected ? BLUE : colors.text }]}>
                {option.label}
              </ThemedText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function DetailView({
  colors,
  item,
  onBack,
  onOpenLink,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  item: RecommendationItem;
  onBack: () => void;
  onOpenLink: (link: PlatformLink) => void;
}) {
  const specs = Object.entries(item.specs ?? {});
  return (
    <View style={styles.detailBlock}>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityLabel="返回推荐列表"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.backButton, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.detailTitle}>{item.name}</ThemedText>
        <View style={styles.detailSpacer} />
      </View>

      <SurfaceCard style={[styles.detailHero, { borderTopColor: HERO }]}>
        <View style={styles.detailProductIcon}>
          <MaterialCommunityIcons name={productIcon(item)} size={30} color={LIME} />
        </View>
        <View style={styles.detailHeroCopy}>
          <ThemedText style={styles.detailName}>{item.name}</ThemedText>
          <ThemedText style={[styles.detailBrand, { color: colors.mutedText }]}>
            {item.brand} · {formatPriceSource(item.priceSource)}
          </ThemedText>
          <ThemedText style={styles.detailPrice}>{formatPrice(item.referencePrice)}</ThemedText>
        </View>
      </SurfaceCard>

      <View style={styles.platformPriceRow}>
        {item.links.map((link) => (
          <Pressable
            accessibilityLabel={`去${link.label}看看`}
            accessibilityRole="button"
            key={link.platform}
            onPress={() => onOpenLink(link)}
            style={[styles.platformPrice, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name={platformIcon(link.platform)} size={15} color={platformColor(link.platform)} />
            <ThemedText style={[styles.platformPriceLabel, { color: platformColor(link.platform) }]}>
              {getPlatformLabel(link.platform)}
            </ThemedText>
            <ThemedText style={[styles.platformPriceValue, { color: colors.text }]}>
              {formatPrice(item.referencePrice)}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText style={styles.sectionTitle}>为什么值得买</ThemedText>
      <View style={styles.whyList}>
        {item.reasons.slice(0, 3).map((reason) => (
          <View
            key={`${reason.label}-${reason.text}`}
            style={[styles.whyRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.whyIcon, { backgroundColor: reasonColor(reason.label) }]}>
              <MaterialCommunityIcons name={reasonIcon(reason.label)} size={16} color="#ffffff" />
            </View>
            <View style={styles.whyCopy}>
              <ThemedText style={styles.whyTitle}>{reason.label}</ThemedText>
              <ThemedText style={[styles.whyText, { color: colors.mutedText }]}>{reason.text}</ThemedText>
            </View>
          </View>
        ))}
      </View>

      <ThemedText style={styles.sectionTitle}>核心参数</ThemedText>
      <View style={styles.specGrid}>
        {specs.map(([key, value]) => (
          <View key={key} style={[styles.specCell, { backgroundColor: colors.surfaceMuted }]}>
            <ThemedText style={[styles.specLabel, { color: colors.mutedText }]}>{key}</ThemedText>
            <ThemedText numberOfLines={2} style={[styles.specValue, { color: colors.text }]}>{value}</ThemedText>
          </View>
        ))}
      </View>

      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>{item.suitableFor}</ThemedText>
      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
        参考价来自商品库快照，实际价格与库存以平台页面为准
      </ThemedText>
    </View>
  );
}

function CompareView({
  colors,
  items,
  onBack,
  onOpenLink,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  items: RecommendationItem[];
  onBack: () => void;
  onOpenLink: (link: PlatformLink) => void;
}) {
  const dimensions = ['价格', '屏幕', '性能', '续航'] as const;
  const rows = items.map((item) => ({
    item,
    values: {
      价格: formatPrice(item.referencePrice),
      屏幕: item.specs?.screen ?? item.specs?.display ?? '--',
      性能: item.specs?.chip ?? '--',
      续航: item.specs?.battery ?? '--',
    },
  }));

  return (
    <View style={styles.compareBlock}>
      <View style={styles.detailHeader}>
        <Pressable
          accessibilityLabel="返回推荐列表"
          accessibilityRole="button"
          onPress={onBack}
          style={[styles.backButton, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="arrow-left" size={18} color={colors.text} />
        </Pressable>
        <ThemedText style={styles.detailTitle}>商品对比</ThemedText>
        <View style={styles.detailSpacer} />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={[styles.compareTable, { borderColor: colors.line }]}>
          <View style={styles.compareRow}>
            <View style={[styles.compareFirst, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.compareHeaderText, { color: colors.mutedText }]}>维度</ThemedText>
            </View>
            {rows.map((row) => (
              <View key={row.item.productId} style={[styles.compareCell, { backgroundColor: colors.surfaceMuted }]}>
                <ThemedText numberOfLines={1} style={[styles.compareHeaderText, { color: colors.text }]}>
                  {row.item.name}
                </ThemedText>
                <ThemedText style={[styles.compareScore, { color: BLUE }]}>{row.item.fitScore} 分</ThemedText>
              </View>
            ))}
          </View>
          {dimensions.map((dimension) => (
            <View key={dimension} style={styles.compareRow}>
              <View style={styles.compareFirst}>
                <ThemedText style={[styles.compareLabel, { color: colors.mutedText }]}>{dimension}</ThemedText>
              </View>
              {rows.map((row) => (
                <View key={row.item.productId} style={styles.compareCell}>
                  <ThemedText style={[styles.compareValue, { color: colors.text }]}>{row.values[dimension]}</ThemedText>
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>

      <View style={styles.compareLinks}>
        {items.map((item) => (
          <View key={item.productId} style={[styles.compareLinkCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={styles.compareLinkName}>{item.name}</ThemedText>
            <View style={styles.compareLinkButtons}>
              {item.links.slice(0, 2).map((link) => (
                <Pressable
                  accessibilityLabel={`在${link.label}购买${item.name}`}
                  accessibilityRole="button"
                  key={link.platform}
                  onPress={() => onOpenLink(link)}
                  style={[styles.compareLinkButton, { borderColor: colors.line }]}>
                  <ThemedText style={[styles.compareLinkButtonText, { color: platformColor(link.platform) }]}>
                    {getPlatformLabel(link.platform)}
                  </ThemedText>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

function HistoryModal({
  colors,
  items,
  onClose,
  onSelect,
  visible,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  items: RecommendationHistoryItem[];
  onClose: () => void;
  onSelect: (item: RecommendationHistoryItem) => void;
  visible: boolean;
}) {
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭历史记录" accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View style={styles.sheetHeaderCopy}>
              <ThemedText style={styles.sheetTitle}>历史记录</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>{items.length} 条</ThemedText>
            </View>
            <HeaderIconButton accessibilityLabel="关闭" icon="close" onPress={onClose} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {items.length === 0 ? (
              <View style={styles.emptyHistory}>
                <MaterialCommunityIcons name="history" size={30} color={colors.mutedText} />
                <ThemedText style={[styles.emptyHistoryText, { color: colors.mutedText }]}>
                  登录后推荐记录会同步到服务端
                </ThemedText>
              </View>
            ) : (
              items.map((item) => (
                <Pressable
                  accessibilityLabel={`加载历史推荐：${item.query}`}
                  accessibilityRole="button"
                  key={item.queryId}
                  onPress={() => onSelect(item)}
                  style={[styles.historyRow, { borderTopColor: colors.line }]}>
                  <MaterialCommunityIcons name="shopping-search" size={18} color={BLUE} />
                  <View style={styles.historyCopy}>
                    <ThemedText numberOfLines={1} style={styles.historyTitle}>{item.query}</ThemedText>
                    <ThemedText numberOfLines={1} style={[styles.historyMeta, { color: colors.mutedText }]}>
                      {item.category} · {item.productCount} 款 · {formatHistoryTime(item.createdAt)}
                    </ThemedText>
                  </View>
                  <MaterialCommunityIcons name="chevron-right" size={18} color={colors.mutedText} />
                </Pressable>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StatusLine({ color, icon, message }: { color: string; icon: IconName; message: string }) {
  return (
    <View style={styles.statusLine}>
      <MaterialCommunityIcons name={icon} size={16} color={color} />
      <ThemedText numberOfLines={2} style={[styles.statusText, { color }]}>{message}</ThemedText>
    </View>
  );
}

function HeaderIconButton({
  accessibilityLabel,
  icon,
  onPress,
}: {
  accessibilityLabel: string;
  icon: IconName;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      hitSlop={6}
      onPress={onPress}
      style={[styles.iconButton, { backgroundColor: colors.surfaceMuted, borderColor: colors.line }]}>
      <MaterialCommunityIcons name={icon} size={19} color={colors.primary} />
    </Pressable>
  );
}

function reasonColor(label: string) {
  switch (label) {
    case '续航':
      return GREEN;
    case '性能':
      return BLUE;
    case '影像':
      return CORAL;
    case '价格':
      return AMBER;
    default:
      return '#7e5bef';
  }
}

function reasonIcon(label: string): IconName {
  switch (label) {
    case '续航':
      return 'battery-charging';
    case '性能':
      return 'speedometer';
    case '影像':
      return 'camera-outline';
    case '价格':
      return 'tag-outline';
    default:
      return 'check-circle-outline';
  }
}

function platformIcon(platform: RecommendationPlatform): IconName {
  switch (platform) {
    case 'jd':
      return 'cart-outline';
    case 'taobao':
      return 'shopping-outline';
    case 'pdd':
      return 'shopping';
  }
}

function platformColor(platform: RecommendationPlatform) {
  switch (platform) {
    case 'jd':
      return '#e52e2e';
    case 'taobao':
      return '#ff6b2b';
    case 'pdd':
      return '#c6372e';
  }
}

function productIcon(item: RecommendationItem): IconName {
  const name = item.name.toLowerCase();
  if (name.includes('ipad') || name.includes('平板')) return 'tablet';
  if (name.includes('airpods') || name.includes('buds') || name.includes('耳机')) return 'headphones';
  if (name.includes('电视')) return 'television';
  if (name.includes('净化') || name.includes('炸锅') || name.includes('电饭煲')) return 'toaster-oven';
  if (name.includes('充电') || name.includes('数据线') || name.includes('移动电源')) return 'battery-charging';
  return 'cellphone';
}

function formatHistoryTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}`;
}

function categoryText(category: string) {
  switch (category) {
    case 'phone':
      return '手机';
    case 'tablet':
      return '平板';
    case 'earbuds':
      return '耳机';
    case 'tv':
      return '电视';
    case 'small-appliance':
      return '小家电';
    case 'accessory':
      return '数码配件';
    default:
      return '商品';
  }
}

function emptyAvailableFilters(): AvailableFilters {
  return { budgetRanges: [], brands: [], scenarios: [], platforms: [] };
}

const styles = StyleSheet.create({
  pageContent: {
    gap: 14,
    maxWidth: 980,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 8,
  },
  iconButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  statusLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    minHeight: 20,
    paddingHorizontal: 2,
  },
  statusText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  heroBlock: {
    gap: 14,
    paddingTop: 26,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 36,
    textAlign: 'center',
  },
  heroSub: {
    fontSize: 12,
    lineHeight: 19,
    textAlign: 'center',
  },
  heroSearch: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 58,
    paddingHorizontal: 15,
  },
  heroInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
    minHeight: 56,
    paddingVertical: 10,
  },
  heroMic: {
    alignItems: 'center',
    borderRadius: 10,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  exampleLabel: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
  exampleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },
  exampleChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 14,
  },
  exampleChipText: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 16,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 14,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  heroHint: {
    fontSize: 10,
    lineHeight: 16,
    textAlign: 'center',
  },
  resultsBlock: {
    gap: 12,
  },
  summaryRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
  },
  summaryCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  summaryTitle: {
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 24,
  },
  summaryMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  aiPill: {
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  aiPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  toolbar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  sortRow: {
    borderRadius: 9,
    flex: 1,
    flexDirection: 'row',
    padding: 4,
  },
  sortItem: {
    alignItems: 'center',
    borderRadius: 7,
    flex: 1,
    justifyContent: 'center',
    minHeight: 34,
  },
  sortItemText: {
    fontSize: 11,
    fontWeight: '800',
  },
  filterButton: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 42,
    justifyContent: 'center',
    paddingHorizontal: 11,
    position: 'relative',
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  filterBadge: {
    alignItems: 'center',
    backgroundColor: CORAL,
    borderRadius: 999,
    height: 18,
    justifyContent: 'center',
    minWidth: 18,
    paddingHorizontal: 4,
  },
  filterBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
  },
  followUpRow: {
    gap: 8,
    paddingBottom: 2,
    paddingTop: 2,
  },
  followUpChip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 11,
  },
  followUpText: {
    fontSize: 11,
    fontWeight: '700',
  },
  itemList: {
    gap: 12,
  },
  recommendationCard: {
    borderTopWidth: 3,
    gap: 11,
    padding: 15,
  },
  cardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 11,
  },
  productIcon: {
    alignItems: 'center',
    borderRadius: 11,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  cardMain: {
    flex: 1,
    minWidth: 0,
  },
  cardTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  cardTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
  },
  scorePill: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreText: {
    fontSize: 10,
    fontWeight: '900',
  },
  cardBrand: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  reasonList: {
    gap: 7,
  },
  reasonRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 8,
  },
  reasonPill: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 0,
    justifyContent: 'center',
    minHeight: 22,
    minWidth: 42,
    paddingHorizontal: 7,
  },
  reasonPillText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 13,
  },
  reasonText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
  },
  suitableLine: {
    fontSize: 10,
    lineHeight: 16,
  },
  platformRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  platformButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: 10,
  },
  platformButtonText: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 15,
  },
  feedbackRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 30,
    paddingTop: 8,
  },
  feedbackHint: {
    fontSize: 10,
    lineHeight: 14,
  },
  feedbackActions: {
    flexDirection: 'row',
    gap: 7,
  },
  feedbackButton: {
    alignItems: 'center',
    borderRadius: 6,
    borderWidth: 1,
    height: 26,
    justifyContent: 'center',
    width: 30,
  },
  compareButton: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  compareButtonText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '800',
  },
  resetInputButton: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
  },
  resetInputText: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCard: {
    alignItems: 'center',
    borderWidth: 1,
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyResetButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  emptyResetText: {
    fontSize: 12,
    fontWeight: '800',
  },
  modalRoot: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    gap: 14,
    maxHeight: '88%',
    maxWidth: 720,
    paddingBottom: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    width: '100%',
  },
  filterHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  filterTitle: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 27,
  },
  filterHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  filterSelected: {
    fontSize: 11,
    fontWeight: '800',
  },
  filterResetButton: {
    minHeight: 32,
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  filterResetText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterGroup: {
    gap: 8,
    marginBottom: 14,
  },
  filterGroupTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  filterChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 34,
    paddingHorizontal: 12,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '700',
  },
  filterApply: {
    alignItems: 'center',
    borderRadius: 12,
    justifyContent: 'center',
    minHeight: 50,
  },
  filterApplyText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '900',
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  sheetHeaderCopy: {
    flex: 1,
    gap: 2,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 27,
  },
  sheetMeta: {
    fontSize: 11,
    lineHeight: 16,
  },
  emptyHistory: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 28,
  },
  emptyHistoryText: {
    fontSize: 12,
    lineHeight: 18,
  },
  historyRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 64,
    paddingVertical: 10,
  },
  historyCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  historyTitle: {
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },
  historyMeta: {
    fontSize: 10,
    lineHeight: 15,
  },
  detailBlock: {
    gap: 12,
  },
  detailHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    minHeight: 40,
  },
  backButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  detailTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '900',
    textAlign: 'center',
  },
  detailSpacer: {
    width: 38,
  },
  detailHero: {
    alignItems: 'center',
    borderRadius: 16,
    borderTopWidth: 3,
    flexDirection: 'row',
    gap: 14,
    padding: 16,
  },
  detailProductIcon: {
    alignItems: 'center',
    backgroundColor: '#232c4d',
    borderRadius: 12,
    height: 64,
    justifyContent: 'center',
    width: 64,
  },
  detailHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  detailName: {
    fontSize: 20,
    fontWeight: '900',
    lineHeight: 27,
  },
  detailBrand: {
    fontSize: 10,
    lineHeight: 15,
    marginTop: 3,
  },
  detailPrice: {
    color: '#e52e2e',
    fontSize: 24,
    fontWeight: '900',
    lineHeight: 32,
    marginTop: 6,
  },
  platformPriceRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  platformPrice: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    gap: 3,
    minHeight: 68,
    minWidth: 96,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  platformPriceLabel: {
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 15,
  },
  platformPriceValue: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 22,
    marginTop: 2,
  },
  whyList: {
    gap: 8,
  },
  whyRow: {
    alignItems: 'flex-start',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  whyIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  whyCopy: {
    flex: 1,
    gap: 2,
  },
  whyTitle: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  whyText: {
    fontSize: 11,
    lineHeight: 17,
  },
  specGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  specCell: {
    borderRadius: 9,
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  specLabel: {
    fontSize: 9,
    lineHeight: 13,
  },
  specValue: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
    marginTop: 3,
  },
  disclaimer: {
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'center',
  },
  compareBlock: {
    gap: 12,
  },
  compareTable: {
    borderWidth: 1,
    minWidth: 560,
  },
  compareRow: {
    borderBottomWidth: 1,
    flexDirection: 'row',
    minHeight: 62,
  },
  compareFirst: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: 10,
    width: 72,
  },
  compareCell: {
    borderLeftWidth: 1,
    flex: 1,
    justifyContent: 'center',
    minWidth: 130,
    paddingHorizontal: 10,
  },
  compareHeaderText: {
    fontSize: 12,
    fontWeight: '900',
    lineHeight: 17,
  },
  compareScore: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
    marginTop: 3,
  },
  compareLabel: {
    fontSize: 11,
    fontWeight: '800',
    lineHeight: 16,
  },
  compareValue: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 17,
  },
  compareLinks: {
    gap: 8,
  },
  compareLinkCard: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    padding: 12,
  },
  compareLinkName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '900',
  },
  compareLinkButtons: {
    flexDirection: 'row',
    gap: 7,
  },
  compareLinkButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 10,
  },
  compareLinkButtonText: {
    fontSize: 11,
    fontWeight: '800',
  },
});
