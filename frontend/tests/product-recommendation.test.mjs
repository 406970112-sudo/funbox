import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRecommendationRequest,
  CATEGORY_OPTIONS,
  countActiveFilters,
  emptyFilter,
  filterRecommendationItems,
  filterLinksByPlatform,
  formatPrice,
  formatPriceSource,
  getPlatformLabel,
  sortRecommendationItems,
  summarizeRequest,
} from '../lib/product-recommendation.ts';

test('CATEGORY_OPTIONS includes large appliances', () => {
  assert.equal(CATEGORY_OPTIONS.find((option) => option.id === 'large-appliance')?.label, '大家电');
});

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

test('filterRecommendationItems applies budget, brand, scenario and platform', () => {
  const items = [
    {
      productId: 'a',
      name: 'Redmi K80',
      brand: 'Redmi',
      fitScore: 90,
      referencePrice: 2499,
      priceSource: 'curated',
      reasons: [{ label: '续航', text: '6550mAh' }],
      suitableFor: '适合游戏用户',
      specs: { battery: '6550mAh' },
      links: [{ platform: 'jd', label: '京东', url: 'https://jd.example' }],
    },
    {
      productId: 'b',
      name: '一加 13T',
      brand: '一加',
      fitScore: 88,
      referencePrice: 3099,
      priceSource: 'curated',
      reasons: [{ label: '性能', text: '骁龙 8 Elite' }],
      suitableFor: '适合游戏用户',
      specs: { chip: '骁龙 8 Elite' },
      links: [
        { platform: 'taobao', label: '淘宝', url: 'https://taobao.example' },
        { platform: 'pdd', label: '拼多多', url: 'https://pdd.example' },
      ],
    },
  ];
  const filtered = filterRecommendationItems(items, {
    budgetRange: { min: 2000, max: 3000 },
    brands: [],
    scenarios: ['游戏'],
    platforms: ['jd'],
  });
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].productId, 'a');
});

test('filterRecommendationItems hides products without selected platform link', () => {
  const items = [
    {
      productId: 'a',
      name: 'Redmi K80',
      brand: 'Redmi',
      fitScore: 90,
      referencePrice: 2499,
      priceSource: 'curated',
      reasons: [],
      suitableFor: '',
      specs: {},
      links: [{ platform: 'jd', label: '京东', url: 'https://jd.example' }],
    },
  ];
  assert.equal(
    filterRecommendationItems(items, { brands: [], scenarios: [], platforms: ['taobao'] }).length,
    0,
  );
});

test('sortRecommendationItems sorts by price or fit score', () => {
  const items = [
    { productId: 'a', name: 'A', brand: 'A', fitScore: 80, referencePrice: 3000, priceSource: 'x', reasons: [], suitableFor: '', specs: {}, links: [] },
    { productId: 'b', name: 'B', brand: 'B', fitScore: 95, referencePrice: 2000, priceSource: 'x', reasons: [], suitableFor: '', specs: {}, links: [] },
  ];
  assert.equal(sortRecommendationItems(items, 'price-asc')[0].productId, 'b');
  assert.equal(sortRecommendationItems(items, 'fit')[0].productId, 'b');
});

test('countActiveFilters counts selected conditions', () => {
  assert.equal(countActiveFilters(emptyFilter()), 0);
  assert.equal(
    countActiveFilters({ budgetRange: { min: 1000, max: 2000, label: '1000-2000' }, brands: ['小米'], scenarios: [], platforms: ['jd'] }),
    3,
  );
});
