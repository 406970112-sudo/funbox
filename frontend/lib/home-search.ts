import type { RecentUsageItem } from '@/lib/recent-usage';
import type { ToolUsageStat } from '@/lib/tool-usage';
import type { AppTool, GameItem } from '@/types/app';

export const HOME_SEARCH_PANEL_LIMIT = 5;
export const HOME_SEARCH_QUICK_LIMIT = 3;

export type HomeSearchEntry = {
  id: string;
  kind: 'tool' | 'game';
  name: string;
  tagline: string;
  category: string;
  route: string;
  icon: string;
  accentColor: string;
  badge?: string;
};

type RankedSearchEntry = {
  entry: HomeSearchEntry;
  order: number;
  rank: number;
  usage: ToolUsageStat | undefined;
};

export type HighlightSegment = {
  match: boolean;
  text: string;
};

function toolToEntry(tool: AppTool): HomeSearchEntry {
  return {
    id: tool.id,
    kind: 'tool',
    name: tool.name,
    tagline: tool.tagline,
    category: tool.category,
    route: tool.route,
    icon: tool.icon,
    accentColor: tool.accentColor,
    badge: tool.badges[0],
  };
}

function gameToEntry(game: GameItem): HomeSearchEntry {
  return {
    id: game.id,
    kind: 'game',
    name: game.name,
    tagline: game.description,
    category: game.genre,
    route: game.route,
    icon: 'gamepad-variant',
    accentColor: game.accentColor,
    badge: game.tag,
  };
}

function getToolMatchRank(tool: AppTool, normalizedQuery: string): number | null {
  const name = tool.name.toLowerCase();
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;

  const haystack = [tool.tagline, tool.description, tool.category, ...tool.badges]
    .join(' ')
    .toLowerCase();
  return haystack.includes(normalizedQuery) ? 3 : null;
}

function getGameMatchRank(game: GameItem, normalizedQuery: string): number | null {
  const name = game.name.toLowerCase();
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;

  const haystack = [game.genre, game.description, game.tag].join(' ').toLowerCase();
  return haystack.includes(normalizedQuery) ? 3 : null;
}

export function searchHomeEntries(
  tools: readonly AppTool[],
  games: readonly GameItem[],
  query: string,
  usage: readonly ToolUsageStat[] = [],
): HomeSearchEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];

  const usageByToolId = new Map(usage.map((item) => [item.toolId, item] as const));
  const ranked: RankedSearchEntry[] = [];
  let order = 0;

  for (const tool of tools) {
    const rank = getToolMatchRank(tool, normalizedQuery);
    if (rank === null) continue;
    ranked.push({
      entry: toolToEntry(tool),
      order: order++,
      rank,
      usage: usageByToolId.get(tool.id),
    });
  }

  for (const game of games) {
    const rank = getGameMatchRank(game, normalizedQuery);
    if (rank === null) continue;
    ranked.push({
      entry: gameToEntry(game),
      order: order++,
      rank,
      usage: undefined,
    });
  }

  return ranked
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        (right.usage?.clickCount ?? 0) - (left.usage?.clickCount ?? 0) ||
        (right.usage?.lastClickedAt ?? 0) - (left.usage?.lastClickedAt ?? 0) ||
        left.order - right.order,
    )
    .map((item) => item.entry);
}

export function getHomeSearchSlice(
  entries: readonly HomeSearchEntry[],
  limit = HOME_SEARCH_PANEL_LIMIT,
): HomeSearchEntry[] {
  if (limit <= 0) return [];
  return Array.from(entries).slice(0, limit);
}

export function getQuickSearchEntries(
  tools: readonly AppTool[],
  games: readonly GameItem[],
  recentUsage: readonly RecentUsageItem[],
  limit = HOME_SEARCH_QUICK_LIMIT,
): HomeSearchEntry[] {
  if (limit <= 0) return [];

  const toolById = new Map(tools.map((tool) => [tool.id, tool] as const));
  const gameById = new Map<string, GameItem>(games.map((game) => [game.id, game]));
  const entries: HomeSearchEntry[] = [];

  for (const item of recentUsage) {
    if (entries.length >= limit) break;
    if (item.kind === 'tool') {
      const tool = toolById.get(item.itemId);
      if (tool) entries.push(toolToEntry(tool));
    } else {
      const game = gameById.get(item.itemId);
      if (game) entries.push(gameToEntry(game));
    }
  }

  return entries;
}

export function splitHighlight(text: string, query: string): HighlightSegment[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [{ text, match: false }];

  const normalizedText = text.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let index = normalizedText.indexOf(normalizedQuery, cursor);

  while (index >= 0) {
    if (index > cursor) {
      segments.push({ text: text.slice(cursor, index), match: false });
    }
    segments.push({
      text: text.slice(index, index + normalizedQuery.length),
      match: true,
    });
    cursor = index + normalizedQuery.length;
    index = normalizedText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }

  return segments.length > 0 ? segments : [{ text, match: false }];
}
