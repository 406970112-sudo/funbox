import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildPreviewRecommendation,
  filterRecommendationsByVisibility,
  takeRecommendations,
} from '../lib/home-recommendation.ts';

function feature(overrides = {}) {
  return {
    accentColor: '#1f7b63',
    badges: [],
    category: 'AI',
    description: '支持自动识别、场景和风格控制',
    hiddenFromList: false,
    icon: 'translate',
    id: 'smart-translation',
    initialRoles: ['normal', 'vip', 'svip', 'admin'],
    name: '智能翻译',
    route: '/tools/smart-translation',
    status: 'available',
    tagline: 'AI 语境增强翻译',
    usageLabel: '进入工作台',
    ...overrides,
  };
}

test('buildPreviewRecommendation merges real fields with overrides', () => {
  const item = buildPreviewRecommendation(feature(), {
    ctaLabelOverride: '立即开始',
    descriptionOverride: '多人实时记分',
    titleOverride: '今日牌局',
  });
  assert.equal(item.title, '今日牌局');
  assert.equal(item.description, '多人实时记分');
  assert.equal(item.ctaLabel, '立即开始');
  assert.equal(item.kind, 'tool');
  assert.equal(item.route, '/tools/smart-translation');
});

test('buildPreviewRecommendation falls back to registry fields and game CTA', () => {
  const tool = buildPreviewRecommendation(feature(), {});
  assert.equal(tool.title, '智能翻译');
  assert.equal(tool.description, 'AI 语境增强翻译');
  assert.equal(tool.ctaLabel, '进入工作台');

  const game = buildPreviewRecommendation(
    feature({ id: 'snake-brawl', route: '/games/snake-brawl', status: 'playable', usageLabel: '' }),
    {},
  );
  assert.equal(game.kind, 'game');
  assert.equal(game.ctaLabel, '开始游戏');
});

test('filterRecommendationsByVisibility removes inaccessible features', () => {
  const items = [
    { ...buildPreviewRecommendation(feature(), {}), featureId: 'smart-translation' },
    { ...buildPreviewRecommendation(feature({ id: 'qr-code' }), {}), featureId: 'qr-code' },
  ];
  const filtered = filterRecommendationsByVisibility(items, new Set(['smart-translation']));
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].featureId, 'smart-translation');
});

test('takeRecommendations limits to three items', () => {
  const items = [1, 2, 3, 4, 5].map((index) => ({
    ...buildPreviewRecommendation(feature({ id: `f-${index}` }), {}),
    featureId: `f-${index}`,
  }));
  assert.equal(takeRecommendations(items).length, 3);
});
