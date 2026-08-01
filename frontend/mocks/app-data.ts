import type {
  AppTool,
  GameItem,
  ToolId,
} from '@/types/app';
import type { UserRole } from '@/types/access';

import featureRegistry from '../../backend/internal/access/feature_registry.json';

type RegisteredTool = AppTool & {
  initialRoles?: UserRole[];
};

export const featuredBanner = {
  eyebrow: '今日推荐',
  title: '把工具、游戏和成长任务收进一个轻量移动入口',
  description: '先把高频刚需能力做好，再逐步扩展更多可玩和可用的体验模块。',
  actionLabel: '查看热门内容',
};

const registeredTools = featureRegistry as RegisteredTool[];

export const appTools: AppTool[] = registeredTools.map(({ initialRoles: _initialRoles, ...tool }) => tool);

export const initialToolRoles = new Map(
  registeredTools.map((tool) => [tool.id, tool.initialRoles ?? ['admin']] as const),
);

export const popularGames: GameItem[] = [
  {
    id: 'snake-brawl',
    name: '贪吃蛇大作战',
    genre: '休闲街机',
    tag: '可玩',
    description: '经典、无尽、闯关三种模式，支持方向键和移动端按键控制。',
    accentColor: '#20c997',
    route: '/games/snake-brawl',
    status: 'playable',
  },
  {
    id: 'gomoku',
    name: '五子棋人机对战',
    genre: '策略棋类',
    tag: '三档 AI',
    description: '15×15 自由五子棋，支持轻松、进阶和高手难度，以及悔棋与比分记录。',
    accentColor: '#cf794a',
    route: '/games/gomoku',
    status: 'playable',
  },
  {
    id: 'tetris',
    name: '俄罗斯方块',
    genre: '经典消除',
    tag: '可玩',
    description: '支持方块暂存、落点投影、软降与硬降，用连续消行刷新最高分。',
    accentColor: '#4b6bff',
    route: '/games/tetris',
    status: 'playable',
  },
  {
    id: 'brick-breaker',
    name: '打砖块',
    genre: '休闲街机',
    tag: '道具连击',
    description: '三条生命挑战渐进关卡，接住穿透、多球和加宽道具打出高连击。',
    accentColor: '#ff7466',
    route: '/games/brick-breaker',
    status: 'playable',
  },
  {
    id: 'xiangqi',
    name: '象棋',
    genre: '传统棋类',
    tag: '双模式',
    description: '标准中国象棋，支持三档人机对战与好友实时对局，含悔棋、提示一手和棋谱记录。',
    accentColor: '#d98a3d',
    route: '/games/xiangqi',
    status: 'playable',
  },
  {
    id: 'brain-challenge',
    name: '脑力挑战',
    genre: '益智闯关',
    tag: '新游',
    description: '拼图和记忆玩法原型位，后续可扩展成关卡型轻游戏。',
    accentColor: '#ff8a5b',
    route: '/games/brain-challenge',
    status: 'coming-soon',
  },
  {
    id: 'speed-racer',
    name: '极速冲刺',
    genre: '即时竞速',
    tag: '预告',
    description: '保留竞速类游戏位，用于后续补充更强节奏感的玩法。',
    accentColor: '#4f7cff',
    route: '/games/speed-racer',
    status: 'coming-soon',
  },
];

export function getToolById(toolId: ToolId) {
  return appTools.find((tool) => tool.id === toolId);
}

export function getGameById(gameId: string) {
  return popularGames.find((game) => game.id === gameId);
}
