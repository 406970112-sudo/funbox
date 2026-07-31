import type { SocialUser } from '@/types/social';

export type GameMatchStatus = 'active' | 'declined' | 'finished' | 'pending';
export type GameLeaderboardPeriod = 'all-time' | 'weekly';

export type GameMove = {
  clientMoveId: string;
  col: number;
  createdAt: string;
  row: number;
  sequence: number;
  userId: string;
};

export type GameMatch = {
  createdAt: string;
  currentTurnUserId: string;
  gameId: string;
  id: string;
  inviter: SocialUser;
  moves: GameMove[];
  opponent: SocialUser;
  status: GameMatchStatus;
  updatedAt: string;
  winnerUserId: string;
};

export type GameScore = {
  createdAt: string;
  gameId: string;
  id: string;
  score: number;
  userId: string;
};

export type GameLeaderboardEntry = {
  isCurrentUser: boolean;
  rank: number;
  score: number;
  updatedAt: string;
  user: SocialUser;
};

export type GameSocialCapability = {
  friendLeaderboard: boolean;
  friendMatch: boolean;
};
