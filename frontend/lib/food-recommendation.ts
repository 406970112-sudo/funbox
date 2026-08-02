import type {
  FoodFilterOption,
  FoodItem,
  FoodRequest,
} from '@/types/food-recommendation';

export const CUISINE_OPTIONS = [
  { id: '火锅', label: '火锅' },
  { id: '川菜', label: '川菜' },
  { id: '小吃', label: '小吃' },
  { id: '面食', label: '面食' },
  { id: '甜品', label: '甜品' },
];

export const SPICINESS_OPTIONS = [
  { id: '不辣', label: '不辣' },
  { id: '微辣', label: '微辣' },
  { id: '中辣', label: '中辣' },
  { id: '重辣', label: '重辣' },
];

export const PRICE_RANGES: FoodFilterOption[] = [
  { max: 30, label: '30以内' },
  { min: 30, max: 60, label: '30-60' },
  { min: 60, max: 100, label: '60-100' },
  { min: 100, label: '100+' },
];

export const DISTANCE_RANGES: FoodFilterOption[] = [
  { max: 1, label: '1km内' },
  { max: 3, label: '3km内' },
  { max: 5, label: '5km内' },
];

export const DIETARY_OPTIONS = [
  { id: '不吃辣', label: '不吃辣' },
  { id: '不吃香菜', label: '不吃香菜' },
  { id: '素食', label: '素食' },
  { id: '清真', label: '清真' },
  { id: '不吃内脏', label: '不吃内脏' },
];

export const SCENARIO_OPTIONS = [
  { id: '一人食', label: '一人食' },
  { id: '朋友聚餐', label: '朋友聚餐' },
  { id: '夜宵', label: '夜宵' },
  { id: '带家人', label: '带家人' },
  { id: '约会', label: '约会' },
];

export type FoodFilter = {
  cuisines: string[];
  spiciness: string[];
  priceRange?: FoodFilterOption;
  distanceRange?: FoodFilterOption;
  dietary: string[];
  scenarios: string[];
};

export type FoodSortKey = 'fit' | 'distance' | 'price-asc' | 'rating';

export function formatPrice(price: number) {
  return `¥${price.toLocaleString('zh-CN')}`;
}

export function formatDistance(km: number) {
  if (km < 1) return `${Math.max(1, Math.round(km * 1000))}m`;
  return `${km.toFixed(1)}km`;
}

export function buildFoodRequest(input: {
  query: string;
  city?: string;
  district?: string;
  cuisines: string[];
  spiciness: string[];
  priceMin?: number;
  priceMax?: number;
  distanceMaxKm?: number;
  dietary: string[];
  scenarios: string[];
  lat?: number;
  lng?: number;
}): FoodRequest {
  return {
    query: input.query.trim(),
    city: input.city,
    district: input.district,
    cuisines: input.cuisines,
    spiciness: input.spiciness,
    priceMin: input.priceMin || undefined,
    priceMax: input.priceMax || undefined,
    distanceMaxKm: input.distanceMaxKm || undefined,
    dietary: input.dietary,
    scenarios: input.scenarios,
    lat: input.lat,
    lng: input.lng,
  };
}

export function summarizeFoodRequest(input: FoodRequest) {
  if (input.query.trim()) return input.query.trim();
  const parts: string[] = [];
  if (input.city) parts.push(input.city);
  if (input.district) parts.push(input.district);
  if ((input.cuisines ?? []).length > 0) parts.push(`菜系${(input.cuisines ?? []).join('、')}`);
  if ((input.spiciness ?? []).length > 0) parts.push((input.spiciness ?? []).join('、'));
  return parts.join(' · ') || '本地美食推荐';
}

export function filterFoodItems(items: FoodItem[], filter: FoodFilter) {
  return items.filter((item) => {
    if (filter.cuisines.length > 0 && !filter.cuisines.includes(item.cuisine)) return false;
    if (filter.spiciness.length > 0 && !filter.spiciness.includes(item.spiciness)) return false;
    if (filter.priceRange) {
      const min = filter.priceRange.min ?? 0;
      const max = filter.priceRange.max ?? Number.POSITIVE_INFINITY;
      if (item.avgPrice < min || item.avgPrice > max) return false;
    }
    if (filter.distanceRange && item.distanceKm > (filter.distanceRange.max ?? Number.POSITIVE_INFINITY)) {
      return false;
    }
    if (filter.dietary.length > 0 && !filter.dietary.every((diet) => matchesDietary(item, diet))) {
      return false;
    }
    if (filter.scenarios.length > 0 && !filter.scenarios.some((scenario) => item.suitableFor.includes(scenario))) {
      return false;
    }
    return true;
  });
}

export function sortFoodItems(items: FoodItem[], sortKey: FoodSortKey) {
  const sorted = [...items];
  sorted.sort((left, right) => {
    if (sortKey === 'distance') return left.distanceKm - right.distanceKm;
    if (sortKey === 'price-asc') return left.avgPrice - right.avgPrice;
    if (sortKey === 'rating') return right.rating - left.rating;
    return right.fitScore - left.fitScore;
  });
  return sorted;
}

export function shuffleFoodItems(items: FoodItem[], seed: number) {
  const values = [...items];
  let state = (seed * 9301 + 49297) % 233280;
  for (let i = values.length - 1; i > 0; i -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const index = state % (i + 1);
    [values[i], values[index]] = [values[index], values[i]];
  }
  return values;
}

export function countActiveFilters(filter: FoodFilter) {
  return (
    filter.cuisines.length
    + filter.spiciness.length
    + (filter.priceRange ? 1 : 0)
    + (filter.distanceRange ? 1 : 0)
    + filter.dietary.length
    + filter.scenarios.length
  );
}

export function emptyFoodFilter(): FoodFilter {
  return { cuisines: [], spiciness: [], dietary: [], scenarios: [] };
}

export function matchesDietary(item: FoodItem, diet: string) {
  switch (diet) {
    case '不吃辣':
      return item.spiciness === '不辣';
    case '不吃香菜':
      return !item.ingredients.some((ingredient) => ingredient.includes('香菜'));
    case '素食':
    case '清真':
      return !item.ingredients.some((ingredient) =>
        ['牛肉', '猪肉', '鸡肉', '鸭血', '鸭肠', '毛肚', '黄喉', '杂酱', '臊子', '肉'].some((keyword) =>
          ingredient.includes(keyword),
        ),
      );
    case '不吃内脏':
      return !item.ingredients.some((ingredient) =>
        ['毛肚', '鸭肠', '鸭血', '黄喉', '猪血', '肠'].some((keyword) => ingredient.includes(keyword)),
      );
    default:
      return true;
  }
}
