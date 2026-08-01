import type { ToolUsageStat } from './tool-usage.ts';

export const HOME_TOOLS_VISIBLE_LIMIT = 6;
export const HOME_RECENT_TOOL_LIMIT = 4;
export const HOME_ALL_CATEGORY = '全部';

export type HomeCatalogTool = {
  id: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  badges?: readonly string[];
};

export function getMergedToolCategories(tools: readonly HomeCatalogTool[]): string[] {
  return Array.from(new Set(tools.map((tool) => tool.category)));
}

export function filterMergedTools<T extends HomeCatalogTool>(
  tools: readonly T[],
  category: string,
  query: string,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();

  return tools.filter((tool) => {
    if (category !== HOME_ALL_CATEGORY && tool.category !== category) return false;
    if (!normalizedQuery) return true;

    const haystack = [tool.name, tool.tagline, tool.description, ...(tool.badges ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

export function getToolGridSlice<T extends HomeCatalogTool>(
  tools: readonly T[],
  expanded: boolean,
  limit = HOME_TOOLS_VISIBLE_LIMIT,
): T[] {
  if (limit <= 0 || expanded) return Array.from(tools);
  return Array.from(tools).slice(0, limit);
}

export function canExpandToolGrid(
  tools: readonly HomeCatalogTool[],
  limit = HOME_TOOLS_VISIBLE_LIMIT,
): boolean {
  return tools.length > limit;
}

export function getToolGridExpandLabel(
  tools: readonly HomeCatalogTool[],
  expanded: boolean,
  limit = HOME_TOOLS_VISIBLE_LIMIT,
): string {
  if (expanded) return '收起工具';
  return `展开全部 ${Math.max(0, tools.length - limit)} 个`;
}

export function getRecentToolIds(
  eligibleToolIds: readonly string[],
  usage: readonly ToolUsageStat[],
  limit = HOME_RECENT_TOOL_LIMIT,
): string[] {
  if (limit <= 0) return [];

  const eligibleIdSet = new Set(eligibleToolIds);
  const latestUsageByToolId = new Map<string, ToolUsageStat>();

  for (const item of usage) {
    if (!eligibleIdSet.has(item.toolId)) continue;
    const existing = latestUsageByToolId.get(item.toolId);
    if (!existing || item.lastClickedAt > existing.lastClickedAt) {
      latestUsageByToolId.set(item.toolId, item);
    }
  }

  return Array.from(latestUsageByToolId.values())
    .sort((left, right) => right.lastClickedAt - left.lastClickedAt)
    .slice(0, limit)
    .map((item) => item.toolId);
}
