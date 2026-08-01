import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '@/features/auth/auth-provider';
import { upsertGameMatch } from '@/features/games/game-social-model';
import { useSocial } from '@/features/social/social-provider';
import {
  createGameMatch,
  getGameSocialErrorMessage,
  listGameLeaderboard,
  listGameMatches,
  resignGameMatch,
  resolveGameMatch,
  respondGameMatch,
  submitGameMove,
  submitGameScore,
} from '@/lib/game-social-api';
import type {
  GameLeaderboardEntry,
  GameLeaderboardPeriod,
  GameMatch,
} from '@/types/game-social';

type GameSocialContextValue = {
  authenticated: boolean;
  createMatch: (gameId: string, opponentId: string) => Promise<GameMatch>;
  error: string;
  getLeaderboard: (
    gameId: string,
    period: GameLeaderboardPeriod,
  ) => Promise<GameLeaderboardEntry[]>;
  loading: boolean;
  matches: GameMatch[];
  refreshMatches: () => Promise<void>;
  resignMatch: (matchId: string) => Promise<GameMatch>;
  respondMatch: (matchId: string, action: 'accept' | 'decline') => Promise<GameMatch>;
  submitMove: (
    matchId: string,
    move: { clientMoveId: string; col: number; fromCol?: number; fromRow?: number; row: number },
  ) => Promise<GameMatch>;
  submitScore: (gameId: string, score: number) => Promise<void>;
};

const GameSocialContext = createContext<GameSocialContextValue | undefined>(undefined);

export function GameSocialProvider({ children }: PropsWithChildren) {
  const { accessToken } = useAuth();
  const { lastEvent, lastEventSequence } = useSocial();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<GameMatch[]>([]);

  const refreshMatchesForToken = useCallback(async (token: string, showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      setMatches(await listGameMatches(token));
      setError('');
    } catch (nextError) {
      setError(getGameSocialErrorMessage(nextError));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setMatches([]);
      setError('');
      return;
    }
    void refreshMatchesForToken(accessToken, true);
  }, [accessToken, refreshMatchesForToken]);

  useEffect(() => {
    if (!lastEvent || !lastEvent.type.startsWith('game.match.')) {
      return;
    }
    const eventMatch = lastEvent.data;
    if (!isGameMatch(eventMatch)) return;
    setMatches((current) => upsertGameMatch(current, resolveGameMatch(eventMatch)));
  }, [lastEvent, lastEventSequence]);

  const runMatchMutation = useCallback(async (request: () => Promise<GameMatch>) => {
    try {
      const match = await request();
      setMatches((current) => upsertGameMatch(current, match));
      setError('');
      return match;
    } catch (nextError) {
      setError(getGameSocialErrorMessage(nextError));
      throw nextError;
    }
  }, []);

  const value = useMemo<GameSocialContextValue>(() => ({
    authenticated: Boolean(accessToken),
    createMatch: async (gameId, opponentId) => {
      if (!accessToken) throw new Error('Authentication required');
      return runMatchMutation(() => createGameMatch(accessToken, gameId, opponentId));
    },
    error,
    getLeaderboard: async (gameId, period) => {
      if (!accessToken) throw new Error('Authentication required');
      return listGameLeaderboard(accessToken, gameId, period);
    },
    loading,
    matches,
    refreshMatches: async () => {
      if (accessToken) await refreshMatchesForToken(accessToken, true);
    },
    resignMatch: async (matchId) => {
      if (!accessToken) throw new Error('Authentication required');
      return runMatchMutation(() => resignGameMatch(accessToken, matchId));
    },
    respondMatch: async (matchId, action) => {
      if (!accessToken) throw new Error('Authentication required');
      return runMatchMutation(() => respondGameMatch(accessToken, matchId, action));
    },
    submitMove: async (matchId, move) => {
      if (!accessToken) throw new Error('Authentication required');
      return runMatchMutation(() => submitGameMove(accessToken, matchId, move));
    },
    submitScore: async (gameId, score) => {
      if (!accessToken) return;
      try {
        await submitGameScore(accessToken, gameId, score);
        setError('');
      } catch (nextError) {
        setError(getGameSocialErrorMessage(nextError));
        throw nextError;
      }
    },
  }), [
    accessToken,
    error,
    loading,
    matches,
    refreshMatchesForToken,
    runMatchMutation,
  ]);

  return <GameSocialContext.Provider value={value}>{children}</GameSocialContext.Provider>;
}

export function useGameSocial() {
  const value = useContext(GameSocialContext);
  if (!value) throw new Error('useGameSocial must be used within GameSocialProvider');
  return value;
}

function isGameMatch(value: unknown): value is GameMatch {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<GameMatch>;
  return typeof candidate.id === 'string' && typeof candidate.gameId === 'string';
}
