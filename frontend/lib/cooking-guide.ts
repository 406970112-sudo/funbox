import type {
  CookingArea,
  CookingContributionInput,
  CookingDishSummary,
} from '@/types/cooking-guide';

export type CookingSortKey = 'default' | 'ingredients-asc' | 'steps-asc';

export function displayDishName(dish: { name: string; nameZh: string }) {
  return dish.nameZh || dish.name;
}

export function displayArea(area: Pick<CookingArea, 'name' | 'zh'>) {
  return area.zh || area.name;
}

export function filterCookingDishes(
  items: CookingDishSummary[],
  filter: { area?: string; category?: string; tag?: string },
) {
  return items.filter((dish) => {
    if (filter.area && dish.area !== filter.area && dish.areaZh !== filter.area) return false;
    if (filter.category && dish.category !== filter.category) return false;
    if (filter.tag && !dish.tags.includes(filter.tag)) return false;
    return true;
  });
}

export function sortCookingDishes(items: CookingDishSummary[], sortKey: CookingSortKey) {
  const sorted = [...items];
  if (sortKey === 'ingredients-asc') {
    sorted.sort((left, right) => left.ingredientCount - right.ingredientCount);
  } else if (sortKey === 'steps-asc') {
    sorted.sort((left, right) => left.stepCount - right.stepCount);
  }
  return sorted;
}

export function formatFetchedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${year}-${month}-${day}`;
}

export function summarizeCookingSearch(
  query: string,
  areaName: string | undefined,
  count: number,
) {
  const scope = query.trim() ? `搜索“${query.trim()}”` : areaName ? `菜系“${areaName}”` : '全部菜谱';
  return `${scope}找到 ${count} 道真实菜谱`;
}

export function validateContribution(input: CookingContributionInput) {
  if (!input.name.trim()) return '菜名不能为空';
  if (!input.area.trim()) return '菜系不能为空';
  if (input.ingredients.filter((item) => item.trim()).length === 0) return '至少填写一种食材';
  if (input.steps.filter((item) => item.trim()).length === 0) return '至少填写一个步骤';
  return null;
}

export function emptyContribution(): CookingContributionInput {
  return {
    name: '',
    nameZh: '',
    area: '',
    category: '',
    imageUrl: '',
    recipeSource: '',
    ingredients: [''],
    steps: [''],
  };
}
