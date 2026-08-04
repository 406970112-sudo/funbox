import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
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
import { getStoredAiFavorites, setStoredAiFavorites } from '@/lib/ai-navigation-favorites';
import {
  AI_CATEGORIES,
  AI_COUNTRIES,
  AI_PRODUCTS,
  filterAiProducts,
  getAiCountry,
  getAiCountryProductCount,
  getAiProductsByCountry,
  type AiCategoryId,
  type AiCountry,
  type AiCountryId,
  type AiProduct,
  type AiProductId,
} from '@/lib/ai-navigation';

type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];
type NavigationMode = 'overview' | 'directory';

const HERO_COLOR = '#151b3b';
const BRAND_BLUE = '#4b6bff';
const LIME = '#c9f36a';
const CORAL = '#ff6b8f';
const INK = '#18233d';
const MUTED = '#7483a2';
const LINE = '#dce5f6';
const PAGE_BACKGROUND = '#eef4ff';
const SURFACE = '#ffffff';
const SURFACE_MUTED = '#f2f6fd';
const PRIMARY_SOFT = '#e6ebff';
const SUCCESS = '#1db991';
const TAB_INACTIVE = '#8f9bbb';

export function AiNavigationScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<NavigationMode>('overview');
  const [selectedCountryId, setSelectedCountryId] = useState<AiCountryId>('cn');
  const [selectedCategoryId, setSelectedCategoryId] = useState<AiCategoryId>('all');
  const [query, setQuery] = useState('');
  const [favoriteIds, setFavoriteIds] = useState<AiProductId[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [openingProductId, setOpeningProductId] = useState<AiProductId | null>(null);
  const [feedback, setFeedback] = useState('');
  const favoritesReturnMode = useRef<NavigationMode>('overview');
  const deferredQuery = useDeferredValue(query);
  const selectedCountry = getAiCountry(selectedCountryId) ?? AI_COUNTRIES[0];
  const filteredProducts = filterAiProducts({
    categoryId: selectedCategoryId,
    countryId: favoritesOnly ? undefined : selectedCountryId,
    favoriteIds,
    favoritesOnly,
    query: deferredQuery,
  });
  const favoriteIdSet = new Set(favoriteIds);
  const showFeaturedProduct =
    !favoritesOnly &&
    selectedCountryId === 'us' &&
    selectedCategoryId === 'all' &&
    !deferredQuery.trim();
  const featuredProduct = showFeaturedProduct
    ? filteredProducts.find((product) => product.featured)
    : undefined;
  const listedProducts = featuredProduct
    ? filteredProducts.filter((product) => product.id !== featuredProduct.id)
    : filteredProducts;

  useEffect(() => {
    let cancelled = false;

    void getStoredAiFavorites().then((storedFavoriteIds) => {
      if (!cancelled) setFavoriteIds(storedFavoriteIds);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  function goBack() {
    if (favoritesOnly) {
      setFavoritesOnly(false);
      setFeedback('');
      startTransition(() => setMode(favoritesReturnMode.current));
      return;
    }

    if (mode === 'directory') {
      setQuery('');
      setSelectedCategoryId('all');
      setFeedback('');
      startTransition(() => setMode('overview'));
      return;
    }

    router.back();
  }

  function openCountry(countryId: AiCountryId) {
    setSelectedCountryId(countryId);
    setSelectedCategoryId('all');
    setFavoritesOnly(false);
    setQuery('');
    setFeedback('');
    startTransition(() => setMode('directory'));
  }

  function searchFromOverview() {
    if (!query.trim()) {
      setFeedback('输入产品名或公司后再搜索。');
      return;
    }

    setSelectedCategoryId('all');
    setFavoritesOnly(false);
    setFeedback('');
    startTransition(() => setMode('directory'));
  }

  function showFavorites() {
    if (favoritesOnly) {
      setFavoritesOnly(false);
      setFeedback('');
      startTransition(() => setMode(favoritesReturnMode.current));
      return;
    }

    favoritesReturnMode.current = mode;
    setFavoritesOnly(true);
    setSelectedCategoryId('all');
    setQuery('');
    setFeedback('');
    startTransition(() => setMode('directory'));
  }

  function toggleFavorite(productId: AiProductId) {
    const saved = favoriteIdSet.has(productId);
    const nextFavoriteIds = saved
      ? favoriteIds.filter((favoriteId) => favoriteId !== productId)
      : [...favoriteIds, productId];

    setFavoriteIds(nextFavoriteIds);
    setFeedback(saved ? '已取消收藏。' : '已加入收藏。');
    void setStoredAiFavorites(nextFavoriteIds).catch(() => {
      setFeedback('收藏已更新，但暂时无法保存到本机。');
    });
  }

  async function openProduct(product: AiProduct) {
    if (openingProductId) return;

    setOpeningProductId(product.id);
    setFeedback('');

    try {
      await Linking.openURL(product.url);
    } catch {
      setFeedback(`无法打开 ${product.name}，请稍后重试。`);
    } finally {
      setOpeningProductId(null);
    }
  }

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: PAGE_BACKGROUND }]}>
      <StatusBar style="dark" />
      <View style={[styles.screenShell, { backgroundColor: PAGE_BACKGROUND }]}>
        <AiNavigationTopBar
          favoritesOnly={favoritesOnly}
          mode={mode}
          onBack={goBack}
          onFavorites={showFavorites}
          selectedCountry={selectedCountry}
        />

        <View style={styles.body}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {mode === 'overview' ? (
              <NavigationOverview
                feedback={feedback}
                favoriteIdSet={favoriteIdSet}
                onOpenCountry={openCountry}
                onOpenProduct={(product) => void openProduct(product)}
                onQueryChange={(value) => {
                  setQuery(value);
                  setFeedback('');
                }}
                onSearch={searchFromOverview}
                openingProductId={openingProductId}
                query={query}
              />
            ) : (
              <AiDirectory
                favoriteIdSet={favoriteIdSet}
                favoritesOnly={favoritesOnly}
                featuredProduct={featuredProduct}
                feedback={feedback}
                listedProducts={listedProducts}
                onCategoryChange={(categoryId) => {
                  setFeedback('');
                  startTransition(() => setSelectedCategoryId(categoryId));
                }}
                onCountryChange={openCountry}
                onOpenProduct={(product) => void openProduct(product)}
                onQueryChange={(value) => {
                  setQuery(value);
                  setFeedback('');
                }}
                onResetFilters={() => {
                  setQuery('');
                  setSelectedCategoryId('all');
                  setFeedback('');
                }}
                onToggleFavorite={toggleFavorite}
                openingProductId={openingProductId}
                query={query}
                resultCount={filteredProducts.length}
                selectedCategoryId={selectedCategoryId}
                selectedCountry={selectedCountry}
              />
            )}
          </ScrollView>
        </View>

        <ToolBottomNavigation />
      </View>
    </SafeAreaView>
  );
}

type AiNavigationTopBarProps = {
  favoritesOnly: boolean;
  mode: NavigationMode;
  onBack: () => void;
  onFavorites: () => void;
  selectedCountry: AiCountry;
};

function AiNavigationTopBar({
  favoritesOnly,
  mode,
  onBack,
  onFavorites,
  selectedCountry,
}: AiNavigationTopBarProps) {
  const title = favoritesOnly ? '我的收藏' : mode === 'overview' ? 'AI 导航' : `${selectedCountry.name} AI`;

  return (
    <View style={[styles.topBar, { backgroundColor: SURFACE, borderBottomColor: LINE }]}>
      <Pressable
        accessibilityLabel="返回"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.topBarSide, pressed && styles.pressed]}>
        <MaterialCommunityIcons name="arrow-left" size={22} color={INK} />
      </Pressable>
      <ThemedText style={styles.topBarTitle}>{title}</ThemedText>
      <Pressable
        accessibilityLabel={favoritesOnly ? '退出我的收藏' : '查看我的收藏'}
        accessibilityRole="button"
        accessibilityState={{ selected: favoritesOnly }}
        hitSlop={6}
        onPress={onFavorites}
        style={({ pressed }) => [
          styles.topBarAction,
          {
            backgroundColor: favoritesOnly ? PRIMARY_SOFT : SURFACE_MUTED,
            borderColor: favoritesOnly ? BRAND_BLUE : LINE,
          },
          pressed && styles.pressed,
        ]}
        testID="ai-navigation-favorites-button">
        <MaterialCommunityIcons
          name={favoritesOnly ? 'bookmark' : 'bookmark-outline'}
          size={19}
          color={favoritesOnly ? BRAND_BLUE : INK}
        />
      </Pressable>
    </View>
  );
}

type NavigationOverviewProps = {
  favoriteIdSet: Set<AiProductId>;
  feedback: string;
  onOpenCountry: (countryId: AiCountryId) => void;
  onOpenProduct: (product: AiProduct) => void;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  openingProductId: AiProductId | null;
  query: string;
};

function NavigationOverview({
  favoriteIdSet,
  feedback,
  onOpenCountry,
  onOpenProduct,
  onQueryChange,
  onSearch,
  openingProductId,
  query,
}: NavigationOverviewProps) {
  const quickProducts = getAiProductsByCountry('cn').slice(0, 2);

  return (
    <>
      <View style={styles.hero}>
        <View style={styles.heroTextureTop} />
        <View style={styles.heroTextureBottom} />
        <View style={styles.heroMeta}>
          <MaterialCommunityIcons name="orbit" size={18} color={LIME} />
          <ThemedText style={styles.heroMetaText}>全球 AI，一处直达</ThemedText>
        </View>
        <ThemedText style={styles.heroTitle}>按国家找到{`\n`}你需要的 AI</ThemedText>
        <View style={styles.heroSearch}>
          <MaterialCommunityIcons name="magnify" size={20} color={MUTED} />
          <TextInput
            accessibilityLabel="搜索 AI 产品"
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={onQueryChange}
            onSubmitEditing={onSearch}
            placeholder="搜索产品名或公司"
            placeholderTextColor={MUTED}
            returnKeyType="search"
            style={styles.heroInput}
            testID="ai-navigation-hero-search-input"
            value={query}
          />
          <Pressable
            accessibilityLabel="搜索"
            accessibilityRole="button"
            onPress={onSearch}
            style={({ pressed }) => [styles.heroSearchButton, pressed && styles.pressed]}
            testID="ai-navigation-hero-search-button">
            <MaterialCommunityIcons name="arrow-right" size={21} color={HERO_COLOR} />
          </Pressable>
        </View>
        {feedback ? <ThemedText style={styles.heroFeedback}>{feedback}</ThemedText> : null}
      </View>

      <SectionHeader meta={`${AI_PRODUCTS.length} 个官方入口`} title="选择国家" />
      <View style={[styles.countryRail, { backgroundColor: SURFACE, borderColor: LINE }]}>
        {AI_COUNTRIES.map((country, index) => (
          <CountryRailItem
            country={country}
            first={index === 0}
            key={country.id}
            onPress={() => onOpenCountry(country.id)}
            selected={country.id === 'cn'}
          />
        ))}
      </View>

      <SectionHeader
        actionLabel="查看全部"
        onAction={() => onOpenCountry('cn')}
        title="中国 · 常用 AI"
      />
      <View style={[styles.productList, { backgroundColor: SURFACE, borderColor: LINE }]}>
        {quickProducts.map((product, index) => (
          <QuickProductRow
            favorite={favoriteIdSet.has(product.id)}
            key={product.id}
            onPress={() => onOpenProduct(product)}
            opening={openingProductId === product.id}
            product={product}
            separated={index > 0}
          />
        ))}
      </View>
    </>
  );
}

function SectionHeader({
  actionLabel,
  meta,
  onAction,
  title,
}: {
  actionLabel?: string;
  meta?: string;
  onAction?: () => void;
  title: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
      {onAction && actionLabel ? (
        <Pressable accessibilityRole="button" hitSlop={8} onPress={onAction}>
          <ThemedText style={[styles.sectionAction, { color: MUTED }]}>{actionLabel}</ThemedText>
        </Pressable>
      ) : (
        <ThemedText style={[styles.sectionMeta, { color: MUTED }]}>{meta}</ThemedText>
      )}
    </View>
  );
}

function CountryRailItem({
  country,
  first,
  onPress,
  selected,
}: {
  country: AiCountry;
  first: boolean;
  onPress: () => void;
  selected: boolean;
}) {
  return (
    <Pressable
      accessibilityLabel={`查看${country.name} AI`}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.countryRailItem,
        !first ? { borderLeftColor: LINE, borderLeftWidth: 1 } : undefined,
        selected ? { backgroundColor: PRIMARY_SOFT } : undefined,
        pressed && styles.pressed,
      ]}
      testID={`ai-country-card-${country.id}`}>
      <View style={[styles.countryCode, { backgroundColor: country.softColor }]}>
        <ThemedText style={[styles.countryCodeText, { color: country.accentColor }]}>
          {country.code}
        </ThemedText>
      </View>
      <View style={styles.countryLabelRow}>
        <ThemedText style={[styles.countryName, selected ? { color: BRAND_BLUE } : undefined]}>
          {country.name}
        </ThemedText>
        <ThemedText style={[styles.countryCount, { color: MUTED }]}>
          {getAiCountryProductCount(country.id)}
        </ThemedText>
      </View>
      {selected ? <View style={styles.countrySelectedLine} /> : null}
    </Pressable>
  );
}

type AiDirectoryProps = {
  favoriteIdSet: Set<AiProductId>;
  favoritesOnly: boolean;
  featuredProduct?: AiProduct;
  feedback: string;
  listedProducts: readonly AiProduct[];
  onCategoryChange: (categoryId: AiCategoryId) => void;
  onCountryChange: (countryId: AiCountryId) => void;
  onOpenProduct: (product: AiProduct) => void;
  onQueryChange: (value: string) => void;
  onResetFilters: () => void;
  onToggleFavorite: (productId: AiProductId) => void;
  openingProductId: AiProductId | null;
  query: string;
  resultCount: number;
  selectedCategoryId: AiCategoryId;
  selectedCountry: AiCountry;
};

function AiDirectory({
  favoriteIdSet,
  favoritesOnly,
  featuredProduct,
  feedback,
  listedProducts,
  onCategoryChange,
  onCountryChange,
  onOpenProduct,
  onQueryChange,
  onResetFilters,
  onToggleFavorite,
  openingProductId,
  query,
  resultCount,
  selectedCategoryId,
  selectedCountry,
}: AiDirectoryProps) {
  const listTitle = favoritesOnly
    ? '我的收藏'
    : featuredProduct
      ? `更多${selectedCountry.name} AI`
      : `${resultCount} 个产品`;
  const listMeta = favoritesOnly
    ? `${resultCount} 个入口`
    : featuredProduct
      ? '官方入口'
      : '按常用程度排序';

  return (
    <>
      <View style={[styles.directorySearch, { backgroundColor: SURFACE, borderColor: LINE }]}>
        <MaterialCommunityIcons name="magnify" size={19} color={BRAND_BLUE} />
        <TextInput
          accessibilityLabel={favoritesOnly ? '搜索收藏' : `搜索${selectedCountry.name} AI 产品`}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onQueryChange}
          placeholder={favoritesOnly ? '搜索收藏' : `搜索${selectedCountry.name} AI 产品`}
          placeholderTextColor={MUTED}
          returnKeyType="search"
          style={[styles.directoryInput, { color: INK }]}
          testID="ai-navigation-directory-search-input"
          value={query}
        />
        <Pressable
          accessibilityLabel="重置筛选"
          accessibilityRole="button"
          onPress={onResetFilters}
          style={[styles.filterButton, { backgroundColor: SURFACE_MUTED }]}
          testID="ai-navigation-reset-filters">
          <MaterialCommunityIcons name="tune-variant" size={16} color={MUTED} />
        </Pressable>
      </View>

      {!favoritesOnly ? (
        <ScrollView
          contentContainerStyle={styles.countryChips}
          horizontal
          showsHorizontalScrollIndicator={false}>
          {AI_COUNTRIES.map((country) => (
            <Pressable
              accessibilityLabel={`切换到${country.name}`}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedCountry.id === country.id }}
              key={country.id}
              onPress={() => onCountryChange(country.id)}
              style={({ pressed }) => [
                styles.countryChip,
                {
                  backgroundColor:
                    selectedCountry.id === country.id ? HERO_COLOR : SURFACE,
                  borderColor: selectedCountry.id === country.id ? HERO_COLOR : LINE,
                },
                pressed && styles.pressed,
              ]}
              testID={`ai-country-chip-${country.id}`}>
              <View style={[styles.chipDot, { backgroundColor: country.accentColor }]} />
              <ThemedText
                style={[
                  styles.countryChipText,
                  { color: selectedCountry.id === country.id ? '#ffffff' : MUTED },
                ]}>
                {country.name}
              </ThemedText>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.categoryTabs}
        horizontal
        showsHorizontalScrollIndicator={false}>
        {AI_CATEGORIES.map((category) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: selectedCategoryId === category.id }}
            key={category.id}
            onPress={() => onCategoryChange(category.id)}
            style={styles.categoryTab}
            testID={`ai-category-${category.id}`}>
            <ThemedText
              style={[
                styles.categoryTabText,
                { color: selectedCategoryId === category.id ? INK : MUTED },
              ]}>
              {category.label}
            </ThemedText>
            {selectedCategoryId === category.id ? <View style={styles.categorySelectedLine} /> : null}
          </Pressable>
        ))}
      </ScrollView>

      {!favoritesOnly && selectedCountry.id !== 'cn' ? (
        <CountrySummary country={selectedCountry} />
      ) : null}

      {featuredProduct ? (
        <FeaturedProduct
          onOpen={() => onOpenProduct(featuredProduct)}
          opening={openingProductId === featuredProduct.id}
          product={featuredProduct}
        />
      ) : null}

      <SectionHeader meta={listMeta} title={listTitle} />
      {listedProducts.length ? (
        <View style={[styles.productList, { backgroundColor: SURFACE, borderColor: LINE }]}>
          {listedProducts.map((product, index) => (
            <ProductRow
              favorite={favoriteIdSet.has(product.id)}
              favoritesOnly={favoritesOnly}
              key={product.id}
              onOpen={() => onOpenProduct(product)}
              onToggleFavorite={() => onToggleFavorite(product.id)}
              opening={openingProductId === product.id}
              product={product}
              separated={index > 0}
            />
          ))}
        </View>
      ) : (
        <EmptyDirectory favoritesOnly={favoritesOnly} query={query} />
      )}

      {feedback ? <FeedbackLine message={feedback} /> : null}
      <View style={styles.legalNote}>
        <MaterialCommunityIcons name="shield-check-outline" size={15} color={MUTED} />
        <ThemedText style={[styles.legalText, { color: MUTED }]}>
          仅聚合官方网站入口，服务内容与账号规则以对应平台为准。
        </ThemedText>
      </View>
      {!favoritesOnly && selectedCountry.id !== 'cn' ? (
        <View style={styles.regionNote}>
          <MaterialCommunityIcons name="information-outline" size={15} color={SUCCESS} />
          <ThemedText style={[styles.regionNoteText, { color: MUTED }]}>
            部分海外服务可能受地区、网络与账号政策影响。
          </ThemedText>
        </View>
      ) : null}
    </>
  );
}

function CountrySummary({ country }: { country: AiCountry }) {
  return (
    <View style={styles.countrySummary}>
      <View style={styles.countrySummaryCopy}>
        <View style={[styles.countrySummaryCode, { backgroundColor: country.softColor }]}>
          <ThemedText style={[styles.countrySummaryCodeText, { color: country.accentColor }]}>
            {country.code}
          </ThemedText>
        </View>
        <View>
          <ThemedText style={styles.countrySummaryTitle}>{country.name} AI</ThemedText>
          <ThemedText style={[styles.countrySummaryDescription, { color: MUTED }]}>
            {country.description}
          </ThemedText>
        </View>
      </View>
      <ThemedText style={[styles.countrySummaryCount, { color: MUTED }]}>
        {getAiCountryProductCount(country.id)} 个入口
      </ThemedText>
    </View>
  );
}

function FeaturedProduct({
  onOpen,
  opening,
  product,
}: {
  onOpen: () => void;
  opening: boolean;
  product: AiProduct;
}) {
  return (
    <View style={styles.featuredProduct}>
      <View style={styles.featuredTexture} />
      <ProductLogo product={product} size="large" />
      <View style={styles.featuredCopy}>
        <ThemedText style={styles.featuredTitle}>{product.name}</ThemedText>
        <ThemedText numberOfLines={1} style={styles.featuredMeta}>
          {product.company} · {product.description}
        </ThemedText>
      </View>
      <Pressable
        accessibilityLabel={`打开${product.name}`}
        accessibilityRole="link"
        disabled={opening}
        onPress={onOpen}
        style={({ pressed }) => [styles.featuredAction, pressed && styles.pressed]}
        testID={`ai-entry-${product.id}`}>
        {opening ? (
          <ActivityIndicator color={HERO_COLOR} size="small" />
        ) : (
          <MaterialCommunityIcons name="arrow-top-right" size={21} color={HERO_COLOR} />
        )}
      </Pressable>
    </View>
  );
}

function ProductRow({
  favorite,
  favoritesOnly,
  onOpen,
  onToggleFavorite,
  opening,
  product,
  separated,
}: {
  favorite: boolean;
  favoritesOnly: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  opening: boolean;
  product: AiProduct;
  separated: boolean;
}) {
  const country = getAiCountry(product.countryId);

  return (
    <View
      style={[
        styles.productRow,
        separated ? { borderTopColor: LINE, borderTopWidth: 1 } : undefined,
      ]}>
      <Pressable
        accessibilityHint="打开官方网站"
        accessibilityLabel={`${product.name}，${product.domain}`}
        accessibilityRole="link"
        disabled={opening}
        onPress={onOpen}
        style={({ pressed }) => [styles.productMainAction, pressed && styles.pressed]}
        testID={`ai-entry-${product.id}`}>
        <ProductLogo product={product} />
        <View style={styles.productCopy}>
          <View style={styles.productNameRow}>
            <ThemedText numberOfLines={1} style={styles.productName}>
              {product.name}
            </ThemedText>
            <ThemedText style={[styles.officialLabel, { color: SUCCESS }]}>官方</ThemedText>
          </View>
          <ThemedText numberOfLines={1} style={[styles.productMeta, { color: MUTED }]}>
            {favoritesOnly && country ? `${country.name} · ` : ''}
            {product.company} · {product.description}
          </ThemedText>
        </View>
      </Pressable>
      <Pressable
        accessibilityLabel={favorite ? `取消收藏${product.name}` : `收藏${product.name}`}
        accessibilityRole="button"
        accessibilityState={{ selected: favorite }}
        hitSlop={6}
        onPress={onToggleFavorite}
        style={({ pressed }) => [styles.favoriteButton, pressed && styles.pressed]}
        testID={`ai-favorite-${product.id}`}>
        {opening ? (
          <ActivityIndicator color={BRAND_BLUE} size="small" />
        ) : (
          <MaterialCommunityIcons
            name={favorite ? 'bookmark' : 'bookmark-outline'}
            size={19}
            color={favorite ? BRAND_BLUE : MUTED}
          />
        )}
      </Pressable>
    </View>
  );
}

function QuickProductRow({
  favorite,
  onPress,
  opening,
  product,
  separated,
}: {
  favorite: boolean;
  onPress: () => void;
  opening: boolean;
  product: AiProduct;
  separated: boolean;
}) {
  return (
    <Pressable
      accessibilityHint="打开官方网站"
      accessibilityLabel={`${product.name}，${product.domain}`}
      accessibilityRole="link"
      disabled={opening}
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickProductRow,
        separated ? { borderTopColor: LINE, borderTopWidth: 1 } : undefined,
        pressed && styles.pressed,
      ]}
      testID={`ai-entry-${product.id}`}>
      <ProductLogo favorite={favorite} product={product} />
      <View style={styles.productCopy}>
        <View style={styles.productNameRow}>
          <ThemedText style={styles.productName}>{product.name}</ThemedText>
          <ThemedText style={[styles.officialLabel, { color: SUCCESS }]}>官方入口</ThemedText>
        </View>
        <ThemedText numberOfLines={1} style={[styles.productMeta, { color: MUTED }]}>
          {product.company} · {product.description}
        </ThemedText>
      </View>
      {opening ? (
        <ActivityIndicator color={BRAND_BLUE} size="small" />
      ) : (
        <MaterialCommunityIcons name="arrow-top-right" size={18} color={MUTED} />
      )}
    </Pressable>
  );
}

function ProductLogo({
  favorite = false,
  product,
  size = 'regular',
}: {
  favorite?: boolean;
  product: AiProduct;
  size?: 'large' | 'regular';
}) {
  return (
    <View
      style={[
        styles.productLogo,
        size === 'large' ? styles.productLogoLarge : undefined,
        { backgroundColor: product.logoBackground },
      ]}>
      <ThemedText
        style={[
          styles.productLogoText,
          size === 'large' ? styles.productLogoTextLarge : undefined,
          { color: product.logoColor },
        ]}>
        {product.logo}
      </ThemedText>
      {product.featured && size === 'regular' ? <View style={styles.featuredDot} /> : null}
      {favorite && !product.featured ? <View style={styles.savedDot} /> : null}
    </View>
  );
}

function EmptyDirectory({ favoritesOnly, query }: { favoritesOnly: boolean; query: string }) {
  return (
    <View style={styles.emptyDirectory}>
      <MaterialCommunityIcons
        name={favoritesOnly ? 'bookmark-outline' : 'magnify'}
        size={28}
        color={MUTED}
      />
      <ThemedText style={styles.emptyTitle}>
        {favoritesOnly ? '还没有收藏' : '没有匹配的 AI 产品'}
      </ThemedText>
      <ThemedText style={[styles.emptyDescription, { color: MUTED }]}>
        {favoritesOnly
          ? '在产品右侧点按收藏图标，常用入口会集中显示在这里。'
          : query
            ? '换一个产品名、公司或能力关键词试试。'
            : '调整国家或能力分类后再查看。'}
      </ThemedText>
    </View>
  );
}

function FeedbackLine({ message }: { message: string }) {
  return (
    <View style={styles.feedbackLine}>
      <MaterialCommunityIcons name="information-outline" size={16} color={BRAND_BLUE} />
      <ThemedText style={[styles.feedbackText, { color: MUTED }]}>{message}</ThemedText>
    </View>
  );
}

function ToolBottomNavigation() {
  const router = useRouter();
  const items: { icon: IconName; label: string; onPress: () => void; selected?: boolean }[] = [
    { icon: 'home-outline', label: '首页', onPress: () => router.replace('/') },
    { icon: 'message-outline', label: '消息', onPress: () => router.replace('/messages') },
    { icon: 'account-circle-outline', label: '我的', onPress: () => router.replace('/profile') },
  ];

  return (
    <View style={[styles.bottomNav, { backgroundColor: SURFACE, borderTopColor: LINE }]}>
      {items.map((item) => {
        const color = item.selected ? BRAND_BLUE : TAB_INACTIVE;

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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  screenShell: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: appLayout.screenMaxWidth,
    overflow: 'hidden',
    width: '100%',
  },
  topBar: {
    alignItems: 'center',
    borderBottomWidth: 1,
    flexDirection: 'row',
    height: 64,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  topBarSide: {
    alignItems: 'flex-start',
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  topBarTitle: {
    color: INK,
    fontSize: 17,
    fontWeight: '900',
    lineHeight: 23,
  },
  topBarAction: {
    alignItems: 'center',
    borderRadius: 13,
    borderWidth: 1,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  scrollContent: {
    paddingBottom: 28,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  hero: {
    backgroundColor: HERO_COLOR,
    borderRadius: 24,
    minHeight: 220,
    overflow: 'hidden',
    padding: 22,
    position: 'relative',
  },
  heroTextureTop: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    borderWidth: 1,
    height: 112,
    position: 'absolute',
    right: -44,
    top: -30,
    transform: [{ rotate: '-17deg' }],
    width: 220,
  },
  heroTextureBottom: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 18,
    borderWidth: 1,
    height: 112,
    position: 'absolute',
    right: -78,
    top: 96,
    transform: [{ rotate: '-17deg' }],
    width: 220,
  },
  heroMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  heroMetaText: {
    color: LIME,
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 17,
  },
  heroTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    lineHeight: 36,
    marginBottom: 17,
    marginTop: 15,
  },
  heroSearch: {
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: 15,
    flexDirection: 'row',
    gap: 9,
    height: 54,
    paddingLeft: 14,
    paddingRight: 8,
  },
  heroInput: {
    color: '#18233d',
    flex: 1,
    fontSize: 13,
    height: 50,
    minWidth: 0,
    padding: 0,
  },
  heroSearchButton: {
    alignItems: 'center',
    backgroundColor: LIME,
    borderRadius: 12,
    height: 38,
    justifyContent: 'center',
    width: 38,
  },
  heroFeedback: {
    color: CORAL,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    marginTop: 8,
  },
  sectionHeader: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 11,
    marginTop: 19,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    color: INK,
    fontSize: 18,
    fontWeight: '900',
    lineHeight: 24,
  },
  sectionMeta: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 16,
  },
  sectionAction: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
  },
  countryRail: {
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  countryRailItem: {
    alignItems: 'center',
    flex: 1,
    gap: 6,
    height: 86,
    justifyContent: 'center',
    minWidth: 0,
    position: 'relative',
  },
  countryCode: {
    alignItems: 'center',
    borderRadius: 11,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  countryCodeText: {
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14,
  },
  countryLabelRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  countryName: {
    color: INK,
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14,
  },
  countryCount: {
    fontSize: 8,
    fontWeight: '700',
    lineHeight: 12,
  },
  countrySelectedLine: {
    backgroundColor: BRAND_BLUE,
    bottom: 0,
    height: 3,
    left: 18,
    position: 'absolute',
    right: 18,
  },
  productList: {
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
  },
  quickProductRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    minHeight: 69,
    paddingHorizontal: 13,
    paddingVertical: 11,
  },
  directorySearch: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 10,
    height: 52,
    paddingHorizontal: 10,
  },
  directoryInput: {
    flex: 1,
    fontSize: 13,
    height: 48,
    minWidth: 0,
    padding: 0,
  },
  filterButton: {
    alignItems: 'center',
    borderRadius: 10,
    height: 32,
    justifyContent: 'center',
    width: 32,
  },
  countryChips: {
    gap: 7,
    paddingTop: 11,
  },
  countryChip: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 5,
    height: 34,
    justifyContent: 'center',
    minWidth: 76,
    paddingHorizontal: 10,
  },
  chipDot: {
    borderRadius: 3,
    height: 6,
    width: 6,
  },
  countryChipText: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
  },
  categoryTabs: {
    gap: 17,
    paddingTop: 16,
  },
  categoryTab: {
    paddingBottom: 8,
    position: 'relative',
  },
  categoryTabText: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 15,
  },
  categorySelectedLine: {
    backgroundColor: LIME,
    bottom: 0,
    height: 3,
    left: 0,
    position: 'absolute',
    right: 0,
  },
  countrySummary: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 17,
    paddingHorizontal: 2,
  },
  countrySummaryCopy: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 9,
  },
  countrySummaryCode: {
    alignItems: 'center',
    borderRadius: 10,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  countrySummaryCodeText: {
    fontSize: 9,
    fontWeight: '900',
    lineHeight: 13,
  },
  countrySummaryTitle: {
    color: INK,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  countrySummaryDescription: {
    fontSize: 9,
    lineHeight: 14,
  },
  countrySummaryCount: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 15,
  },
  featuredProduct: {
    alignItems: 'center',
    backgroundColor: HERO_COLOR,
    borderRadius: 20,
    flexDirection: 'row',
    gap: 12,
    marginTop: 14,
    minHeight: 96,
    overflow: 'hidden',
    padding: 17,
    position: 'relative',
  },
  featuredTexture: {
    borderColor: 'rgba(255,255,255,0.12)',
    borderRadius: 16,
    borderWidth: 1,
    height: 90,
    position: 'absolute',
    right: -42,
    top: -28,
    transform: [{ rotate: '-16deg' }],
    width: 145,
  },
  featuredCopy: {
    flex: 1,
    minWidth: 0,
  },
  featuredTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 20,
  },
  featuredMeta: {
    color: '#aebbd0',
    fontSize: 9,
    lineHeight: 14,
    marginTop: 3,
  },
  featuredAction: {
    alignItems: 'center',
    backgroundColor: LIME,
    borderRadius: 12,
    height: 40,
    justifyContent: 'center',
    width: 40,
  },
  productRow: {
    alignItems: 'center',
    flexDirection: 'row',
    minHeight: 70,
    paddingLeft: 12,
    paddingRight: 8,
  },
  productMainAction: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: 12,
    minHeight: 69,
    minWidth: 0,
    paddingVertical: 10,
  },
  productLogo: {
    alignItems: 'center',
    borderRadius: 13,
    height: 43,
    justifyContent: 'center',
    position: 'relative',
    width: 43,
  },
  productLogoLarge: {
    borderRadius: 15,
    height: 54,
    width: 54,
  },
  productLogoText: {
    fontSize: 10,
    fontWeight: '900',
    lineHeight: 14,
  },
  productLogoTextLarge: {
    fontSize: 11,
    lineHeight: 15,
  },
  featuredDot: {
    backgroundColor: CORAL,
    borderColor: '#ffffff',
    borderRadius: 6,
    borderWidth: 2,
    height: 11,
    position: 'absolute',
    right: -2,
    top: -2,
    width: 11,
  },
  savedDot: {
    backgroundColor: BRAND_BLUE,
    borderColor: '#ffffff',
    borderRadius: 5,
    borderWidth: 2,
    height: 9,
    position: 'absolute',
    right: -1,
    top: -1,
    width: 9,
  },
  productCopy: {
    flex: 1,
    minWidth: 0,
  },
  productNameRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
    minWidth: 0,
  },
  productName: {
    color: INK,
    flexShrink: 1,
    fontSize: 13,
    fontWeight: '900',
    lineHeight: 18,
  },
  officialLabel: {
    fontSize: 8,
    fontWeight: '900',
    lineHeight: 12,
  },
  productMeta: {
    fontSize: 9,
    fontWeight: '600',
    lineHeight: 14,
    marginTop: 2,
  },
  favoriteButton: {
    alignItems: 'center',
    height: 42,
    justifyContent: 'center',
    width: 38,
  },
  emptyDirectory: {
    alignItems: 'center',
    minHeight: 190,
    paddingHorizontal: 28,
    paddingTop: 35,
  },
  emptyTitle: {
    color: INK,
    fontSize: 16,
    fontWeight: '900',
    lineHeight: 22,
    marginTop: 10,
  },
  emptyDescription: {
    fontSize: 11,
    lineHeight: 18,
    marginTop: 5,
    textAlign: 'center',
  },
  feedbackLine: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    marginTop: 11,
    paddingHorizontal: 3,
  },
  feedbackText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 17,
  },
  legalNote: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 7,
    marginTop: 14,
    paddingHorizontal: 4,
  },
  legalText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 15,
  },
  regionNote: {
    alignItems: 'flex-start',
    backgroundColor: '#edf5ed',
    borderLeftColor: '#1db991',
    borderLeftWidth: 3,
    flexDirection: 'row',
    gap: 7,
    marginTop: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  regionNoteText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 15,
  },
  bottomNav: {
    borderTopWidth: 1,
    flexDirection: 'row',
    height: 72,
    paddingBottom: 8,
    paddingTop: 8,
  },
  bottomNavItem: {
    alignItems: 'center',
    flex: 1,
    gap: 3,
    justifyContent: 'center',
  },
  bottomNavLabel: {
    fontSize: 10,
    fontWeight: '800',
    lineHeight: 14,
  },
  pressed: {
    opacity: 0.72,
  },
});
