import type { GameSocialCapability } from '@/types/game-social';

const GAME_SOCIAL_CAPABILITIES: Record<string, GameSocialCapability> = {
  'brick-breaker': { friendLeaderboard: true, friendMatch: false, requiresAuthentication: true },
  gomoku: { friendLeaderboard: false, friendMatch: true, requiresAuthentication: true },
  'snake-brawl': { friendLeaderboard: true, friendMatch: false, requiresAuthentication: true },
  tetris: { friendLeaderboard: true, friendMatch: false, requiresAuthentication: true },
  xiangqi: { friendLeaderboard: false, friendMatch: true, requiresAuthentication: true },
};

export function getGameSocialCapability(gameId: string): GameSocialCapability | null {
  return GAME_SOCIAL_CAPABILITIES[gameId] ?? null;
}

type MatchListItem = {
  id: string;
  status: string;
  updatedAt: string;
};

export function upsertGameMatch<T extends MatchListItem>(matches: T[], incoming: T): T[] {
  return [...matches.filter((match) => match.id !== incoming.id), incoming].sort(compareMatches);
}

function compareMatches(left: MatchListItem, right: MatchListItem) {
  const statusOrder: Record<string, number> = { pending: 0, active: 1 };
  const leftOrder = statusOrder[left.status] ?? 2;
  const rightOrder = statusOrder[right.status] ?? 2;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;
  return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
}
