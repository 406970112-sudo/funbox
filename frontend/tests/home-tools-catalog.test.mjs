import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HOME_ALL_CATEGORY,
  HOME_RECENT_TOOL_LIMIT,
  HOME_TOOLS_VISIBLE_LIMIT,
  canExpandToolGrid,
  filterMergedTools,
  getMergedToolCategories,
  getRecentToolIds,
  getToolGridExpandLabel,
  getToolGridSlice,
} from '../lib/home-tools-catalog.ts';

const tools = [
  {
    id: 'free-reading',
    name: '免费阅读',
    tagline: '正版书城与本地阅读',
    description: '浏览正版免费小说并管理个人书架',
    category: '阅读',
    badges: ['正版内容', '本地导入'],
  },
  {
    id: 'text-to-speech',
    name: '文字转语音',
    tagline: '现有能力已接入',
    description: '输入文案选择音色并生成配音文件',
    category: '音频',
    badges: ['高频', '可用'],
  },
  {
    id: 'smart-translation',
    name: '智能翻译',
    tagline: 'AI 语境增强翻译',
    description: '自动识别并生成多版本译文',
    category: 'AI',
    badges: ['多语言'],
  },
  {
    id: 'ai-navigation',
    name: 'AI 导航',
    tagline: '全球主流 AI 官方入口',
    description: '查找主流 AI 产品并直达官网',
    category: 'AI',
    badges: ['全球 AI'],
  },
  {
    id: 'market-radar',
    name: '市场雷达',
    tagline: '板块强弱与趋势洞察',
    description: '查看板块强弱与驱动原因',
    category: '行情',
    badges: ['趋势'],
  },
  {
    id: 'qr-code',
    name: '二维码',
    tagline: '实时生成与导出',
    description: '支持链接、文本和 Wi-Fi 二维码',
    category: '效率',
    badges: ['离线可用'],
  },
  {
    id: 'image-compressor',
    name: '图片压缩',
    tagline: 'TinyPNG 批量压缩',
    description: '批量压缩 JPG、PNG 和 WebP',
    category: '多媒体',
    badges: ['批量处理'],
  },
];

test('keeps the merged tool categories in registry order without duplicates', () => {
  assert.deepEqual(getMergedToolCategories(tools), ['阅读', '音频', 'AI', '行情', '效率', '多媒体']);
});

test('filters tools by category and search query together', () => {
  assert.deepEqual(
    filterMergedTools(tools, 'AI', '').map((tool) => tool.id),
    ['smart-translation', 'ai-navigation'],
  );
  assert.deepEqual(
    filterMergedTools(tools, HOME_ALL_CATEGORY, '压缩').map((tool) => tool.id),
    ['image-compressor'],
  );
  assert.deepEqual(
    filterMergedTools(tools, HOME_ALL_CATEGORY, '翻译').map((tool) => tool.id),
    ['smart-translation'],
  );
  assert.deepEqual(filterMergedTools(tools, '阅读', '音频'), []);
});

test('shows two rows by default and expands to the full catalog', () => {
  assert.equal(HOME_TOOLS_VISIBLE_LIMIT, 6);
  assert.deepEqual(
    getToolGridSlice(tools, false).map((tool) => tool.id),
    tools.slice(0, 6).map((tool) => tool.id),
  );
  assert.deepEqual(
    getToolGridSlice(tools, true).map((tool) => tool.id),
    tools.map((tool) => tool.id),
  );
  assert.equal(canExpandToolGrid(tools), true);
  assert.equal(getToolGridExpandLabel(tools, false), '展开全部 1 个');
  assert.equal(getToolGridExpandLabel(tools, true), '收起工具');
});

test('hides the expand action when the category fits in two rows', () => {
  const aiTools = tools.filter((tool) => tool.category === 'AI');
  assert.equal(canExpandToolGrid(aiTools), false);
  assert.equal(getToolGridExpandLabel(aiTools, false), '展开全部 0 个');
  assert.deepEqual(getToolGridSlice(aiTools, false), aiTools);
});

test('selects the most recently used eligible tools', () => {
  const usage = [
    { toolId: 'qr-code', clickCount: 5, lastClickedAt: 1000 },
    { toolId: 'text-to-speech', clickCount: 8, lastClickedAt: 3000 },
    { toolId: 'free-reading', clickCount: 2, lastClickedAt: 2000 },
    { toolId: 'missing-tool', clickCount: 9, lastClickedAt: 9000 },
  ];

  assert.deepEqual(getRecentToolIds(tools.map((tool) => tool.id), usage), [
    'text-to-speech',
    'free-reading',
    'qr-code',
  ]);
  assert.equal(HOME_RECENT_TOOL_LIMIT, 4);
  assert.deepEqual(getRecentToolIds(tools.map((tool) => tool.id), []), []);
});
