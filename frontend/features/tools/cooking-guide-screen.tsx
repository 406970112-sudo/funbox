import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
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
  displayDishName,
  emptyContribution,
  filterCookingDishes,
  formatFetchedAt,
  sortCookingDishes,
  summarizeCookingSearch,
  validateContribution,
  type CookingSortKey,
} from '@/lib/cooking-guide';
import {
  addCookingFavorite,
  createCookingContribution,
  fetchCookingAreas,
  fetchCookingDishes,
  fetchCookingDishDetail,
  fetchCookingFavorites,
  fetchCookingHistory,
  fetchCookingShoppingList,
  getCookingGuideErrorMessage,
  removeCookingFavorite,
  saveCookingSession,
  submitCookingFeedback,
} from '@/lib/cooking-guide-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  CookingArea,
  CookingContributionInput,
  CookingDishDetail,
  CookingDishSummary,
  CookingHistoryItem,
  CookingIngredient,
  CookingSession,
} from '@/types/cooking-guide';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type ScreenMode = 'home' | 'results' | 'detail' | 'cook' | 'shopping' | 'kitchen';

const CORAL = '#e85d4a';
const GREEN = '#24b36b';
const BLUE = '#4b6bff';
const NAVY = '#151b3b';
const LIME = '#c9f36a';
const WARM = '#fff4ed';
const DARK = '#101426';

const CATEGORY_FILTERS = [
  { key: 'chicken', label: '鸡肉' },
  { key: 'pork', label: '猪肉' },
  { key: 'beef', label: '牛肉' },
  { key: 'vegetarian', label: '素食' },
];

export function CookingGuideScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus } = useAuth();
  const [areas, setAreas] = useState<CookingArea[]>([]);
  const [featured, setFeatured] = useState<CookingDishSummary[]>([]);
  const [mode, setMode] = useState<ScreenMode>('home');
  const [previousMode, setPreviousMode] = useState<ScreenMode>('home');
  const [query, setQuery] = useState('');
  const [activeArea, setActiveArea] = useState<string | null>(null);
  const [results, setResults] = useState<CookingDishSummary[]>([]);
  const [sortKey, setSortKey] = useState<CookingSortKey>('default');
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<CookingDishDetail | null>(null);
  const [shoppingItems, setShoppingItems] = useState<CookingIngredient[]>([]);
  const [checkedShopping, setCheckedShopping] = useState<Record<number, boolean>>({});
  const [cookStep, setCookStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState('选择菜系或搜索菜名，找到今天想做的菜。');
  const [statusColor, setStatusColor] = useState(BLUE);
  const [favorites, setFavorites] = useState<CookingDishSummary[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [history, setHistory] = useState<CookingHistoryItem[]>([]);
  const [feedback, setFeedback] = useState<Record<string, 'helpful' | 'not' | undefined>>({});
  const [showSource, setShowSource] = useState(false);
  const [showContribution, setShowContribution] = useState(false);
  const [contribution, setContribution] = useState<CookingContributionInput>(emptyContribution());
  const wakeLockRef = useRef<{ release: () => Promise<void> } | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void loadInitialData();
    return () => {
      mountedRef.current = false;
      void releaseWakeLock();
    };
  }, []);

  useEffect(() => {
    if (authStatus === 'authenticated' && accessToken) {
      void loadPersonalData();
    }
  }, [authStatus, accessToken]);

  async function loadInitialData() {
    setLoading(true);
    try {
      const [areaResponse, dishResponse] = await Promise.all([
        fetchCookingAreas(),
        fetchCookingDishes({ limit: 6 }),
      ]);
      if (!mountedRef.current) return;
      setAreas(areaResponse.items);
      setFeatured(dishResponse.items.slice(0, 3));
      setStatusMessage('菜系与菜谱均来自真实数据源，可放心照着做。');
      setStatusColor(GREEN);
    } catch (error) {
      if (mountedRef.current) {
        setStatusMessage(getCookingGuideErrorMessage(error));
        setStatusColor(CORAL);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function loadPersonalData() {
    if (!accessToken) return;
    try {
      const [favoriteItems, historyItems] = await Promise.all([
        fetchCookingFavorites(accessToken),
        fetchCookingHistory(accessToken),
      ]);
      if (!mountedRef.current) return;
      setFavorites(favoriteItems);
      setFavoriteIds(new Set(favoriteItems.map((item) => item.id)));
      setHistory(historyItems);
    } catch {
      // Personal data is optional when the server is temporarily unavailable.
    }
  }

  function goTo(next: ScreenMode, previous: ScreenMode) {
    setPreviousMode(previous);
    setMode(next);
  }

  function handleBack() {
    if (mode === 'kitchen' || (mode === 'home' && router.canGoBack())) {
      if (mode === 'kitchen') {
        setMode(previousMode);
      } else {
        router.back();
      }
      return;
    }
    if (mode === 'cook') {
      void releaseWakeLock();
      setMode('detail');
      return;
    }
    setMode(previousMode === 'home' ? 'home' : previousMode);
  }

  async function runSearch(nextQuery: string) {
    const trimmed = nextQuery.trim();
    if (!trimmed && !activeArea) {
      setStatusMessage('先输入菜名或选择一个菜系。');
      setStatusColor(BLUE);
      return;
    }
    setLoading(true);
    setQuery(trimmed);
    setStatusMessage('正在检索真实菜谱数据...');
    try {
      const response = await fetchCookingDishes({
        q: trimmed || undefined,
        area: activeArea || undefined,
        limit: 30,
      });
      if (!mountedRef.current) return;
      setResults(response.items);
      setCategoryFilter(null);
      setSortKey('default');
      goTo('results', mode === 'results' ? previousMode : mode);
      setStatusMessage(summarizeCookingSearch(trimmed, activeArea ?? undefined, response.total));
      setStatusColor(GREEN);
    } catch (error) {
      setStatusMessage(getCookingGuideErrorMessage(error));
      setStatusColor(CORAL);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function selectArea(area: CookingArea) {
    setActiveArea(area.name);
    setQuery('');
    setLoading(true);
    setStatusMessage(`正在加载${area.zh}菜系真实菜谱...`);
    try {
      const response = await fetchCookingDishes({ area: area.name, limit: 30 });
      if (!mountedRef.current) return;
      setResults(response.items);
      setCategoryFilter(null);
      setSortKey('default');
      goTo('results', 'home');
      setStatusMessage(summarizeCookingSearch('', area.zh, response.total));
      setStatusColor(GREEN);
    } catch (error) {
      setStatusMessage(getCookingGuideErrorMessage(error));
      setStatusColor(CORAL);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function openDetail(dish: CookingDishSummary) {
    setLoading(true);
    setStatusMessage('正在加载真实菜谱原文...');
    try {
      const detail = await fetchCookingDishDetail(dish.id, accessToken);
      if (!mountedRef.current) return;
      setSelected(detail);
      setFeedback((current) => ({ ...current, [detail.id]: current[detail.id] }));
      goTo('detail', mode === 'results' ? 'results' : 'home');
      setStatusMessage(`${displayDishName(detail)} · ${detail.steps.length} 步真实步骤`);
      setStatusColor(BLUE);
    } catch (error) {
      setStatusMessage(getCookingGuideErrorMessage(error));
      setStatusColor(CORAL);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function openShopping() {
    if (!selected) return;
    setLoading(true);
    try {
      const list = await fetchCookingShoppingList(selected.id);
      if (!mountedRef.current) return;
      setShoppingItems(list.items);
      setCheckedShopping({});
      goTo('shopping', 'detail');
      setStatusMessage('购物清单由菜谱真实食材字段自动生成。');
      setStatusColor(GREEN);
    } catch (error) {
      setStatusMessage(getCookingGuideErrorMessage(error));
      setStatusColor(CORAL);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  async function startCooking() {
    if (!selected) return;
    setCookStep(0);
    goTo('cook', 'detail');
    await requestWakeLock();
    if (authStatus === 'authenticated' && accessToken) {
      try {
        await saveCookingSession({ dishId: selected.id, stepIndex: 0 }, accessToken);
      } catch {
        // Progress stays local when the server is unavailable.
      }
    }
  }

  async function changeStep(next: number, complete = false) {
    if (!selected) return;
    const total = selected.steps.length;
    const clamped = Math.max(0, Math.min(total - 1, next));
    setCookStep(clamped);
    if (complete || clamped === total - 1) {
      setStatusMessage(complete || clamped === total - 1 ? '最后一步完成，可以开吃啦。' : '');
      setStatusColor(GREEN);
    }
    if (authStatus === 'authenticated' && accessToken) {
      try {
        await saveCookingSession(
          { dishId: selected.id, stepIndex: clamped, completed: complete || clamped === total - 1 },
          accessToken,
        );
      } catch {
        // Local progress remains usable offline.
      }
    }
  }

  async function toggleFavorite(dish: CookingDishDetail | CookingDishSummary) {
    if (authStatus !== 'authenticated' || !accessToken) {
      setStatusMessage('登录后可收藏菜谱。');
      setStatusColor(CORAL);
      return;
    }
    const isFavorite = favoriteIds.has(dish.id);
    const nextIds = new Set(favoriteIds);
    if (isFavorite) {
      nextIds.delete(dish.id);
      setFavorites((current) => current.filter((item) => item.id !== dish.id));
      try {
        await removeCookingFavorite(accessToken, dish.id);
      } catch {
        // Keep optimistic state.
      }
    } else {
      nextIds.add(dish.id);
      const summary: CookingDishSummary = {
        id: dish.id,
        name: dish.name,
        nameZh: dish.nameZh,
        area: dish.area,
        areaZh: dish.areaZh,
        category: dish.category,
        tags: dish.tags,
        image: dish.image,
        ingredientCount: 'ingredients' in dish ? dish.ingredients.length : 0,
        stepCount: 'steps' in dish ? dish.steps.length : 0,
      };
      setFavorites((current) => [summary, ...current]);
      try {
        await addCookingFavorite(accessToken, dish.id);
      } catch {
        // Keep optimistic state.
      }
    }
    setFavoriteIds(nextIds);
    setStatusMessage(isFavorite ? '已取消收藏。' : '已收藏，可在我的厨房查看。');
    setStatusColor(isFavorite ? BLUE : GREEN);
  }

  async function submitFeedback(dishId: string, helpful: boolean) {
    setFeedback((current) => ({ ...current, [dishId]: helpful ? 'helpful' : 'not' }));
    setStatusMessage(helpful ? '已记录有帮助反馈。' : '已记录反馈，我们会继续校准内容。');
    setStatusColor(helpful ? GREEN : BLUE);
    try {
      await submitCookingFeedback({ dishId, helpful }, accessToken);
    } catch {
      // Feedback is recorded locally even when the server is unavailable.
    }
  }

  async function submitContribution() {
    const error = validateContribution(contribution);
    if (error) {
      setStatusMessage(error);
      setStatusColor(CORAL);
      return;
    }
    if (authStatus !== 'authenticated' || !accessToken) {
      setStatusMessage('登录后才能提交菜谱。');
      setStatusColor(CORAL);
      return;
    }
    setLoading(true);
    try {
      await createCookingContribution(
        {
          ...contribution,
          ingredients: contribution.ingredients.map((item) => item.trim()).filter(Boolean),
          steps: contribution.steps.map((item) => item.trim()).filter(Boolean),
        },
        accessToken,
      );
      setShowContribution(false);
      setContribution(emptyContribution());
      setStatusMessage('菜谱已提交，等待人工审核后展示。');
      setStatusColor(GREEN);
    } catch (submitError) {
      setStatusMessage(getCookingGuideErrorMessage(submitError));
      setStatusColor(CORAL);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  function speakStep(text: string) {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setStatusMessage('当前环境暂不支持语音朗读，可继续阅读步骤。');
      setStatusColor(BLUE);
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'zh-CN';
    window.speechSynthesis.speak(utterance);
  }

  async function requestWakeLock() {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return;
    }
    try {
      wakeLockRef.current = await navigator.wakeLock.request('screen');
    } catch {
      // Wake lock is best-effort and does not block cooking.
    }
  }

  async function releaseWakeLock() {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignore release errors.
      }
      wakeLockRef.current = null;
    }
  }

  function openExternal(url: string) {
    if (!url) {
      setStatusMessage('数据源未提供该链接。');
      setStatusColor(CORAL);
      return;
    }
    Linking.openURL(url).catch(() => {
      setStatusMessage('当前环境无法打开外部链接。');
      setStatusColor(CORAL);
    });
  }

  const filteredResults = sortCookingDishes(
    filterCookingDishes(results, { category: categoryFilter ?? undefined }),
    sortKey,
  );

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <PageHeader
        eyebrow="Cooking Guide"
        title="跟做菜谱"
        subtitle="真实菜系、真实图片、真实步骤"
        rightSlot={
          <View style={styles.headerActions}>
            <HeaderIconButton
              accessibilityLabel="我的厨房"
              icon="book-open-page-variant-outline"
              onPress={() => goTo('kitchen', mode === 'home' ? 'home' : previousMode)}
            />
            <HeaderIconButton accessibilityLabel="返回" icon="arrow-left" onPress={handleBack} />
          </View>
        }
      />

      <StatusLine
        color={statusColor}
        icon={loading ? 'progress-clock' : 'chef-hat'}
        message={statusMessage}
      />

      {mode === 'home' ? (
        <HomeView
          areas={areas}
          colors={colors}
          dishes={featured}
          loading={loading}
          onAreaSelect={(area) => void selectArea(area)}
          onDishSelect={(dish) => void openDetail(dish)}
          onSearch={(value) => void runSearch(value)}
          query={query}
          setQuery={setQuery}
        />
      ) : null}

      {mode === 'results' ? (
        <ResultsView
          colors={colors}
          dishes={filteredResults}
          onCategoryToggle={(key) => setCategoryFilter((current) => (current === key ? null : key))}
          onDishSelect={(dish) => void openDetail(dish)}
          onSort={setSortKey}
          query={query}
          sortKey={sortKey}
          summary={summarizeCookingSearch(query, activeArea ?? undefined, results.length)}
        />
      ) : null}

      {mode === 'detail' && selected ? (
        <DetailView
          colors={colors}
          dish={selected}
          favorite={favoriteIds.has(selected.id)}
          feedback={feedback[selected.id]}
          onBack={() => setMode(previousMode === 'results' ? 'results' : 'home')}
          onFavorite={() => void toggleFavorite(selected)}
          onFeedback={(helpful) => void submitFeedback(selected.id, helpful)}
          onOpenSource={() => setShowSource(true)}
          onShopping={() => void openShopping()}
          onStartCook={() => void startCooking()}
        />
      ) : null}

      {mode === 'cook' && selected ? (
        <CookView
          dish={selected}
          onBack={() => {
            void releaseWakeLock();
            setMode('detail');
          }}
          onNext={() => void changeStep(cookStep + 1)}
          onPrev={() => void changeStep(cookStep - 1)}
          onSpeak={() => speakStep(selected.steps[cookStep])}
          stepIndex={cookStep}
        />
      ) : null}

      {mode === 'shopping' && selected ? (
        <ShoppingView
          checked={checkedShopping}
          colors={colors}
          dish={selected}
          items={shoppingItems}
          onCheck={(index) => setCheckedShopping((current) => ({ ...current, [index]: !current[index] }))}
          onStartCook={() => void startCooking()}
        />
      ) : null}

      {mode === 'kitchen' ? (
        <KitchenView
          authStatus={authStatus}
          colors={colors}
          favorites={favorites}
          history={history}
          onContribution={() => setShowContribution(true)}
          onDishSelect={(dish) => void openDetail(dish)}
          onLogin={() => router.push('/auth')}
        />
      ) : null}

      {selected ? (
        <SourceModal
          dish={selected}
          onClose={() => setShowSource(false)}
          onOpenExternal={openExternal}
          visible={showSource}
        />
      ) : null}

      <ContributionModal
        colors={colors}
        contribution={contribution}
        loading={loading}
        onChange={setContribution}
        onClose={() => setShowContribution(false)}
        onSubmit={() => void submitContribution()}
        visible={showContribution}
      />
    </MobileScreen>
  );
}

function HomeView({
  areas,
  colors,
  dishes,
  loading,
  onAreaSelect,
  onDishSelect,
  onSearch,
  query,
  setQuery,
}: {
  areas: CookingArea[];
  colors: ReturnType<typeof useAppTheme>['colors'];
  dishes: CookingDishSummary[];
  loading: boolean;
  onAreaSelect: (area: CookingArea) => void;
  onDishSelect: (dish: CookingDishSummary) => void;
  onSearch: (query: string) => void;
  query: string;
  setQuery: (query: string) => void;
}) {
  return (
    <View style={styles.homeBlock}>
      <View style={[styles.heroSearch, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={colors.primary} />
        <TextInput
          accessibilityLabel="搜索菜名或菜系"
          onChangeText={setQuery}
          onSubmitEditing={() => onSearch(query)}
          placeholder="搜索菜名或食材，例如 Kung"
          placeholderTextColor={colors.mutedText}
          returnKeyType="search"
          style={[styles.heroInput, { color: colors.text }]}
          value={query}
        />
        <Pressable
          accessibilityLabel="搜索"
          accessibilityRole="button"
          onPress={() => onSearch(query)}
          style={[styles.searchButton, { backgroundColor: NAVY }]}>
          <MaterialCommunityIcons name="arrow-right" size={17} color={LIME} />
        </Pressable>
      </View>

      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>菜系</ThemedText>
        <ThemedText style={[styles.sectionMeta, { color: colors.mutedText }]}>真实数量统计</ThemedText>
      </View>
      <ScrollView contentContainerStyle={styles.areaRow} horizontal showsHorizontalScrollIndicator={false}>
        {areas.map((area) => (
          <Pressable
            accessibilityRole="button"
            key={area.name}
            onPress={() => onAreaSelect(area)}
            style={[styles.areaChip, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <ThemedText style={[styles.areaChipText, { color: colors.text }]}>{area.zh}</ThemedText>
            <ThemedText style={[styles.areaChipCount, { color: colors.mutedText }]}>{area.count} 道</ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.sectionHead}>
        <ThemedText style={styles.sectionTitle}>今日精选</ThemedText>
        <View style={[styles.realPill, { backgroundColor: WARM, borderColor: '#ffdcc8' }]}>
          <MaterialCommunityIcons name="database-check-outline" size={12} color={CORAL} />
          <ThemedText style={styles.realPillText}>真实数据</ThemedText>
        </View>
      </View>
      {loading && dishes.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ActivityIndicator color={colors.primary} />
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>正在加载真实菜谱...</ThemedText>
        </View>
      ) : (
        <View style={styles.dishList}>
          {dishes.map((dish) => (
            <DishCard dish={dish} key={dish.id} onPress={() => onDishSelect(dish)} />
          ))}
        </View>
      )}
    </View>
  );
}

function ResultsView({
  colors,
  dishes,
  onCategoryToggle,
  onDishSelect,
  onSort,
  query,
  sortKey,
  summary,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  dishes: CookingDishSummary[];
  onCategoryToggle: (key: string) => void;
  onDishSelect: (dish: CookingDishSummary) => void;
  onSort: (key: CookingSortKey) => void;
  query: string;
  sortKey: CookingSortKey;
  summary: string;
}) {
  return (
    <View style={styles.resultsBlock}>
      <View style={[styles.summaryCard, { backgroundColor: NAVY }]}>
        <View style={styles.summaryCopy}>
          <ThemedText style={styles.summaryTitle}>{summary}</ThemedText>
          <ThemedText style={styles.summaryMeta}>菜谱正文、图片、食材均未改写</ThemedText>
        </View>
        <View style={styles.aiPill}>
          <MaterialCommunityIcons name="database" size={12} color={LIME} />
          <ThemedText style={styles.aiPillText}>真实数据</ThemedText>
        </View>
      </View>

      <View style={styles.toolbar}>
        <View style={[styles.sortRow, { backgroundColor: colors.surfaceMuted }]}>
          {(
            [
              ['default', '综合'],
              ['ingredients-asc', '食材少'],
              ['steps-asc', '步骤少'],
            ] as [CookingSortKey, string][]
          ).map(([key, label]) => (
            <Pressable
              accessibilityRole="button"
              key={key}
              onPress={() => onSort(key)}
              style={[styles.sortItem, sortKey === key ? { backgroundColor: colors.surface } : null]}>
              <ThemedText
                style={[styles.sortItemText, { color: sortKey === key ? colors.primary : colors.mutedText }]}>
                {label}
              </ThemedText>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.filterRow} horizontal showsHorizontalScrollIndicator={false}>
        {CATEGORY_FILTERS.map((filter) => (
          <Pressable
            accessibilityRole="button"
            key={filter.key}
            onPress={() => onCategoryToggle(filter.key)}
            style={[
              styles.filterChip,
              { backgroundColor: colors.surface, borderColor: colors.line },
            ]}>
            <ThemedText style={[styles.filterChipText, { color: colors.text }]}>{filter.label}</ThemedText>
          </Pressable>
        ))}
      </ScrollView>

      {dishes.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name="food-off-outline" size={30} color={colors.mutedText} />
          <ThemedText style={styles.emptyTitle}>暂无匹配菜谱</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            已展示全部真实数据，可尝试“中式”或“chicken”。
          </ThemedText>
        </View>
      ) : (
        <View style={styles.dishList}>
          {dishes.map((dish) => (
            <DishCard dish={dish} key={dish.id} onPress={() => onDishSelect(dish)} />
          ))}
        </View>
      )}
    </View>
  );
}

function DishCard({
  dish,
  onPress,
}: {
  dish: CookingDishSummary;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityLabel={`查看${displayDishName(dish)}菜谱`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.dishCard,
        { backgroundColor: colors.surface, borderColor: colors.line, opacity: pressed ? 0.86 : 1 },
      ]}>
      <Image
        contentFit="cover"
        source={{ uri: dish.image.url }}
        style={styles.dishImage}
        transition={120}
      />
      <View style={styles.dishMain}>
        <View style={styles.dishTitleRow}>
          <ThemedText numberOfLines={1} style={styles.dishZh}>
            {displayDishName(dish)}
          </ThemedText>
          <ThemedText numberOfLines={1} style={[styles.dishEn, { color: colors.mutedText }]}>
            {dish.name}
          </ThemedText>
        </View>
        <ThemedText style={[styles.dishMeta, { color: colors.mutedText }]}>
          {dish.areaZh || dish.area} · {dish.category}
        </ThemedText>
        <View style={styles.dishStats}>
          <View style={[styles.statPill, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="shopping-outline" size={11} color={colors.primary} />
            <ThemedText style={[styles.statPillText, { color: colors.primary }]}>
              {dish.ingredientCount} 种食材
            </ThemedText>
          </View>
          <View style={[styles.statPill, { backgroundColor: colors.surfaceMuted }]}>
            <MaterialCommunityIcons name="format-list-numbered" size={11} color={colors.mutedText} />
            <ThemedText style={[styles.statPillText, { color: colors.mutedText }]}>{dish.stepCount} 步</ThemedText>
          </View>
        </View>
        <View style={styles.sourceLine}>
          <MaterialCommunityIcons name="database" size={11} color={colors.mutedText} />
          <ThemedText style={[styles.sourceLineText, { color: colors.mutedText }]}>
            TheMealDB 开放数据
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
}

function DetailView({
  colors,
  dish,
  favorite,
  feedback,
  onBack,
  onFavorite,
  onFeedback,
  onOpenSource,
  onShopping,
  onStartCook,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  dish: CookingDishDetail;
  favorite: boolean;
  feedback: 'helpful' | 'not' | undefined;
  onBack: () => void;
  onFavorite: () => void;
  onFeedback: (helpful: boolean) => void;
  onOpenSource: () => void;
  onShopping: () => void;
  onStartCook: () => void;
}) {
  return (
    <View style={styles.detailBlock}>
      <View style={[styles.detailHero, { backgroundColor: colors.surfaceMuted }]}>
        <Image contentFit="cover" source={{ uri: dish.image.url }} style={StyleSheet.absoluteFill} transition={140} />
        <View style={styles.detailNav}>
          <DetailIconButton icon="arrow-left" label="返回" onPress={onBack} />
          <View style={styles.detailNavSpacer} />
          <DetailIconButton
            icon={favorite ? 'heart' : 'heart-outline'}
            label="收藏"
            onPress={onFavorite}
          />
        </View>
        <View style={styles.detailTitleWrap}>
          <ThemedText style={styles.detailTitle}>{displayDishName(dish)}</ThemedText>
          <ThemedText style={styles.detailSubtitle}>
            {dish.name} · {dish.areaZh || dish.area} · {dish.category}
          </ThemedText>
        </View>
      </View>

      <View style={styles.detailBody}>
        <View style={styles.detailMetaRow}>
          <View style={[styles.metaPill, { backgroundColor: WARM, borderColor: '#ffdcc8' }]}>
            <MaterialCommunityIcons name="fire" size={12} color={CORAL} />
            <ThemedText style={styles.metaPillCoralText}>{dish.areaZh || dish.area}</ThemedText>
          </View>
          <View style={[styles.metaPill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="tag-outline" size={12} color={colors.primary} />
            <ThemedText style={[styles.metaPillText, { color: colors.text }]}>{dish.category}</ThemedText>
          </View>
          <View style={[styles.metaPill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="shopping-outline" size={12} color={colors.primary} />
            <ThemedText style={[styles.metaPillText, { color: colors.text }]}>{dish.ingredients.length} 种食材</ThemedText>
          </View>
          <View style={[styles.metaPill, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="format-list-numbered" size={12} color={colors.primary} />
            <ThemedText style={[styles.metaPillText, { color: colors.text }]}>{dish.steps.length} 步</ThemedText>
          </View>
        </View>

        <ThemedText style={styles.blockTitle}>食材清单</ThemedText>
        <View style={styles.ingredientGrid}>
          {dish.ingredients.slice(0, 8).map((ingredient, index) => (
            <View
              key={`${ingredient.name}-${index}`}
              style={[styles.ingredientCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
              <MaterialCommunityIcons name="check-circle-outline" size={13} color={GREEN} />
              <ThemedText numberOfLines={2} style={styles.ingredientName}>
                {ingredient.name}
              </ThemedText>
              <ThemedText style={[styles.ingredientMeasure, { color: colors.mutedText }]}>
                {ingredient.measure || '适量'}
              </ThemedText>
            </View>
          ))}
        </View>

        <ThemedText style={styles.blockTitle}>步骤预览</ThemedText>
        <View style={[styles.stepPreview, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {dish.steps.slice(0, 2).map((step, index) => (
            <View key={`${index}-${step.slice(0, 12)}`} style={styles.stepLine}>
              <View style={[styles.stepNum, { backgroundColor: colors.primarySoft }]}>
                <ThemedText style={[styles.stepNumText, { color: colors.primary }]}>{index + 1}</ThemedText>
              </View>
              <ThemedText numberOfLines={3} style={[styles.stepLineText, { color: colors.text }]}>
                {step}
              </ThemedText>
            </View>
          ))}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={onOpenSource}
          style={[styles.sourceCard, { backgroundColor: NAVY }]}>
          <MaterialCommunityIcons name="link-variant" size={16} color={LIME} />
          <View style={styles.sourceCopy}>
            <ThemedText style={styles.sourceTitle}>查看数据来源</ThemedText>
            <ThemedText style={styles.sourceMeta}>
              TheMealDB · {formatFetchedAt(dish.fetchedAt)} 快照 · {dish.license}
            </ThemedText>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={17} color="#aab3c8" />
        </Pressable>

        <View style={styles.feedbackRow}>
          <ThemedText style={[styles.feedbackHint, { color: colors.mutedText }]}>这道菜谱对你有帮助吗？</ThemedText>
          <View style={styles.feedbackActions}>
            <FeedbackButton
              active={feedback === 'helpful'}
              icon="thumb-up-outline"
              onPress={() => onFeedback(true)}
            />
            <FeedbackButton
              active={feedback === 'not'}
              icon="thumb-down-outline"
              onPress={() => onFeedback(false)}
            />
          </View>
        </View>

        <View style={styles.detailActions}>
          <Pressable
            accessibilityRole="button"
            onPress={onShopping}
            style={[styles.detailActionSecondary, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <MaterialCommunityIcons name="shopping-outline" size={16} color={colors.text} />
            <ThemedText style={[styles.detailActionSecondaryText, { color: colors.text }]}>购物清单</ThemedText>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={onStartCook} style={styles.detailActionPrimary}>
            <MaterialCommunityIcons name="play" size={17} color="#ffffff" />
            <ThemedText style={styles.detailActionPrimaryText}>开始跟做</ThemedText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function CookView({
  dish,
  onBack,
  onNext,
  onPrev,
  onSpeak,
  stepIndex,
}: {
  dish: CookingDishDetail;
  onBack: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSpeak: () => void;
  stepIndex: number;
}) {
  const total = dish.steps.length;
  const progress = Math.round(((stepIndex + 1) / total) * 100);
  const isLast = stepIndex === total - 1;
  return (
    <View style={styles.cookScreen}>
      <View style={styles.cookNav}>
        <Pressable
          accessibilityLabel="退出跟做"
          accessibilityRole="button"
          onPress={onBack}
          style={styles.cookIconButton}>
          <MaterialCommunityIcons name="close" size={18} color="#ffffff" />
        </Pressable>
        <ThemedText style={styles.cookDish}>{displayDishName(dish)} · 跟做中</ThemedText>
        <Pressable
          accessibilityLabel="朗读步骤"
          accessibilityRole="button"
          onPress={onSpeak}
          style={styles.cookIconButton}>
          <MaterialCommunityIcons name="volume-high" size={18} color="#ffffff" />
        </Pressable>
      </View>

      <View style={styles.cookBody}>
        <View style={styles.cookProgressHead}>
          <ThemedText style={styles.cookStepLabel}>第 {stepIndex + 1} 步</ThemedText>
          <ThemedText style={styles.cookStepTotal}>共 {total} 步 · {progress}%</ThemedText>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>
        <View style={styles.stepCard}>
          <View style={styles.stepTag}>
            <MaterialCommunityIcons name="silverware-fork-knife" size={14} color={LIME} />
            <ThemedText style={styles.stepTagText}>当前步骤 · 真实原文</ThemedText>
          </View>
          <ThemedText style={styles.stepText}>{dish.steps[stepIndex]}</ThemedText>
        </View>
      </View>

      <View style={styles.cookActions}>
        <Pressable
          accessibilityRole="button"
          disabled={stepIndex === 0}
          onPress={onPrev}
          style={[styles.cookButton, stepIndex === 0 && styles.cookButtonDisabled]}>
          <MaterialCommunityIcons name="arrow-left" size={16} color="#ffffff" />
          <ThemedText style={styles.cookButtonText}>上一步</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onSpeak} style={styles.cookButton}>
          <MaterialCommunityIcons name="volume-high" size={16} color="#ffffff" />
          <ThemedText style={styles.cookButtonText}>朗读</ThemedText>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onNext} style={styles.cookNextButton}>
          <ThemedText style={styles.cookNextText}>{isLast ? '完成' : '下一步'}</ThemedText>
          <MaterialCommunityIcons name="arrow-right" size={17} color="#ffffff" />
        </Pressable>
      </View>
    </View>
  );
}

function ShoppingView({
  checked,
  colors,
  dish,
  items,
  onCheck,
  onStartCook,
}: {
  checked: Record<number, boolean>;
  colors: ReturnType<typeof useAppTheme>['colors'];
  dish: CookingDishDetail;
  items: CookingIngredient[];
  onCheck: (index: number) => void;
  onStartCook: () => void;
}) {
  return (
    <View style={styles.shoppingBlock}>
      <View style={[styles.shoppingHead, { backgroundColor: WARM, borderColor: '#ffdcc8' }]}>
        <MaterialCommunityIcons name="shopping-outline" size={20} color={CORAL} />
        <View>
          <ThemedText style={styles.shoppingTitle}>{displayDishName(dish)} · 备菜清单</ThemedText>
          <ThemedText style={styles.shoppingMeta}>由菜谱真实食材字段自动生成</ThemedText>
        </View>
      </View>
      <View style={styles.shoppingList}>
        {items.map((item, index) => (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!checked[index] }}
            key={`${item.name}-${index}`}
            onPress={() => onCheck(index)}
            style={[styles.shoppingRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.checkBox, checked[index] ? styles.checkBoxDone : null]}>
              {checked[index] ? <MaterialCommunityIcons name="check" size={13} color="#ffffff" /> : null}
            </View>
            <ThemedText
              style={[styles.shoppingIngredient, checked[index] ? styles.shoppingIngredientDone : { color: colors.text }]}>
              {item.name}
            </ThemedText>
            <ThemedText style={[styles.shoppingMeasure, { color: colors.mutedText }]}>
              {item.measure || '适量'}
            </ThemedText>
          </Pressable>
        ))}
      </View>
      <Pressable accessibilityRole="button" onPress={onStartCook} style={styles.shoppingAction}>
        <MaterialCommunityIcons name="play" size={17} color="#ffffff" />
        <ThemedText style={styles.shoppingActionText}>食材备好后开始跟做</ThemedText>
      </Pressable>
    </View>
  );
}

function KitchenView({
  authStatus,
  colors,
  favorites,
  history,
  onContribution,
  onDishSelect,
  onLogin,
}: {
  authStatus: string;
  colors: ReturnType<typeof useAppTheme>['colors'];
  favorites: CookingDishSummary[];
  history: CookingHistoryItem[];
  onContribution: () => void;
  onDishSelect: (dish: CookingDishSummary) => void;
  onLogin: () => void;
}) {
  if (authStatus !== 'authenticated') {
    return (
      <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="chef-hat" size={30} color={colors.primary} />
        <ThemedText style={styles.emptyTitle}>登录后同步我的厨房</ThemedText>
        <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
          收藏、做过记录与菜谱提交会同步到服务端。
        </ThemedText>
        <Pressable accessibilityRole="button" onPress={onLogin} style={styles.emptyResetButton}>
          <ThemedText style={[styles.emptyResetText, { color: colors.primary }]}>登录 / 注册</ThemedText>
        </Pressable>
      </View>
    );
  }
  return (
    <View style={styles.kitchenBlock}>
      <Pressable accessibilityRole="button" onPress={onContribution} style={[styles.contributionCard, { backgroundColor: NAVY }]}>
        <MaterialCommunityIcons name="plus-circle-outline" size={18} color={LIME} />
        <View style={styles.contributionCopy}>
          <ThemedText style={styles.contributionTitle}>提交我的菜谱</ThemedText>
          <ThemedText style={styles.contributionMeta}>人工审核通过后展示，不生成内容</ThemedText>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={17} color="#aab3c8" />
      </Pressable>

      <ThemedText style={styles.blockTitle}>我的收藏 · {favorites.length}</ThemedText>
      {favorites.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>还没有收藏菜谱。</ThemedText>
        </View>
      ) : (
        <View style={styles.dishList}>
          {favorites.map((dish) => (
            <DishCard dish={dish} key={dish.id} onPress={() => onDishSelect(dish)} />
          ))}
        </View>
      )}

      <ThemedText style={styles.blockTitle}>最近记录 · {history.length}</ThemedText>
      {history.length === 0 ? (
        <View style={[styles.emptyCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>浏览和跟做记录会出现在这里。</ThemedText>
        </View>
      ) : (
        <View style={[styles.historyList, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {history.map((item) => (
            <View key={`${item.kind}-${item.dishId}`} style={[styles.historyRow, { borderTopColor: colors.line }]}>
              <MaterialCommunityIcons
                name={item.kind === 'session' ? 'check-decagram' : item.kind === 'favorite' ? 'heart' : 'eye-outline'}
                size={16}
                color={item.kind === 'session' ? GREEN : item.kind === 'favorite' ? CORAL : colors.primary}
              />
              <View style={styles.historyCopy}>
                <ThemedText numberOfLines={1} style={styles.historyTitle}>
                  {displayDishName(item)}
                </ThemedText>
                <ThemedText style={[styles.historyMeta, { color: colors.mutedText }]}>
                  {item.kind === 'session' ? '做过' : item.kind === 'favorite' ? '收藏' : '浏览'} ·{' '}
                  {formatFetchedAt(item.createdAt)}
                </ThemedText>
              </View>
              {item.kind !== 'favorite' ? (
                <MaterialCommunityIcons name="chevron-right" size={16} color={colors.mutedText} />
              ) : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function SourceModal({
  dish,
  onClose,
  onOpenExternal,
  visible,
}: {
  dish: CookingDishDetail;
  onClose: () => void;
  onOpenExternal: (url: string) => void;
  visible: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭来源" accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>数据来源</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>
                {displayDishName(dish)} · 字段级可追溯
              </ThemedText>
            </View>
            <HeaderIconButton accessibilityLabel="关闭" icon="close" onPress={onClose} />
          </View>
          <View style={styles.sourceFieldRow}>
            <ThemedText style={[styles.sourceFieldLabel, { color: colors.mutedText }]}>菜谱原文</ThemedText>
            <ThemedText style={[styles.sourceFieldValue, { color: colors.text }]}>{dish.recipeSource || '暂无'}</ThemedText>
          </View>
          <View style={styles.sourceFieldRow}>
            <ThemedText style={[styles.sourceFieldLabel, { color: colors.mutedText }]}>图片</ThemedText>
            <ThemedText numberOfLines={2} style={[styles.sourceFieldValue, { color: colors.text }]}>
              {dish.image.url}
            </ThemedText>
          </View>
          <View style={styles.sourceFieldRow}>
            <ThemedText style={[styles.sourceFieldLabel, { color: colors.mutedText }]}>抓取时间</ThemedText>
            <ThemedText style={[styles.sourceFieldValue, { color: colors.text }]}>{formatFetchedAt(dish.fetchedAt)}</ThemedText>
          </View>
          <View style={styles.sourceFieldRow}>
            <ThemedText style={[styles.sourceFieldLabel, { color: colors.mutedText }]}>许可</ThemedText>
            <ThemedText style={[styles.sourceFieldValue, { color: colors.text }]}>{dish.license || 'themealdb-open'}</ThemedText>
          </View>
          <View style={styles.sourceActions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => onOpenExternal(dish.recipeSource)}
              style={styles.sourceActionSecondary}>
              <MaterialCommunityIcons name="link-variant" size={15} color={colors.text} />
              <ThemedText style={[styles.sourceActionText, { color: colors.text }]}>查看原菜谱</ThemedText>
            </Pressable>
            {dish.videoUrl ? (
              <Pressable accessibilityRole="button" onPress={() => onOpenExternal(dish.videoUrl)} style={styles.sourceActionPrimary}>
                <MaterialCommunityIcons name="youtube" size={15} color="#ffffff" />
                <ThemedText style={styles.sourceActionPrimaryText}>看视频</ThemedText>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

function ContributionModal({
  colors,
  contribution,
  loading,
  onChange,
  onClose,
  onSubmit,
  visible,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  contribution: CookingContributionInput;
  loading: boolean;
  onChange: (value: CookingContributionInput) => void;
  onClose: () => void;
  onSubmit: () => void;
  visible: boolean;
}) {
  function setField(field: keyof CookingContributionInput, value: string) {
    onChange({ ...contribution, [field]: value });
  }
  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="关闭提交" accessibilityRole="button" onPress={onClose} style={styles.modalBackdrop} />
        <View style={[styles.sheet, styles.contributionSheet, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>提交我的菜谱</ThemedText>
              <ThemedText style={[styles.sheetMeta, { color: colors.mutedText }]}>
                提交后进入人工审核，审核通过才展示
              </ThemedText>
            </View>
            <HeaderIconButton accessibilityLabel="关闭" icon="close" onPress={onClose} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>菜名（必填）</ThemedText>
            <TextInput
              accessibilityLabel="菜名"
              onChangeText={(value) => setField('name', value)}
              placeholder="例如：红烧肉"
              placeholderTextColor={colors.mutedText}
              style={[styles.formInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={contribution.name}
            />
            <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>菜系（必填）</ThemedText>
            <TextInput
              accessibilityLabel="菜系"
              onChangeText={(value) => setField('area', value)}
              placeholder="例如：中式"
              placeholderTextColor={colors.mutedText}
              style={[styles.formInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={contribution.area}
            />
            <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>分类（可选）</ThemedText>
            <TextInput
              accessibilityLabel="分类"
              onChangeText={(value) => setField('category', value)}
              placeholder="例如：家常菜"
              placeholderTextColor={colors.mutedText}
              style={[styles.formInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={contribution.category}
            />
            <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>图片来源链接（可选）</ThemedText>
            <TextInput
              accessibilityLabel="图片来源链接"
              onChangeText={(value) => setField('imageUrl', value)}
              placeholder="https://..."
              placeholderTextColor={colors.mutedText}
              style={[styles.formInput, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={contribution.imageUrl}
            />
            <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>食材（每行一个，必填）</ThemedText>
            <TextInput
              accessibilityLabel="食材"
              multiline
              onChangeText={(value) => onChange({ ...contribution, ingredients: value.split('\n') })}
              placeholder={'五花肉\n冰糖\n生抽'}
              placeholderTextColor={colors.mutedText}
              style={[styles.formTextarea, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={contribution.ingredients.join('\n')}
            />
            <ThemedText style={[styles.formLabel, { color: colors.mutedText }]}>步骤（每行一步，必填）</ThemedText>
            <TextInput
              accessibilityLabel="步骤"
              multiline
              onChangeText={(value) => onChange({ ...contribution, steps: value.split('\n') })}
              placeholder={'五花肉焯水后捞出\n下锅煸炒至微黄\n加入调料炖煮四十分钟'}
              placeholderTextColor={colors.mutedText}
              style={[styles.formTextarea, { backgroundColor: colors.surfaceMuted, color: colors.text }]}
              value={contribution.steps.join('\n')}
            />
            <Pressable
              accessibilityRole="button"
              disabled={loading}
              onPress={onSubmit}
              style={[styles.shoppingAction, loading && { opacity: 0.7 }]}>
              {loading ? <ActivityIndicator color="#ffffff" /> : <ThemedText style={styles.shoppingActionText}>提交审核</ThemedText>}
            </Pressable>
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

function DetailIconButton({
  icon,
  label,
  onPress,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityLabel={label} accessibilityRole="button" onPress={onPress} style={styles.detailIconButton}>
      <MaterialCommunityIcons name={icon} size={18} color={NAVY} />
    </Pressable>
  );
}

function FeedbackButton({
  active,
  icon,
  onPress,
}: {
  active: boolean;
  icon: IconName;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.feedbackButton,
        { backgroundColor: active ? colors.primarySoft : colors.surfaceMuted, borderColor: active ? colors.primary : colors.line },
      ]}>
      <MaterialCommunityIcons name={icon} size={15} color={active ? colors.primary : colors.mutedText} />
    </Pressable>
  );
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
  homeBlock: {
    gap: 14,
  },
  heroSearch: {
    alignItems: 'center',
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    minHeight: 54,
    paddingHorizontal: 13,
  },
  heroInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    minHeight: 52,
    paddingVertical: 8,
  },
  searchButton: {
    alignItems: 'center',
    borderRadius: 9,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  sectionHead: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '900',
  },
  sectionMeta: {
    fontSize: 10,
    fontWeight: '700',
  },
  areaRow: {
    gap: 8,
    paddingBottom: 4,
  },
  areaChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 13,
  },
  areaChipText: {
    fontSize: 12,
    fontWeight: '900',
  },
  areaChipCount: {
    fontSize: 9,
    fontWeight: '700',
  },
  realPill: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  realPillText: {
    color: '#a34b2a',
    fontSize: 9,
    fontWeight: '900',
  },
  dishList: {
    gap: 11,
  },
  dishCard: {
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 12,
  },
  dishImage: {
    borderRadius: 11,
    flexShrink: 0,
    height: 96,
    width: 104,
  },
  dishMain: {
    flex: 1,
    minWidth: 0,
  },
  dishTitleRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: 7,
  },
  dishZh: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '900',
  },
  dishEn: {
    flex: 1,
    fontSize: 9,
    fontWeight: '700',
  },
  dishMeta: {
    fontSize: 9.5,
    fontWeight: '700',
    marginTop: 4,
  },
  dishStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  statPill: {
    alignItems: 'center',
    borderRadius: 7,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  statPillText: {
    fontSize: 9.5,
    fontWeight: '900',
  },
  sourceLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 6,
  },
  sourceLineText: {
    fontSize: 8.5,
    fontWeight: '700',
  },
  resultsBlock: {
    gap: 12,
  },
  summaryCard: {
    alignItems: 'center',
    borderRadius: 13,
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'space-between',
    padding: 13,
  },
  summaryCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  summaryTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  summaryMeta: {
    color: '#aab3c8',
    fontSize: 9,
  },
  aiPill: {
    alignItems: 'center',
    backgroundColor: 'rgba(201,243,106,0.14)',
    borderColor: 'rgba(201,243,106,0.4)',
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  aiPillText: {
    color: LIME,
    fontSize: 9,
    fontWeight: '900',
  },
  toolbar: {
    flexDirection: 'row',
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
  filterRow: {
    gap: 7,
    paddingBottom: 2,
  },
  filterChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 30,
    paddingHorizontal: 12,
  },
  filterChipText: {
    fontSize: 10,
    fontWeight: '800',
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
  detailBlock: {
    gap: 12,
  },
  detailHero: {
    borderRadius: 16,
    height: 220,
    overflow: 'hidden',
    position: 'relative',
  },
  detailNav: {
    flexDirection: 'row',
    gap: 9,
    left: 14,
    position: 'absolute',
    top: 14,
    zIndex: 2,
  },
  detailNavSpacer: {
    width: 150,
  },
  detailIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 50,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  detailTitleWrap: {
    bottom: 14,
    left: 18,
    position: 'absolute',
    right: 18,
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
    textShadowColor: 'rgba(16,20,38,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  detailSubtitle: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 10,
    marginTop: 4,
  },
  detailBody: {
    gap: 10,
  },
  detailMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  metaPill: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  metaPillText: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  metaPillCoralText: {
    color: '#a34b2a',
    fontSize: 9.5,
    fontWeight: '800',
  },
  blockTitle: {
    fontSize: 14,
    fontWeight: '900',
    marginTop: 4,
  },
  ingredientGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  ingredientCell: {
    alignItems: 'center',
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 9,
    width: '48.5%',
  },
  ingredientName: {
    flex: 1,
    fontSize: 9.5,
    fontWeight: '800',
    lineHeight: 14,
  },
  ingredientMeasure: {
    fontSize: 8.5,
    fontWeight: '700',
  },
  stepPreview: {
    borderRadius: 10,
    borderWidth: 1,
    gap: 9,
    padding: 11,
  },
  stepLine: {
    flexDirection: 'row',
    gap: 8,
  },
  stepNum: {
    alignItems: 'center',
    borderRadius: 7,
    height: 22,
    justifyContent: 'center',
    width: 22,
  },
  stepNumText: {
    fontSize: 9,
    fontWeight: '900',
  },
  stepLineText: {
    flex: 1,
    fontSize: 10,
    lineHeight: 16,
  },
  sourceCard: {
    alignItems: 'center',
    borderRadius: 11,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  sourceCopy: {
    flex: 1,
    gap: 2,
  },
  sourceTitle: {
    color: '#ffffff',
    fontSize: 10.5,
    fontWeight: '900',
  },
  sourceMeta: {
    color: '#aab3c8',
    fontSize: 8.5,
  },
  feedbackRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 32,
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
    height: 27,
    justifyContent: 'center',
    width: 31,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 6,
  },
  detailActionSecondary: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 46,
    paddingHorizontal: 13,
  },
  detailActionSecondaryText: {
    fontSize: 12,
    fontWeight: '800',
  },
  detailActionPrimary: {
    alignItems: 'center',
    backgroundColor: CORAL,
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 46,
  },
  detailActionPrimaryText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  cookScreen: {
    backgroundColor: DARK,
    borderRadius: 18,
    minHeight: 620,
    overflow: 'hidden',
  },
  cookNav: {
    alignItems: 'center',
    flexDirection: 'row',
    height: 54,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  cookIconButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 50,
    height: 34,
    justifyContent: 'center',
    width: 34,
  },
  cookDish: {
    color: '#aab3c8',
    fontSize: 10,
    fontWeight: '700',
  },
  cookBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  cookProgressHead: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cookStepLabel: {
    color: '#ffffff',
    fontFamily: 'Manrope',
    fontSize: 18,
    fontWeight: '800',
  },
  cookStepTotal: {
    color: LIME,
    fontSize: 10,
    fontWeight: '900',
  },
  progressTrack: {
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 999,
    height: 6,
    marginBottom: 16,
    overflow: 'hidden',
  },
  progressFill: {
    backgroundColor: LIME,
    borderRadius: 999,
    height: '100%',
  },
  stepCard: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 300,
    padding: 22,
  },
  stepTag: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  stepTagText: {
    color: LIME,
    fontSize: 10,
    fontWeight: '900',
  },
  stepText: {
    color: '#f1f4fb',
    fontSize: 18,
    fontWeight: '700',
    lineHeight: 32,
    marginTop: 14,
  },
  cookActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 16,
  },
  cookButton: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
  },
  cookButtonDisabled: {
    opacity: 0.4,
  },
  cookButtonText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  cookNextButton: {
    alignItems: 'center',
    backgroundColor: CORAL,
    borderRadius: 12,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 48,
  },
  cookNextText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  shoppingBlock: {
    gap: 14,
  },
  shoppingHead: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },
  shoppingTitle: {
    fontSize: 13,
    fontWeight: '900',
  },
  shoppingMeta: {
    color: '#a34b2a',
    fontSize: 9,
  },
  shoppingList: {
    gap: 7,
  },
  shoppingRow: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  checkBox: {
    alignItems: 'center',
    borderColor: '#c3cede',
    borderRadius: 7,
    borderWidth: 1.5,
    height: 20,
    justifyContent: 'center',
    width: 20,
  },
  checkBoxDone: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },
  shoppingIngredient: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
  },
  shoppingIngredientDone: {
    color: '#9aa7c0',
    textDecorationLine: 'line-through',
  },
  shoppingMeasure: {
    fontSize: 9.5,
    fontWeight: '700',
  },
  shoppingAction: {
    alignItems: 'center',
    backgroundColor: CORAL,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 50,
    marginTop: 4,
  },
  shoppingActionText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  kitchenBlock: {
    gap: 12,
  },
  contributionCard: {
    alignItems: 'center',
    borderRadius: 12,
    flexDirection: 'row',
    gap: 10,
    padding: 13,
  },
  contributionCopy: {
    flex: 1,
    gap: 2,
  },
  contributionTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  contributionMeta: {
    color: '#aab3c8',
    fontSize: 9,
  },
  historyList: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  historyRow: {
    alignItems: 'center',
    borderTopWidth: 1,
    flexDirection: 'row',
    gap: 10,
    minHeight: 56,
  },
  historyCopy: {
    flex: 1,
    gap: 2,
    minWidth: 0,
  },
  historyTitle: {
    fontSize: 12,
    fontWeight: '800',
  },
  historyMeta: {
    fontSize: 9.5,
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
  contributionSheet: {
    maxHeight: '92%',
  },
  sheetHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '900',
  },
  sheetMeta: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 2,
  },
  sourceFieldRow: {
    alignItems: 'flex-start',
    borderTopWidth: 1,
    gap: 4,
    paddingVertical: 10,
  },
  sourceFieldLabel: {
    fontSize: 9.5,
    fontWeight: '800',
  },
  sourceFieldValue: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 17,
  },
  sourceActions: {
    flexDirection: 'row',
    gap: 9,
  },
  sourceActionSecondary: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 46,
  },
  sourceActionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  sourceActionPrimary: {
    alignItems: 'center',
    backgroundColor: CORAL,
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 46,
  },
  sourceActionPrimaryText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '900',
  },
  formLabel: {
    fontSize: 10,
    fontWeight: '800',
    marginBottom: 6,
    marginTop: 6,
  },
  formInput: {
    borderRadius: 10,
    fontSize: 13,
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  formTextarea: {
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 20,
    minHeight: 96,
    padding: 12,
    textAlignVertical: 'top',
  },
});
