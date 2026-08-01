import type {
  FilterOption,
  PlatformLink,
  ProductRecommendationRequest,
  RecommendationCategory,
  RecommendationItem,
  RecommendationPlatform,
} from '@/types/product-recommendation';

export const CATEGORY_OPTIONS: { id: RecommendationCategory | ''; label: string }[] = [
  { id: '', label: '不限' },
  { id: 'phone', label: '手机' },
  { id: 'tablet', label: '平板' },
  { id: 'earbuds', label: '耳机' },
  { id: 'tv', label: '电视' },
  { id: 'small-appliance', label: '小家电' },
  { id: 'accessory', label: '数码配件' },
];

export const SCENARIO_OPTIONS = [
  { id: '游戏', label: '游戏' },
  { id: '影像', label: '拍照' },
  { id: '续航', label: '续航' },
  { id: '办公', label: '办公' },
  { id: '轻便', label: '轻便' },
  { id: '画质', label: '画质' },
];

export const BRAND_OPTIONS = [
  { id: '小米', label: '小米' },
  { id: '华为', label: '华为' },
  { id: '苹果', label: '苹果' },
  { id: 'OPPO', label: 'OPPO' },
  { id: 'vivo', label: 'vivo' },
  { id: '荣耀', label: '荣耀' },
  { id: '一加', label: '一加' },
];

export const PLATFORM_OPTIONS: { id: RecommendationPlatform; label: string }[] = [
  { id: 'jd', label: '京东' },
  { id: 'taobao', label: '淘宝' },
  { id: 'pdd', label: '拼多多' },
];

export function formatPrice(price: number) {
  return `¥${price.toLocaleString('zh-CN')}`;
}

export function getPlatformLabel(platform: RecommendationPlatform) {
  return PLATFORM_OPTIONS.find((option) => option.id === platform)?.label ?? platform;
}

export function formatPriceSource(source: string) {
  const date = source.split(':')[1];
  if (!date) return '参考价';
  const month = date.slice(5, 7);
  const day = date.slice(8, 10);
  return `参考价 · ${month}-${day}`;
}

export function buildRecommendationRequest(input: {
  query: string;
  category: RecommendationCategory | '';
  budgetMin?: number;
  budgetMax?: number;
  brands: string[];
  scenarios: string[];
  platforms: RecommendationPlatform[];
}): ProductRecommendationRequest {
  return {
    query: input.query.trim(),
    category: input.category,
    budgetMin: input.budgetMin || undefined,
    budgetMax: input.budgetMax || undefined,
    brands: input.brands,
    scenarios: input.scenarios,
    platforms: input.platforms,
  };
}

export function filterLinksByPlatform(links: PlatformLink[], platforms: RecommendationPlatform[]) {
  if (platforms.length === 0) return links;
  return links.filter((link) => platforms.includes(link.platform));
}

export function summarizeRequest(input: ProductRecommendationRequest) {
  if (input.query.trim()) return input.query.trim();
  const category = CATEGORY_OPTIONS.find((option) => option.id === input.category)?.label;
  const parts: string[] = [];
  if (category && category !== '不限') parts.push(category);
  if (input.budgetMin || input.budgetMax) {
    parts.push(
      `${input.budgetMin ? formatPrice(input.budgetMin) : ''}-${input.budgetMax ? formatPrice(input.budgetMax) : ''}`,
    );
  }
  if ((input.scenarios ?? []).length > 0) parts.push(`优先${(input.scenarios ?? []).join('、')}`);
  return parts.join(' · ') || '智能商品推荐';
}

export type RecommendationFilter = {
  budgetRange?: FilterOption;
  brands: string[];
  scenarios: string[];
  platforms: RecommendationPlatform[];
};

export type RecommendationSortKey = 'fit' | 'price-asc' | 'price-desc';

export function filterRecommendationItems(items: RecommendationItem[], filter: RecommendationFilter) {
  return items.filter((item) => {
    if (filter.budgetRange) {
      const min = filter.budgetRange.min ?? 0;
      const max = filter.budgetRange.max ?? Number.POSITIVE_INFINITY;
      if (item.referencePrice < min || item.referencePrice > max) return false;
    }
    if (filter.brands.length > 0 && !filter.brands.includes(item.brand)) return false;
    if (
      filter.scenarios.length > 0
      && !filter.scenarios.some((scenario) => matchesScenario(item, scenario))
    ) {
      return false;
    }
    if (filter.platforms.length > 0) {
      const available = new Set(item.links.map((link) => link.platform));
      if (!filter.platforms.some((platform) => available.has(platform))) return false;
    }
    return true;
  });
}

export function sortRecommendationItems(items: RecommendationItem[], sortKey: RecommendationSortKey) {
  const sorted = [...items];
  sorted.sort((left, right) => {
    if (sortKey === 'price-asc') return left.referencePrice - right.referencePrice;
    if (sortKey === 'price-desc') return right.referencePrice - left.referencePrice;
    return right.fitScore - left.fitScore;
  });
  return sorted;
}

export function countActiveFilters(filter: RecommendationFilter) {
  return (
    (filter.budgetRange ? 1 : 0)
    + filter.brands.length
    + filter.scenarios.length
    + filter.platforms.length
  );
}

export function emptyFilter(): RecommendationFilter {
  return { brands: [], scenarios: [], platforms: [] };
}

export function matchesScenario(item: RecommendationItem, scenario: string) {
  const text = [
    item.suitableFor,
    ...Object.values(item.specs ?? {}),
    ...item.reasons.map((reason) => `${reason.label} ${reason.text}`),
  ]
    .join(' ')
    .toLowerCase();
  const keywords: Record<string, string[]> = {
    游戏: ['游戏', '电竞', 'elite', '天玑 9400', '144hz'],
    影像: ['影像', '拍照', '摄影', '相机', '蔡司', '潜望', '50mp', '200mp'],
    续航: ['续航', '电池', 'mah'],
    画质: ['画质', '屏幕', '2k', 'oled', 'mini led'],
    办公: ['办公', '学习'],
    轻便: ['轻便', '轻薄', '手感', '便携', '约 18'],
  };
  return (keywords[scenario] ?? []).some((keyword) => text.includes(keyword));
}
