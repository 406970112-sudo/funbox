export const COMMON_TOOL_LIMIT = 6;

export type ToolUsageStat = {
  clickCount: number;
  lastClickedAt: number;
  toolId: string;
};

export function addToolUsage(
  items: readonly ToolUsageStat[],
  toolId: string,
  clickedAt: number,
): ToolUsageStat[] {
  const normalizedItems = parseToolUsage(items);
  if (!toolId.trim() || !Number.isFinite(clickedAt)) return normalizedItems;

  const existingItem = normalizedItems.find((item) => item.toolId === toolId);
  const nextItem: ToolUsageStat = {
    clickCount: Math.min((existingItem?.clickCount ?? 0) + 1, Number.MAX_SAFE_INTEGER),
    lastClickedAt: clickedAt,
    toolId,
  };

  return parseToolUsage([
    nextItem,
    ...normalizedItems.filter((item) => item.toolId !== toolId),
  ]);
}

export function getCommonToolIds(
  eligibleToolIds: readonly string[],
  usage: readonly ToolUsageStat[],
  defaultToolIds: readonly string[],
  limit = COMMON_TOOL_LIMIT,
): string[] {
  if (limit <= 0) return [];

  const eligibleIds = Array.from(new Set(eligibleToolIds));
  const eligibleIdSet = new Set(eligibleIds);
  const eligibleOrder = new Map(eligibleIds.map((toolId, index) => [toolId, index]));
  const usageByToolId = new Map(
    parseToolUsage(usage).map((item) => [item.toolId, item] as const),
  );
  const result: string[] = [];

  const rankedUsedIds = eligibleIds
    .filter((toolId) => usageByToolId.has(toolId))
    .sort((leftId, rightId) => {
      const left = usageByToolId.get(leftId)!;
      const right = usageByToolId.get(rightId)!;

      return (
        right.clickCount - left.clickCount ||
        right.lastClickedAt - left.lastClickedAt ||
        (eligibleOrder.get(leftId) ?? 0) - (eligibleOrder.get(rightId) ?? 0)
      );
    });

  function append(toolId: string) {
    if (!eligibleIdSet.has(toolId) || result.includes(toolId) || result.length >= limit) return;
    result.push(toolId);
  }

  rankedUsedIds.forEach(append);
  defaultToolIds.forEach(append);
  eligibleIds.forEach(append);

  return result;
}

export function parseToolUsage(value: unknown): ToolUsageStat[] {
  if (!Array.isArray(value)) return [];

  const candidates = value
    .filter(isToolUsageStat)
    .sort(
      (left, right) =>
        right.clickCount - left.clickCount || right.lastClickedAt - left.lastClickedAt,
    );
  const seen = new Set<string>();

  return candidates.filter((item) => {
    if (seen.has(item.toolId)) return false;
    seen.add(item.toolId);
    return true;
  });
}

function isToolUsageStat(value: unknown): value is ToolUsageStat {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Partial<ToolUsageStat>;
  return (
    typeof candidate.toolId === 'string' &&
    candidate.toolId.trim().length > 0 &&
    typeof candidate.clickCount === 'number' &&
    Number.isSafeInteger(candidate.clickCount) &&
    candidate.clickCount > 0 &&
    typeof candidate.lastClickedAt === 'number' &&
    Number.isFinite(candidate.lastClickedAt)
  );
}
