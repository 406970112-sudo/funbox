export const MAX_RECENT_USAGE_ITEMS = 3;

export type RecentUsageKind = 'tool' | 'game';

export type RecentUsageItem = {
  itemId: string;
  kind: RecentUsageKind;
  usedAt: number;
};

export function addRecentUsage(
  items: readonly RecentUsageItem[],
  item: RecentUsageItem,
): RecentUsageItem[] {
  return parseRecentUsage([item, ...items]);
}

export function parseRecentUsage(value: unknown): RecentUsageItem[] {
  if (!Array.isArray(value)) return [];

  const candidates = value
    .filter(isRecentUsageItem)
    .sort((left, right) => right.usedAt - left.usedAt);
  const seen = new Set<string>();
  const result: RecentUsageItem[] = [];

  for (const item of candidates) {
    const key = `${item.kind}:${item.itemId}`;
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(item);
    if (result.length === MAX_RECENT_USAGE_ITEMS) break;
  }

  return result;
}

function isRecentUsageItem(value: unknown): value is RecentUsageItem {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<RecentUsageItem>;
  return (
    (candidate.kind === 'tool' || candidate.kind === 'game') &&
    typeof candidate.itemId === 'string' &&
    candidate.itemId.trim().length > 0 &&
    typeof candidate.usedAt === 'number' &&
    Number.isFinite(candidate.usedAt)
  );
}
