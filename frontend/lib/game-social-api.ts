import { resolveAvatarURL, getAPIBaseUrl } from '@/lib/auth-api';
import { SocialAPIError } from '@/lib/social-api';
import type {
  GameLeaderboardEntry,
  GameLeaderboardPeriod,
  GameMatch,
  GameScore,
} from '@/types/game-social';
import type { SocialUser } from '@/types/social';

type ErrorPayload = { error?: string };
type MatchResponse = { match: GameMatch };
type MatchesResponse = { matches: GameMatch[] };
type ScoreResponse = { score: GameScore };
type LeaderboardResponse = { entries: GameLeaderboardEntry[] };

export async function createGameMatch(token: string, gameId: string, opponentId: string) {
  const response = await requestJSON<MatchResponse>('/api/v1/game-matches', token, {
    body: JSON.stringify({ gameId, opponentId }),
    method: 'POST',
  });
  return resolveGameMatch(response.match);
}

export async function listGameMatches(token: string) {
  const response = await requestJSON<MatchesResponse>('/api/v1/game-matches', token);
  return response.matches.map(resolveGameMatch);
}

export async function getGameMatch(token: string, matchId: string) {
  const response = await requestJSON<MatchResponse>(
    `/api/v1/game-matches/${encodeURIComponent(matchId)}`,
    token,
  );
  return resolveGameMatch(response.match);
}

export async function respondGameMatch(
  token: string,
  matchId: string,
  action: 'accept' | 'decline',
) {
  const response = await requestJSON<MatchResponse>(
    `/api/v1/game-matches/${encodeURIComponent(matchId)}/${action}`,
    token,
    { body: '{}', method: 'POST' },
  );
  return resolveGameMatch(response.match);
}

export async function submitGameMove(
  token: string,
  matchId: string,
  move: { clientMoveId: string; col: number; row: number },
) {
  const response = await requestJSON<MatchResponse>(
    `/api/v1/game-matches/${encodeURIComponent(matchId)}/moves`,
    token,
    { body: JSON.stringify(move), method: 'POST' },
  );
  return resolveGameMatch(response.match);
}

export async function resignGameMatch(token: string, matchId: string) {
  const response = await requestJSON<MatchResponse>(
    `/api/v1/game-matches/${encodeURIComponent(matchId)}/resign`,
    token,
    { body: '{}', method: 'POST' },
  );
  return resolveGameMatch(response.match);
}

export async function submitGameScore(token: string, gameId: string, score: number) {
  const response = await requestJSON<ScoreResponse>('/api/v1/game-scores', token, {
    body: JSON.stringify({ gameId, score }),
    method: 'POST',
  });
  return response.score;
}

export async function listGameLeaderboard(
  token: string,
  gameId: string,
  period: GameLeaderboardPeriod,
) {
  const response = await requestJSON<LeaderboardResponse>(
    `/api/v1/game-leaderboards/${encodeURIComponent(gameId)}?period=${encodeURIComponent(period)}`,
    token,
  );
  return response.entries.map((entry) => ({
    ...entry,
    user: resolveSocialUser(entry.user),
  }));
}

export function resolveGameMatch(match: GameMatch): GameMatch {
  return {
    ...match,
    inviter: resolveSocialUser(match.inviter),
    opponent: resolveSocialUser(match.opponent),
  };
}

export function getGameSocialErrorMessage(error: unknown) {
  if (!(error instanceof SocialAPIError)) return '游戏社交服务暂时不可用，请稍后重试。';
  const messages: Record<string, string> = {
    forbidden: '当前账号不能执行这个操作。',
    game_capability_unsupported: '这个游戏暂未开放该社交能力。',
    game_cell_occupied: '这个位置已经有棋子了。',
    game_match_exists: '你们已经有一局等待中或进行中的对局。',
    game_match_not_active: '这局对战已经结束或尚未开始。',
    game_move_invalid: '这一步不符合当前游戏规则。',
    game_not_your_turn: '还没轮到你落子。',
    not_found: '没有找到这局对战。',
    not_friends: '只有好友之间可以发起对战。',
    rate_limited: '操作太频繁，请稍后再试。',
    unauthorized: '登录状态已失效，请重新登录。',
  };
  return messages[error.code] ?? '游戏社交操作失败，请稍后重试。';
}

async function requestJSON<T>(path: string, token: string, options: RequestInit = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${getAPIBaseUrl()}${path}`, { ...options, headers });
  const payload = (await response.json().catch(() => ({}))) as T & ErrorPayload;
  if (!response.ok) {
    throw new SocialAPIError(payload.error ?? 'request_failed', response.status);
  }
  return payload;
}

function resolveSocialUser(user: SocialUser): SocialUser {
  return { ...user, avatarUrl: resolveAvatarURL(user.avatarUrl) };
}
