import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecommendationRequest,
  filterLinksByPlatform,
  formatPrice,
  formatPriceSource,
  getPlatformLabel,
  summarizeRequest,
} from '../lib/product-recommendation.ts';

test('buildRecommendationRequest maps selection to API payload', () => {
  const request = buildRecommendationRequest({
    query: '想买手机，预算 3000 左右',
    category: 'phone',
    budgetMin: 2000,
    budgetMax: 3000,
    brands: ['小米'],
    scenarios: ['游戏', '续航'],
    platforms: ['jd', 'pdd'],
  });
  assert.equal(request.category, 'phone');
  assert.equal(request.budgetMin, 2000);
  assert.equal(request.budgetMax, 3000);
  assert.deepEqual(request.brands, ['小米']);
  assert.deepEqual(request.scenarios, ['游戏', '续航']);
  assert.deepEqual(request.platforms, ['jd', 'pdd']);
});

test('formatPrice uses Chinese number grouping', () => {
  assert.equal(formatPrice(2499), '¥2,499');
  assert.equal(formatPrice(5999), '¥5,999');
});

test('formatPriceSource keeps a short reference label', () => {
  assert.equal(formatPriceSource('curated:2026-08-01'), '参考价 · 08-01');
  assert.equal(formatPriceSource('unknown'), '参考价');
});

test('getPlatformLabel returns Chinese labels', () => {
  assert.equal(getPlatformLabel('jd'), '京东');
  assert.equal(getPlatformLabel('taobao'), '淘宝');
  assert.equal(getPlatformLabel('pdd'), '拼多多');
});

test('filterLinksByPlatform keeps only requested platforms', () => {
  const links = [
    { platform: 'jd', label: '京东', url: 'https://jd.example' },
    { platform: 'taobao', label: '淘宝', url: 'https://taobao.example' },
    { platform: 'pdd', label: '拼多多', url: 'https://pdd.example' },
  ];
  assert.deepEqual(
    filterLinksByPlatform(links, ['taobao']).map((link) => link.platform),
    ['taobao'],
  );
  assert.deepEqual(filterLinksByPlatform(links, []), links);
});

test('summarizeRequest prefers natural language query', () => {
  const request = buildRecommendationRequest({
    query: '想买手机，预算 3000 左右',
    category: 'phone',
    budgetMin: 2000,
    budgetMax: 3000,
    brands: [],
    scenarios: [],
    platforms: [],
  });
  assert.equal(summarizeRequest(request), '想买手机，预算 3000 左右');
});
