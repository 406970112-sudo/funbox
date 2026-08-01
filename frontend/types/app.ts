import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

export type AppIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type ToolId = string;

export type GameId =
  | 'snake-brawl'
  | 'gomoku'
  | 'tetris'
  | 'brick-breaker'
  | 'brain-challenge'
  | 'speed-racer';

export type ToolCategory = string;
export type ToolStatus = 'available' | 'coming-soon';
export type GameStatus = 'playable' | 'coming-soon';

export type AppTool = {
  id: ToolId;
  name: string;
  tagline: string;
  description: string;
  icon: AppIconName;
  category: ToolCategory;
  route: `/tools/${string}`;
  accentColor: string;
  badges: string[];
  usageLabel: string;
  status: ToolStatus;
  featured?: boolean;
  hiddenFromList?: boolean;
};

export type GameItem = {
  id: GameId;
  name: string;
  genre: string;
  tag: string;
  description: string;
  accentColor: string;
  route: `/games/${GameId}`;
  status: GameStatus;
};
