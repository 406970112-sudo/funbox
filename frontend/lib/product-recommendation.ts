import type {
  PlatformLink,
  ProductRecommendationRequest,
  RecommendationCategory,
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
