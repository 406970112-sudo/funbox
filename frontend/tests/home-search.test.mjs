import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  getHomeSearchSlice,
  getQuickSearchEntries,
  searchHomeEntries,
  splitHighlight,
} from '../lib/home-search.ts';

const require = createRequire(import.meta.url);
const featureRegistry = require('../../backend/internal/access/feature_registry.json');

const tools = [
  {
    id: 'ai-navigation',
    name: 'AI 导航',
    tagline: '全球主流 AI 官方入口',
    description: '查找主流 AI 产品并直达官网',
    category: 'AI',
    badges: ['全球 AI'],
    route: '/tools/ai-navigation',
    icon: 'orbit',
    accentColor: '#4b6bff',
    usageLabel: '开始探索',
    status: 'available',
  },
  {
    id: 'hot-news',
    name: '热点速览',
    tagline: '每日 AI 简报与多源追踪',
    description: '聚合真实 RSS 新闻并生成 AI 摘要',
    category: 'AI',
    badges: ['真实来源', 'AI 摘要'],
    route: '/tools/hot-news',
    icon: 'newspaper-variant-multiple-outline',
    accentColor: '#4b6bff',
    usageLabel: '查看今日热点',
    status: 'available',
  },
  {
    id: 'qr-code',
    name: '二维码生成器',
    tagline: '实时生成与导出',
    description: '支持链接、文本和 Wi-Fi 二维码',
    category: '效率',
    badges: ['离线可用'],
    route: '/tools/qr-code',
    icon: 'qrcode',
    accentColor: '#1f6b5d',
    usageLabel: '立即生成',
    status: 'available',
  },
  {
    id: 'image-cleanup',
    name: '一键抠图',
    tagline: '图片处理',
    description: '常用素材处理入口已预留',
    category: '多媒体',
    badges: ['预留'],
    route: '/tools/image-cleanup',
    icon: 'image-filter-center-focus',
    accentColor: '#c56b47',
    usageLabel: '查看规划',
    status: 'coming-soon',
  },
];

const games = [
  {
    id: 'xiangqi',
    name: '中国象棋',
    genre: '传统棋类',
    tag: '双模式',
    description: '标准中国象棋，支持人机对弈与好友对局',
    accentColor: '#d98a3d',
    route: '/games/xiangqi',
    status: 'playable',
  },
  {
    id: 'gomoku',
    name: '五子棋人机对战',
    genre: '策略棋类',
    tag: '三档 AI',
    description: '15×15 自由五子棋，支持三档 AI',
    accentColor: '#cf794a',
    route: '/games/gomoku',
    status: 'playable',
  },
  {
    id: 'brain-challenge',
    name: '脑力挑战',
    genre: '益智闯关',
    tag: '新游',
    description: '拼图和记忆玩法原型',
    accentColor: '#ff8a5b',
    route: '/games/brain-challenge',
    status: 'coming-soon',
  },
];

test('returns an empty result list for an empty query', () => {
  assert.deepEqual(searchHomeEntries(tools, games, '  '), []);
});

test('ranks name prefix matches above description matches', () => {
  const result = searchHomeEntries(tools, games, 'AI');
  assert.deepEqual(
    result.map((entry) => entry.id),
    ['ai-navigation', 'hot-news', 'gomoku'],
  );
});

test('matches tool keywords with fuzzy terms like 大转盘 and 抽奖', () => {
  const keywordTools = [
    ...tools,
    {
      id: 'who-does-it',
      name: '谁来干',
      tagline: '大转盘随机抽人',
      description: '圆形转盘随机抽人',
      category: '生活',
      badges: ['随机抽取', '真实记录'],
      keywords: ['大转盘', '转盘', '抽奖', '抽签', '随机选人', '谁来干'],
      route: '/tools/who-does-it',
      icon: 'refresh',
      accentColor: '#ff6b8f',
      usageLabel: '开始抽人',
      status: 'available',
    },
  ];
  for (const query of ['大转盘', '抽奖', '抽签', '随机选人', '谁来干']) {
    const result = searchHomeEntries(keywordTools, games, query);
    assert.equal(result.some((entry) => entry.id === 'who-does-it'), true, `${query} 应命中`);
  }
});

test('mixes tools and games and keeps match rank stable', () => {
  const result = searchHomeEntries(tools, games, '棋');
  assert.deepEqual(
    result.map((entry) => entry.id),
    ['xiangqi', 'gomoku'],
  );
});

test('uses real usage to break ties inside the same match tier', () => {
  const usage = [
    { toolId: 'ai-navigation', clickCount: 3, lastClickedAt: 3000 },
    { toolId: 'hot-news', clickCount: 9, lastClickedAt: 9000 },
  ];
  const result = searchHomeEntries(tools, games, 'AI', usage);
  assert.deepEqual(
    result.map((entry) => entry.id),
    ['ai-navigation', 'hot-news', 'gomoku'],
  );

  const descriptionQuery = searchHomeEntries(tools, games, '入口');
  assert.deepEqual(
    descriptionQuery.map((entry) => entry.id),
    ['ai-navigation', 'image-cleanup'],
  );
});

test('slices panel results to five rows', () => {
  const entries = searchHomeEntries(tools, games, 'AI');
  assert.equal(entries.length, 3);
  assert.deepEqual(
    getHomeSearchSlice(entries).map((entry) => entry.id),
    entries.map((entry) => entry.id),
  );
  assert.deepEqual(getHomeSearchSlice(entries, 1).map((entry) => entry.id), ['ai-navigation']);
});

test('builds quick access entries from real recent usage', () => {
  const recentUsage = [
    { itemId: 'gomoku', kind: 'game', usedAt: 5000 },
    { itemId: 'ai-navigation', kind: 'tool', usedAt: 4000 },
    { itemId: 'missing-tool', kind: 'tool', usedAt: 3000 },
  ];
  assert.deepEqual(
    getQuickSearchEntries(tools, games, recentUsage).map((entry) => entry.id),
    ['gomoku', 'ai-navigation'],
  );
});

test('splits highlighted keyword segments case-insensitively', () => {
  assert.deepEqual(splitHighlight('AI 导航', 'ai'), [
    { text: 'AI', match: true },
    { text: ' 导航', match: false },
  ]);
  assert.deepEqual(splitHighlight('中国象棋', '棋'), [
    { text: '中国象', match: false },
    { text: '棋', match: true },
  ]);
  assert.deepEqual(splitHighlight('二维码生成器', ''), [
    { text: '二维码生成器', match: false },
  ]);
});

test('real registry search only returns available, visible entries', () => {
  const realTools = featureRegistry.filter(
    (entry) =>
      entry.route.startsWith('/tools/') &&
      entry.status === 'available' &&
      !entry.hiddenFromList,
  );
  const realGames = featureRegistry.filter(
    (entry) => entry.route.startsWith('/games/') && entry.status === 'playable',
  );
  const ids = new Set([
    ...realTools.map((entry) => entry.id),
    ...realGames.map((entry) => entry.id),
  ]);

  for (const query of ['AI', '棋', '压缩', '记分', '阅读']) {
    const result = searchHomeEntries(realTools, realGames, query);
    for (const entry of result) {
      assert.equal(ids.has(entry.id), true, `${query} 命中不存在的 ${entry.id}`);
    }
    assert.equal(new Set(result.map((entry) => `${entry.kind}:${entry.id}`)).size, result.length);
  }
});
