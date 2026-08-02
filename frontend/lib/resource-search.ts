import type { ResourceSearchSource } from '@/types/resource-search';

export const RESOURCE_SEARCH_CATEGORIES = ['网盘', '影视', '文档', '软件', '综合'] as const;

export function normalizeResourceSearchQuery(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

export function getResourceSearchQueue(
  sources: readonly ResourceSearchSource[],
  selectedIds: readonly string[],
) {
  const selected = new Set(selectedIds);
  return [...sources]
    .filter((source) => source.enabled && selected.has(source.id))
    .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name));
}

export function getDefaultResourceSearchSourceIds(sources: readonly ResourceSearchSource[]) {
  return sources
    .filter((source) => source.enabled && source.defaultSelected)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((source) => source.id);
}

export function groupResourceSearchSources(sources: readonly ResourceSearchSource[]) {
  const order = new Map<string, number>(RESOURCE_SEARCH_CATEGORIES.map((category, index) => [category, index]));
  const groups = new Map<string, ResourceSearchSource[]>();
  for (const source of sources) {
    const category = order.has(source.category) ? source.category : '综合';
    const items = groups.get(category) ?? [];
    items.push(source);
    groups.set(category, items);
  }
  return [...groups.entries()]
    .sort((left, right) => (order.get(left[0]) ?? 99) - (order.get(right[0]) ?? 99))
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)),
    }));
}
