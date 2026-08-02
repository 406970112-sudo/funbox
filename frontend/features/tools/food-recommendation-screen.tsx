import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState, type ComponentProps } from 'react';
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
  buildFoodRequest,
  countActiveFilters,
  CUISINE_OPTIONS,
  DIETARY_OPTIONS,
  DISTANCE_RANGES,
  emptyFoodFilter,
  filterFoodItems,
  formatDistance,
  formatPrice,
  PRICE_RANGES,
  SCENARIO_OPTIONS,
  sortFoodItems,
  SPICINESS_OPTIONS,
  shuffleFoodItems,
  summarizeFoodRequest,
  type FoodFilter,
  type FoodSortKey,
} from '@/lib/food-recommendation';
import {
  addFoodRecommendationFavorite,
  fetchFoodRecommendationFavorites,
  fetchFoodRecommendationHistory,
  fetchFoodRecommendationQuery,
  getFoodRecommendationErrorMessage,
  queryFoodRecommendation,
  removeFoodRecommendationFavorite,
  submitFoodRecommendationFeedback,
} from '@/lib/food-recommendation-api';
import { MobileScreen } from '@/shared/ui/mobile-screen';
import { PageHeader } from '@/shared/ui/page-header';
import { SurfaceCard } from '@/shared/ui/surface-card';
import type {
  FoodAvailableFilters,
  FoodFilterOption,
  FoodHistoryItem,
  FoodItem,
  FoodRequest,
  FoodResponse,
} from '@/types/food-recommendation';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

type WebGeolocation = {
  getCurrentPosition: (
    success: (position: { coords: { latitude: number; longitude: number } }) => void,
    error?: (error: { code: number; message: string; PERMISSION_DENIED: number }) => void,
    options?: { enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number },
  ) => void;
};

const HERO = '#151b3b';
const BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#e85d4a';
const GREEN = '#24b36b';
const AMBER = '#f1a33b';
const WARM = '#fff4ed';

const QUICK_ADDRESSES = [
  '成都市武侯区玉林西路 12 号',
  '成都武侯祠',
  '成都春熙路',
  '重庆解放碑',
];

const TASTE_CHIPS = ['不要辣', '人均50内', '朋友聚餐', '夜宵'];

const SORT_OPTIONS: { id: FoodSortKey; label: string }[] = [
  { id: 'fit', label: '综合' },
  { id: 'distance', label: '距离' },
  { id: 'price-asc', label: '人均' },
  { id: 'rating', label: '评分' },
];

const FOLLOW_UP_ACTIONS: { label: string; icon: IconName; apply: (input: FoodRequest) => FoodRequest }[] = [
  {
    label: '不要辣',
    icon: 'food-off',
    apply: (input) => ({
      ...input,
      spiciness: ['不辣'],
      dietary: Array.from(new Set([...(input.dietary ?? []), '不吃辣'])),
    }),
  },
  {
    label: '人均 100 内',
    icon: 'wallet-outline',
    apply: (input) => ({ ...input, priceMin: undefined, priceMax: 100 }),
  },
  {
    label: '适合一个人',
    icon: 'account-outline',
    apply: (input) => ({
      ...input,
      scenarios: Array.from(new Set([...(input.scenarios ?? []), '一人食'])),
    }),
  },
  {
    label: '3km 内',
    icon: 'map-marker-radius-outline',
    apply: (input) => ({ ...input, distanceMaxKm: 3 }),
  },
];

export function FoodRecommendationScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { accessToken, status: authStatus } = useAuth();
  const [addressText, setAddressText] = useState('成都市武侯区玉林西路 12 号');
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState('输入地址，看看附近有什么本地味道。');
  const [result, setResult] = useState<FoodResponse | null>(null);
  const [showInput, setShowInput] = useState(true);
  const [selectedItem, setSelectedItem] = useState<FoodItem | null>(null);
  const [sortKey, setSortKey] = useState<FoodSortKey>('fit');
  const [filterApplied, setFilterApplied] = useState<FoodFilter>(emptyFoodFilter());
  const [filterDraft, setFilterDraft] = useState<FoodFilter>(emptyFoodFilter());
  const [showFilter, setShowFilter] = useState(false);
  const [history, setHistory] = useState<FoodHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, 'helpful' | 'not' | undefined>>({});
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(0);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !accessToken) return;
    fetchFoodRecommendationFavorites(accessToken)
      .then((items) => {
        setFavorites(Object.fromEntries(items.map((id) => [id, true])));
      })
      .catch(() => {
        // Favorites remain local when the server is unavailable.
      });
  }, [accessToken, authStatus]);

  async function refreshHistory() {
    if (authStatus !== 'authenticated' || !accessToken) return;
    try {
      setHistory(await fetchFoodRecommendationHistory(accessToken));
    } catch {
      // History is optional; keep local entries when the server is unavailable.
    }
  }

  async function runQuery(overrides?: Partial<FoodRequest>) {
    const request = buildFoodRequest({
      query: addressText,
      cuisines: [],
      spiciness: [],
      dietary: [],
      scenarios: [],
    });
    const payload = { ...request, ...overrides };
    if (!payload.lat && location) {
      payload.lat = location.lat;
      payload.lng = location.lng;
    }
    if (!payload.query.trim()) {
      setStatusMessage('先输入一个地址，例如：成都市武侯区玉林西路。');
      return;
    }

    setSubmitting(true);
    setStatusMessage('正在按地址匹配附近美食...');
    try {
      const next = await queryFoodRecommendation(payload, accessToken);
      setResult(next);
      setSelectedItem(null);
      setShowInput(false);
      setSortKey('fit');
      setFilterApplied(emptyFoodFilter());
      setFilterDraft(emptyFoodFilter());
      setStatusMessage(
        next.ai === 'deepseek'
          ? `已为你找到 ${next.items.length} 道本地美食，理由来自 DeepSeek 分析。`
          : `已为你找到 ${next.items.length} 道本地美食，当前为规则匹配模式。`,
      );
      setHistory((previous) => [
        {
          queryId: next.queryId,
          query: summarizeFoodRequest(payload),
          city: next.city,
          district: next.district,
          summary: next.summary,
          dishCount: next.items.length,
          createdAt: next.generatedAt,
        },
        ...previous,
      ].slice(0, 20));
      void refreshHistory();
    } catch (error) {
      setStatusMessage(getFoodRecommendationErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFeedback(item: FoodItem, helpful: boolean) {
    if (!result) return;
    setFeedback((current) => ({ ...current, [item.dishId]: helpful ? 'helpful' : 'not' }));
    setStatusMessage(helpful ? '已记录有帮助反馈。' : '已记录反馈，我们会继续校准推荐。');
    try {
      await submitFoodRecommendationFeedback(
        { queryId: result.queryId, dishId: item.dishId, helpful },
        accessToken,
      );
    } catch {
      // Keep the local feedback state even when the server is unavailable.
    }
  }

  function openRestaurant(item: FoodItem) {
    if (item.navigateUrl) {
      Linking.openURL(item.navigateUrl).catch(() => {
        setStatusMessage('当前环境无法打开地图，可复制地址到地图 App 搜索。');
      });
      return;
    }
    const keyword = encodeURIComponent(`${item.restaurant.name} ${item.restaurant.address}`);
    Linking.openURL(`https://uri.amap.com/search?keyword=${keyword}`).catch(() => {
      setStatusMessage('当前环境无法打开地图，可复制地址到地图 App 搜索。');
    });
  }

  async function toggleFavorite(item: FoodItem) {
    const next = !favorites[item.dishId];
    setFavorites((current) => ({ ...current, [item.dishId]: next }));
    setStatusMessage(next ? '已收藏，登录后会在服务端同步。' : '已取消收藏。');
    if (authStatus !== 'authenticated' || !accessToken) return;
    try {
      if (next) {
        await addFoodRecommendationFavorite(accessToken, item.dishId);
      } else {
        await removeFoodRecommendationFavorite(accessToken, item.dishId);
      }
    } catch {
      setFavorites((current) => ({ ...current, [item.dishId]: !next }));
      setStatusMessage('收藏同步失败，已恢复本地状态。');
    }
  }

  function requestCurrentLocation() {
    setSubmitting(true);
    setStatusMessage('正在获取真实定位...');
    const geolocation = (globalThis as { navigator?: { geolocation?: WebGeolocation } }).navigator?.geolocation;
    if (Platform.OS !== 'web' || !geolocation) {
      setSubmitting(false);
      setStatusMessage('当前环境不支持自动定位，请手动输入地址。');
      return;
    }
    geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setLocation({ lat, lng });
        setAddressText(`当前位置（${lat.toFixed(5)}, ${lng.toFixed(5)}）`);
        setStatusMessage(`已获取真实定位（${lat.toFixed(5)}, ${lng.toFixed(5)}），正在匹配附近美食。`);
        void runQuery({ lat, lng });
      },
      (error) => {
        setSubmitting(false);
        setStatusMessage(
          error.code === error.PERMISSION_DENIED ? '定位权限被拒绝，请手动输入地址。' : '定位失败，请手动输入地址。',
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }

  async function handleHistorySelect(item: FoodHistoryItem) {
    setShowHistory(false);
    setSubmitting(true);
    setStatusMessage('正在加载历史美食推荐...');
    try {
      const next = await fetchFoodRecommendationQuery(item.queryId, accessToken);
      setResult(next);
      setSelectedItem(null);
      setShowInput(false);
      setSortKey('fit');
      setFilterApplied(emptyFoodFilter());
      setStatusMessage(`已加载 ${next.items.length} 道历史美食推荐。`);
    } catch (error) {
      setStatusMessage(getFoodRecommendationErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  function openFilterPanel() {
    setFilterDraft({
      cuisines: [...filterApplied.cuisines],
      spiciness: [...filterApplied.spiciness],
      priceRange: filterApplied.priceRange,
      distanceRange: filterApplied.distanceRange,
      dietary: [...filterApplied.dietary],
      scenarios: [...filterApplied.scenarios],
    });
    setShowFilter(true);
  }

  function applyFilter() {
    setFilterApplied({
      cuisines: [...filterDraft.cuisines],
      spiciness: [...filterDraft.spiciness],
      priceRange: filterDraft.priceRange,
      distanceRange: filterDraft.distanceRange,
      dietary: [...filterDraft.dietary],
      scenarios: [...filterDraft.scenarios],
    });
    setShowFilter(false);
    setStatusMessage('筛选已应用到当前美食结果。');
  }

  const filteredItems = result
    ? sortFoodItems(filterFoodItems(result.items, filterApplied), sortKey)
    : [];
  const displayedItems =
    shuffleSeed > 0 && sortKey === 'fit' ? shuffleFoodItems(filteredItems, shuffleSeed) : filteredItems;
  const filterCount = countActiveFilters(filterApplied);

  return (
    <MobileScreen contentContainerStyle={styles.pageContent}>
      <PageHeader
        eyebrow="Local Food"
        title="本地美食推荐"
        subtitle="输入地址，推荐附近的本地味道"
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
        icon={submitting ? 'progress-clock' : result ? 'check-circle-outline' : 'food'}
        message={statusMessage}
      />

      {selectedItem ? (
        <DetailView
          colors={colors}
          favorite={!!favorites[selectedItem.dishId]}
          item={selectedItem}
          onBack={() => setSelectedItem(null)}
          onFollowUp={(action) => {
            const request = buildFoodRequest({
              query: addressText,
              cuisines: [],
              spiciness: [],
              dietary: [],
              scenarios: [],
            });
            const adjusted = action.apply(request);
            setAddressText(adjusted.query);
            void runQuery(adjusted);
          }}
          onOpenRestaurant={() => openRestaurant(selectedItem)}
          onToggleFavorite={() => void toggleFavorite(selectedItem)}
        />
      ) : showInput || !result ? (
        <InputHero
          colors={colors}
          location={location}
          onAddressChange={setAddressText}
          onExamplePress={setAddressText}
          onStart={() => void runQuery()}
          onUseLocation={() => void requestCurrentLocation()}
          submitting={submitting}
          value={addressText}
        />
      ) : (
        <ResultsView
          colors={colors}
          feedback={feedback}
          filterCount={filterCount}
          items={displayedItems}
          onFeedback={(item, helpful) => void submitFeedback(item, helpful)}
          onFilterOpen={openFilterPanel}
          onFollowUp={(action) => {
            const request = buildFoodRequest({
              query: addressText,
              cuisines: [],
              spiciness: [],
              dietary: [],
              scenarios: [],
            });
            const adjusted = action.apply(request);
            void runQuery(adjusted);
          }}
          onOpenDetail={setSelectedItem}
          onRefresh={() => {
            setShuffleSeed((seed) => seed + 1);
            setSortKey('fit');
            setStatusMessage('已为你换一批推荐。');
          }}
          onResetFilter={() => setFilterApplied(emptyFoodFilter())}
          onResetInput={() => {
            setResult(null);
            setShowInput(true);
            setStatusMessage('换个地址或口味试试。');
          }}
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
        onClose={() => setShowFilter(false)}
        onCuisineToggle={(value) => toggleDraftValue('cuisines', value)}
        onDietaryToggle={(value) => toggleDraftValue('dietary', value)}
        onDistanceSelect={(option) => setFilterDraft((current) => ({ ...current, distanceRange: option }))}
        onPriceSelect={(option) => setFilterDraft((current) => ({ ...current, priceRange: option }))}
        onReset={() => setFilterDraft(emptyFoodFilter())}
        onScenarioToggle={(value) => toggleDraftValue('scenarios', value)}
        onSpicinessToggle={(value) => toggleDraftValue('spiciness', value)}
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

  function toggleDraftValue(key: 'cuisines' | 'spiciness' | 'dietary' | 'scenarios', value: string) {
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
  onAddressChange,
  onExamplePress,
  onStart,
  onUseLocation,
  submitting,
  value,
  location,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  location: { lat: number; lng: number } | null;
  onAddressChange: (text: string) => void;
  onExamplePress: (text: string) => void;
  onStart: () => void;
  onUseLocation: () => void;
  submitting: boolean;
  value: string;
}) {
  return (
    <View style={styles.heroBlock}>
      <ThemedText style={styles.heroTitle}>今天想吃什么？</ThemedText>
      <ThemedText style={[styles.heroSub, { color: colors.mutedText }]}>
        输入地址或开启定位，推荐附近的地道本地味道
      </ThemedText>

      <View style={[styles.locationCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <View style={[styles.locationIcon, { backgroundColor: colors.primarySoft }]}>
          <MaterialCommunityIcons name="map-marker-radius-outline" size={17} color={BLUE} />
        </View>
        <View style={styles.locationCopy}>
          <ThemedText style={styles.locationTitle}>{location ? '当前位置已获取' : '当前位置未获取'}</ThemedText>
          <ThemedText style={[styles.locationMeta, { color: colors.mutedText }]}>
            {location ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}` : '点击重新定位获取真实坐标'}
          </ThemedText>
        </View>
        <Pressable accessibilityLabel="重新定位" accessibilityRole="button" onPress={onUseLocation} style={[styles.locationButton, { backgroundColor: colors.surfaceMuted }]}>
          <ThemedText style={[styles.locationButtonText, { color: colors.mutedText }]}>重新定位</ThemedText>
        </Pressable>
      </View>

      <View style={[styles.heroSearch, { backgroundColor: colors.surface, borderColor: colors.line }]}>
        <MaterialCommunityIcons name="map-marker-outline" size={20} color={colors.mutedText} />
        <TextInput
          accessibilityLabel="输入地址"
          onChangeText={onAddressChange}
          placeholder="例如：成都市武侯区玉林西路 12 号"
          placeholderTextColor={colors.mutedText}
          style={[styles.heroInput, { color: colors.text }]}
          value={value}
        />
        <Pressable
          accessibilityLabel="语音输入"
          accessibilityRole="button"
          style={[styles.heroMic, { backgroundColor: colors.surfaceMuted }]}>
          <MaterialCommunityIcons name="microphone-outline" size={18} color={colors.primary} />
        </Pressable>
      </View>

      <ThemedText style={[styles.exampleLabel, { color: colors.mutedText }]}>
        不知道去哪？点地址试试
      </ThemedText>
      <View style={styles.exampleRow}>
        {QUICK_ADDRESSES.map((example) => (
          <Pressable
            accessibilityRole="button"
            key={example}
            onPress={() => onExamplePress(example)}
            style={[
              styles.exampleChip,
              {
                backgroundColor: value === example ? colors.primarySoft : colors.surface,
                borderColor: value === example ? BLUE : colors.line,
              },
            ]}>
            <ThemedText
              style={[styles.exampleChipText, { color: value === example ? BLUE : colors.text }]}>
              {example}
            </ThemedText>
          </Pressable>
        ))}
      </View>

      <ThemedText style={[styles.exampleLabel, { color: colors.mutedText }]}>
        顺便说说口味，也可以跳过
      </ThemedText>
      <View style={styles.exampleRow}>
        {TASTE_CHIPS.map((chip) => (
          <Pressable
            accessibilityRole="button"
            key={chip}
            onPress={() => onAddressChange(`${value}，${chip}`)}
            style={[styles.tasteChip, { backgroundColor: WARM, borderColor: '#ffdcc8' }]}>
            <ThemedText style={styles.tasteChipText}>{chip}</ThemedText>
          </Pressable>
        ))}
      </View>

      <Pressable
        accessibilityLabel="AI 生成美食推荐"
        accessibilityRole="button"
        disabled={submitting}
        onPress={onStart}
        style={[styles.primaryButton, { backgroundColor: HERO, opacity: submitting ? 0.72 : 1 }]}>
        {submitting ? (
          <ActivityIndicator color={LIME} />
        ) : (
          <>
            <MaterialCommunityIcons name="auto-fix" size={19} color={LIME} />
            <ThemedText style={styles.primaryButtonText}>AI 生成美食推荐</ThemedText>
          </>
        )}
      </Pressable>
      <ThemedText style={[styles.heroHint, { color: colors.mutedText }]}>
        先看结果，不满意再筛选或追问
      </ThemedText>
    </View>
  );
}

function ResultsView({
  colors,
  feedback,
  filterCount,
  items,
  onFeedback,
  onFilterOpen,
  onFollowUp,
  onOpenDetail,
  onRefresh,
  onResetFilter,
  onResetInput,
  onSort,
  result,
  sortKey,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  feedback: Record<string, 'helpful' | 'not' | undefined>;
  filterCount: number;
  items: FoodItem[];
  onFeedback: (item: FoodItem, helpful: boolean) => void;
  onFilterOpen: () => void;
  onFollowUp: (action: (typeof FOLLOW_UP_ACTIONS)[number]) => void;
  onOpenDetail: (item: FoodItem) => void;
  onRefresh: () => void;
  onResetFilter: () => void;
  onResetInput: () => void;
  onSort: (sortKey: FoodSortKey) => void;
  result: FoodResponse;
  sortKey: FoodSortKey;
}) {
  return (
    <View style={styles.resultsBlock}>
      <View style={styles.summaryRow}>
        <View style={styles.summaryCopy}>
          <ThemedText style={styles.summaryTitle}>
            为你找到 {items.length} 道{result.district || result.city}本地美食
          </ThemedText>
          <ThemedText style={[styles.summaryMeta, { color: colors.mutedText }]}>
            {result.ai === 'deepseek' ? 'DeepSeek 分析' : '规则匹配'} · {result.dataMode === 'poi' ? '真实 POI' : '种子库'} · 图片与价格为快照
          </ThemedText>
        </View>
        <View style={[styles.aiPill, { backgroundColor: colors.primarySoft }]}>
          <ThemedText style={[styles.aiPillText, { color: BLUE }]}>AI 分析</ThemedText>
        </View>
      </View>

      <View style={styles.toolbar}>
        <View style={[styles.sortRow, { backgroundColor: colors.surfaceMuted }]}>
          {SORT_OPTIONS.map((option) => {
            const active = option.id === sortKey;
            return (
              <Pressable
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                key={option.id}
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
          <ThemedText style={styles.emptyTitle}>没有符合条件的美食</ThemedText>
          <ThemedText style={[styles.emptyText, { color: colors.mutedText }]}>
            试试重置筛选，或换一个地址重新生成
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
            <FoodCard
              colors={colors}
              feedback={feedback[item.dishId]}
              index={index}
              item={item}
              key={item.dishId}
              onFeedback={(helpful) => onFeedback(item, helpful)}
              onOpen={() => onOpenDetail(item)}
            />
          ))}
        </View>
      )}

      <View style={styles.resultsActions}>
        <Pressable
          accessibilityLabel="换个地址重新输入"
          accessibilityRole="button"
          onPress={onResetInput}
          style={[styles.resetInputButton, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="pencil-outline" size={16} color={colors.mutedText} />
          <ThemedText style={[styles.resetInputText, { color: colors.mutedText }]}>换个地址</ThemedText>
        </Pressable>
        <Pressable
          accessibilityLabel="换一批"
          accessibilityRole="button"
          onPress={onRefresh}
          style={[styles.refreshButton, { borderColor: colors.line }]}>
          <MaterialCommunityIcons name="refresh" size={16} color={BLUE} />
          <ThemedText style={[styles.refreshText, { color: BLUE }]}>换一批</ThemedText>
        </Pressable>
      </View>
      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>{result.disclaimer}</ThemedText>
    </View>
  );
}

function FoodCard({
  colors,
  feedback,
  index,
  item,
  onFeedback,
  onOpen,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  feedback?: 'helpful' | 'not';
  index: number;
  item: FoodItem;
  onFeedback: (helpful: boolean) => void;
  onOpen: () => void;
}) {
  return (
    <SurfaceCard style={[styles.foodCard, { borderTopColor: index === 0 ? CORAL : colors.line }]}>
      <View style={styles.cardHeader}>
        <Pressable
          accessibilityLabel={`查看${item.name}详情`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.foodImageWrap}>
          <Image
            contentFit="cover"
            source={{ uri: item.image.url }}
            style={[styles.foodImage, { backgroundColor: colors.surfaceMuted }]}
            transition={150}
          />
          {index === 0 ? (
            <View style={styles.bestBadge}>
              <ThemedText style={styles.bestBadgeText}>最推荐</ThemedText>
            </View>
          ) : null}
        </Pressable>
        <Pressable
          accessibilityLabel={`查看${item.name}详情`}
          accessibilityRole="button"
          onPress={onOpen}
          style={styles.cardMain}>
          <View style={styles.cardTitleRow}>
            <ThemedText numberOfLines={1} style={styles.cardTitle}>{item.name}</ThemedText>
            <View style={[styles.scorePill, { backgroundColor: colors.surfaceMuted }]}>
              <ThemedText style={[styles.scoreText, { color: GREEN }]}>{item.rating.toFixed(1)}</ThemedText>
            </View>
          </View>
          <ThemedText style={[styles.cardCuisine, { color: item.spiciness === '重辣' ? CORAL : colors.mutedText }]}>
            {item.cuisine} · {item.spiciness} · {item.flavorProfile.slice(0, 2).join(' / ')}
          </ThemedText>
          <View style={styles.restaurantLine}>
            <MaterialCommunityIcons name="store-outline" size={13} color={colors.mutedText} />
            <ThemedText numberOfLines={1} style={[styles.restaurantText, { color: colors.text }]}>
              {item.restaurant.name}
            </ThemedText>
          </View>
          <View style={styles.foodMetaRow}>
            <MetaItem icon="map-marker-outline" label={`${formatDistance(item.distanceKm)}`} />
            <MetaItem icon="wallet-outline" label={`人均 ${formatPrice(item.avgPrice)}`} />
            <MetaItem icon="star-outline" label={`${item.rating.toFixed(1)} 分`} />
          </View>
        </Pressable>
      </View>

      <View style={[styles.ingredientLine, { backgroundColor: colors.surfaceMuted }]}>
        <ThemedText style={[styles.ingredientText, { color: colors.text }]}>
          <ThemedText style={styles.ingredientLabel}>食材：</ThemedText>
          {item.ingredients.slice(0, 4).join(' · ')}
        </ThemedText>
      </View>

      <View style={styles.reasonLine}>
        <MaterialCommunityIcons name="fire" size={14} color={CORAL} />
        <ThemedText numberOfLines={2} style={[styles.reasonText, { color: colors.text }]}>
          {item.reasons[0]?.text}
        </ThemedText>
      </View>

      <View style={[styles.feedbackRow, { borderTopColor: colors.line }]}>
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

function MetaItem({ icon, label }: { icon: IconName; label: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.metaItem}>
      <MaterialCommunityIcons name={icon} size={12} color={colors.mutedText} />
      <ThemedText style={[styles.metaItemText, { color: colors.mutedText }]}>{label}</ThemedText>
    </View>
  );
}

function DetailView({
  colors,
  favorite,
  item,
  onBack,
  onFollowUp,
  onOpenRestaurant,
  onToggleFavorite,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  favorite: boolean;
  item: FoodItem;
  onBack: () => void;
  onFollowUp: (action: (typeof FOLLOW_UP_ACTIONS)[number]) => void;
  onOpenRestaurant: () => void;
  onToggleFavorite: () => void;
}) {
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
        <ThemedText numberOfLines={1} style={styles.detailTitle}>{item.name}</ThemedText>
        <Pressable
          accessibilityLabel={favorite ? '取消收藏' : '收藏'}
          accessibilityRole="button"
          onPress={onToggleFavorite}
          style={[styles.backButton, { borderColor: colors.line }]}>
          <MaterialCommunityIcons
            name={favorite ? 'heart' : 'heart-outline'}
            size={18}
            color={favorite ? CORAL : colors.text}
          />
        </Pressable>
      </View>

      <View style={[styles.detailHero, { backgroundColor: colors.surfaceMuted }]}>
        <Image
          contentFit="cover"
          source={{ uri: item.image.url }}
          style={styles.detailHeroImage}
          transition={150}
        />
      <View style={styles.detailHeroTag}>
          <MaterialCommunityIcons name="fire" size={12} color="#ffffff" />
          <ThemedText style={styles.detailHeroTagText}>
            {item.realPOI ? '真实 POI · ' : ''}{item.spiciness} · {item.cuisine}
          </ThemedText>
        </View>
      </View>

      <View style={styles.detailMetaRow}>
        <View style={[styles.scorePill, { backgroundColor: '#eefaf0' }]}>
          <MaterialCommunityIcons name="star" size={13} color={GREEN} />
          <ThemedText style={[styles.scoreText, { color: GREEN }]}>{item.rating.toFixed(1)} 分</ThemedText>
        </View>
        <View style={[styles.pricePill, { backgroundColor: colors.surfaceMuted }]}>
          <ThemedText style={[styles.pricePillText, { color: colors.text }]}>人均 {formatPrice(item.avgPrice)}</ThemedText>
        </View>
        <View style={[styles.spicyPill, { backgroundColor: WARM }]}>
          <ThemedText style={styles.spicyPillText}>{item.spiciness}</ThemedText>
        </View>
      </View>

      <SurfaceCard style={[styles.restaurantCard, { borderColor: colors.line }]}>
        <View style={styles.restaurantHead}>
          <View style={[styles.storeIcon, { backgroundColor: colors.primarySoft }]}>
            <MaterialCommunityIcons name="store-outline" size={15} color={BLUE} />
          </View>
          <View style={styles.restaurantCopy}>
            <ThemedText style={styles.restaurantName}>{item.restaurant.name}</ThemedText>
            <ThemedText numberOfLines={1} style={[styles.restaurantAddress, { color: colors.mutedText }]}>
              {item.restaurant.address}
            </ThemedText>
          </View>
        </View>
        <View style={styles.restaurantFoot}>
          <MetaItem icon="clock-outline" label={item.restaurant.openHours} />
          <MetaItem icon="map-marker-outline" label={formatDistance(item.distanceKm)} />
          <MetaItem icon="calendar-clock-outline" label={item.bestTime} />
        </View>
      </SurfaceCard>

      <ThemedText style={styles.sectionTitle}>这一口</ThemedText>
      <View style={styles.tasteGrid}>
        <View style={[styles.tasteCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={styles.tasteCellTitle}>味型 · {item.flavorProfile.slice(0, 2).join(' / ')}</ThemedText>
          <ThemedText style={[styles.tasteCellText, { color: colors.mutedText }]}>
            {item.spiciness === '不辣' ? '清爽温和，适合不吃辣的人' : '辣味打底，风味有层次'}
          </ThemedText>
        </View>
        <View style={[styles.tasteCell, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <ThemedText style={styles.tasteCellTitle}>口感 · {item.bestTime}</ThemedText>
          <ThemedText style={[styles.tasteCellText, { color: colors.mutedText }]}>
            {item.suitableFor.join('、')}都很合适
          </ThemedText>
        </View>
      </View>

      <ThemedText style={styles.sectionTitle}>主要食材</ThemedText>
      <View style={styles.ingredientChips}>
        {item.ingredients.map((ingredient) => (
          <View
            key={ingredient}
            style={[
              styles.ingredientChip,
              {
                backgroundColor: colors.surfaceMuted,
                borderColor: colors.line,
              },
            ]}>
            <ThemedText style={[styles.ingredientChipText, { color: colors.text }]}>{ingredient}</ThemedText>
          </View>
        ))}
      </View>

      <ThemedText style={styles.sectionTitle}>为什么推荐</ThemedText>
      <View style={styles.whyList}>
        {item.reasons.slice(0, 3).map((reason, index) => (
          <View
            key={`${reason.label}-${reason.text}`}
            style={[styles.whyRow, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <View style={[styles.whyIcon, { backgroundColor: reasonColor(index) }]}>
              <MaterialCommunityIcons name={reasonIcon(index)} size={15} color="#ffffff" />
            </View>
            <View style={styles.whyCopy}>
              <ThemedText style={styles.whyTitle}>{reason.label}</ThemedText>
              <ThemedText style={[styles.whyText, { color: colors.mutedText }]}>{reason.text}</ThemedText>
            </View>
          </View>
        ))}
      </View>

      <ThemedText style={[styles.followLabel, { color: colors.mutedText }]}>还想调整？点一下继续追问</ThemedText>
      <View style={styles.followChips}>
        {FOLLOW_UP_ACTIONS.slice(0, 3).map((action) => (
          <Pressable
            accessibilityRole="button"
            key={action.label}
            onPress={() => onFollowUp(action)}
            style={[styles.followUpChip, { borderColor: colors.line }]}>
            <MaterialCommunityIcons name={action.icon} size={14} color={BLUE} />
            <ThemedText style={[styles.followUpText, { color: colors.text }]}>{action.label}</ThemedText>
          </Pressable>
        ))}
      </View>

      <View style={styles.detailActions}>
        <Pressable
          accessibilityLabel={favorite ? '取消收藏' : '收藏'}
          accessibilityRole="button"
          onPress={onToggleFavorite}
          style={[styles.favoriteButton, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          <MaterialCommunityIcons name={favorite ? 'heart' : 'heart-outline'} size={16} color={favorite ? CORAL : colors.text} />
          <ThemedText style={[styles.favoriteButtonText, { color: colors.text }]}>{favorite ? '已收藏' : '收藏'}</ThemedText>
        </Pressable>
        <Pressable
          accessibilityLabel="去这里"
          accessibilityRole="button"
          onPress={onOpenRestaurant}
          style={[styles.goButton, { backgroundColor: HERO }]}>
          <MaterialCommunityIcons name="navigation-variant-outline" size={17} color={LIME} />
          <ThemedText style={styles.goButtonText}>去这里</ThemedText>
        </Pressable>
      </View>
      <ThemedText style={[styles.disclaimer, { color: colors.mutedText }]}>
        图片、价格与营业时间来自美食库快照，实际以商家页面为准
      </ThemedText>
    </View>
  );
}

function FilterSheet({
  availableFilters,
  colors,
  draft,
  onApply,
  onClose,
  onCuisineToggle,
  onDietaryToggle,
  onDistanceSelect,
  onPriceSelect,
  onReset,
  onScenarioToggle,
  onSpicinessToggle,
  visible,
}: {
  availableFilters: FoodAvailableFilters;
  colors: ReturnType<typeof useAppTheme>['colors'];
  draft: FoodFilter;
  onApply: () => void;
  onClose: () => void;
  onCuisineToggle: (value: string) => void;
  onDietaryToggle: (value: string) => void;
  onDistanceSelect: (option: FoodFilterOption) => void;
  onPriceSelect: (option: FoodFilterOption) => void;
  onReset: () => void;
  onScenarioToggle: (value: string) => void;
  onSpicinessToggle: (value: string) => void;
  visible: boolean;
}) {
  const selectedCount = countActiveFilters(draft);
  const cuisines = CUISINE_OPTIONS.filter((option) => availableFilters.cuisines.includes(option.id));
  const spiciness = SPICINESS_OPTIONS.filter((option) => availableFilters.spiciness.includes(option.id));
  const scenarios = SCENARIO_OPTIONS.filter((option) => availableFilters.scenarios.includes(option.id));
  const dietary = DIETARY_OPTIONS.filter((option) => availableFilters.dietary.includes(option.id));

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
            {cuisines.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="菜系"
                multi
                onToggle={onCuisineToggle}
                options={cuisines}
                selected={draft.cuisines}
              />
            ) : null}
            {spiciness.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="辣度"
                multi
                onToggle={onSpicinessToggle}
                options={spiciness}
                selected={draft.spiciness}
              />
            ) : null}
            {availableFilters.priceRanges.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="人均"
                onToggle={(value) => {
                  const option = availableFilters.priceRanges.find((item) => item.label === value);
                  if (option) onPriceSelect(option);
                }}
                options={availableFilters.priceRanges.map((option) => ({ id: option.label, label: option.label }))}
                selected={draft.priceRange?.label ?? ''}
              />
            ) : null}
            {availableFilters.distanceRanges.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="距离"
                onToggle={(value) => {
                  const option = availableFilters.distanceRanges.find((item) => item.label === value);
                  if (option) onDistanceSelect(option);
                }}
                options={availableFilters.distanceRanges.map((option) => ({ id: option.label, label: option.label }))}
                selected={draft.distanceRange?.label ?? ''}
              />
            ) : null}
            {dietary.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="忌口"
                multi
                onToggle={onDietaryToggle}
                options={dietary}
                selected={draft.dietary}
              />
            ) : null}
            {scenarios.length > 0 ? (
              <FilterGroup
                colors={colors}
                label="场景"
                multi
                onToggle={onScenarioToggle}
                options={scenarios}
                selected={draft.scenarios}
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

function HistoryModal({
  colors,
  items,
  onClose,
  onSelect,
  visible,
}: {
  colors: ReturnType<typeof useAppTheme>['colors'];
  items: FoodHistoryItem[];
  onClose: () => void;
  onSelect: (item: FoodHistoryItem) => void;
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
                <MaterialCommunityIcons name="food" size={30} color={colors.mutedText} />
                <ThemedText style={[styles.emptyHistoryText, { color: colors.mutedText }]}>
                  登录后美食推荐记录会同步到服务端
                </ThemedText>
              </View>
            ) : (
              items.map((item) => (
                <Pressable
                  accessibilityLabel={`加载历史美食推荐：${item.query}`}
                  accessibilityRole="button"
                  key={item.queryId}
                  onPress={() => onSelect(item)}
                  style={[styles.historyRow, { borderTopColor: colors.line }]}>
                  <MaterialCommunityIcons name="food" size={18} color={BLUE} />
                  <View style={styles.historyCopy}>
                    <ThemedText numberOfLines={1} style={styles.historyTitle}>{item.query}</ThemedText>
                    <ThemedText numberOfLines={1} style={[styles.historyMeta, { color: colors.mutedText }]}>
                      {item.city} · {item.district} · {item.dishCount} 道 · {formatHistoryTime(item.createdAt)}
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

function reasonColor(index: number) {
  if (index === 0) return CORAL;
  if (index === 1) return GREEN;
  return BLUE;
}

function reasonIcon(index: number): IconName {
  if (index === 0) return 'fire';
  if (index === 1) return 'map-marker-check-outline';
  return 'check-circle-outline';
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

function emptyAvailableFilters(): FoodAvailableFilters {
  return { cuisines: [], spiciness: [], priceRanges: [], distanceRanges: [], dietary: [], scenarios: [] };
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
  locationCard: {
    alignItems: 'center',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 9,
    padding: 10,
  },
  locationIcon: {
    alignItems: 'center',
    borderRadius: 9,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  locationCopy: {
    flex: 1,
    minWidth: 0,
  },
  locationTitle: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  locationMeta: {
    fontSize: 9.5,
    lineHeight: 14,
    marginTop: 2,
  },
  locationButton: {
    alignItems: 'center',
    borderRadius: 7,
    justifyContent: 'center',
    minHeight: 28,
    paddingHorizontal: 10,
  },
  locationButtonText: {
    fontSize: 10,
    fontWeight: '700',
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
  tasteChip: {
    alignItems: 'center',
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 13,
  },
  tasteChipText: {
    color: '#a34b2a',
    fontSize: 11,
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
  foodCard: {
    borderTopWidth: 3,
    gap: 10,
    padding: 14,
  },
  cardHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 11,
  },
  foodImageWrap: {
    borderRadius: 11,
    flex: 0,
    overflow: 'hidden',
    position: 'relative',
  },
  foodImage: {
    borderRadius: 11,
    height: 104,
    width: 104,
  },
  bestBadge: {
    backgroundColor: 'rgba(232,93,74,0.92)',
    borderRadius: 6,
    bottom: 6,
    left: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    position: 'absolute',
  },
  bestBadgeText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '900',
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
    alignItems: 'center',
    borderRadius: 8,
    flexDirection: 'row',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  scoreText: {
    fontSize: 10,
    fontWeight: '900',
  },
  cardCuisine: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
    marginTop: 3,
  },
  restaurantLine: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 4,
    marginTop: 5,
  },
  restaurantText: {
    flex: 1,
    fontSize: 10.5,
    fontWeight: '700',
    lineHeight: 15,
  },
  foodMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
  },
  metaItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  metaItemText: {
    fontSize: 9.5,
    lineHeight: 14,
  },
  ingredientLine: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  ingredientText: {
    fontSize: 10,
    lineHeight: 16,
  },
  ingredientLabel: {
    color: '#3e475d',
    fontWeight: '900',
  },
  reasonLine: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 6,
  },
  reasonText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
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
  resultsActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  refreshButton: {
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: 12,
  },
  refreshText: {
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
    justifyContent: 'center',
    minHeight: 32,
    paddingHorizontal: 4,
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
  detailHero: {
    borderRadius: 16,
    height: 190,
    overflow: 'hidden',
    position: 'relative',
  },
  detailHeroImage: {
    height: '100%',
    width: '100%',
  },
  detailHeroTag: {
    alignItems: 'center',
    backgroundColor: 'rgba(21,27,59,0.76)',
    borderRadius: 999,
    bottom: 10,
    flexDirection: 'row',
    gap: 4,
    left: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: 'absolute',
  },
  detailHeroTagText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '800',
  },
  detailMetaRow: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pricePill: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 26,
    paddingHorizontal: 9,
  },
  pricePillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  spicyPill: {
    alignItems: 'center',
    borderRadius: 8,
    justifyContent: 'center',
    minHeight: 26,
    paddingHorizontal: 9,
  },
  spicyPillText: {
    color: '#a34b2a',
    fontSize: 10,
    fontWeight: '800',
  },
  restaurantCard: {
    borderWidth: 1,
    gap: 8,
    padding: 12,
  },
  restaurantHead: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  storeIcon: {
    alignItems: 'center',
    borderRadius: 8,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  restaurantCopy: {
    flex: 1,
    minWidth: 0,
  },
  restaurantName: {
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  restaurantAddress: {
    fontSize: 9.5,
    lineHeight: 14,
    marginTop: 2,
  },
  restaurantFoot: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 22,
    marginTop: 2,
  },
  tasteGrid: {
    flexDirection: 'row',
    gap: 8,
  },
  tasteCell: {
    borderRadius: 10,
    borderWidth: 1,
    flex: 1,
    padding: 10,
  },
  tasteCellTitle: {
    color: '#a34b2a',
    fontSize: 11,
    fontWeight: '900',
    lineHeight: 16,
  },
  tasteCellText: {
    fontSize: 9.5,
    lineHeight: 15,
    marginTop: 4,
  },
  ingredientChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  ingredientChip: {
    alignItems: 'center',
    borderRadius: 7,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 27,
    paddingHorizontal: 9,
  },
  ingredientChipText: {
    fontSize: 10,
    fontWeight: '700',
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
    height: 30,
    justifyContent: 'center',
    width: 30,
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
  followLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 2,
  },
  followChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
  },
  detailActions: {
    flexDirection: 'row',
    gap: 8,
  },
  favoriteButton: {
    alignItems: 'center',
    borderRadius: 11,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 108,
    paddingHorizontal: 12,
  },
  favoriteButtonText: {
    fontSize: 12,
    fontWeight: '800',
  },
  goButton: {
    alignItems: 'center',
    borderRadius: 11,
    flex: 1,
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: 14,
  },
  goButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '900',
  },
  disclaimer: {
    fontSize: 9,
    lineHeight: 14,
    textAlign: 'center',
  },
});
