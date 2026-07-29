import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import type { ComponentProps } from 'react';

export type AppIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type ToolId =
  | 'text-to-speech'
  | 'release-email-assistant'
  | 'live-stream-capture'
  | 'image-cleanup'
  | 'smart-translation'
  | 'focus-plan';

export type GameId = 'snake-brawl' | 'gomoku' | 'brain-challenge' | 'speed-racer';

export type ToolCategory = 'AI' | '音频' | '效率' | '多媒体' | '直播';
export type ToolStatus = 'available' | 'coming-soon';
export type GameStatus = 'playable' | 'coming-soon';

export type AppTool = {
  id: ToolId;
  name: string;
  tagline: string;
  description: string;
  icon: AppIconName;
  category: ToolCategory;
  route: `/tools/${ToolId}`;
  accentColor: string;
  badges: string[];
  usageLabel: string;
  status: ToolStatus;
  featured?: boolean;
};

export type RecentActivity = {
  id: string;
  title: string;
  type: '工具' | '游戏';
  actionLabel: string;
  toolId?: ToolId;
  gameId?: GameId;
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
