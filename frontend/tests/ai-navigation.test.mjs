import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AI_COUNTRIES,
  AI_PRODUCTS,
  filterAiProducts,
  getAiCountryProductCount,
} from '../lib/ai-navigation.ts';

test('defines fourteen unique HTTPS AI entrances', () => {
  assert.equal(AI_PRODUCTS.length, 14);
  assert.ok(AI_PRODUCTS.every((product) => product.url.startsWith('https://')));
  assert.equal(new Set(AI_PRODUCTS.map((product) => product.id)).size, AI_PRODUCTS.length);
});

test('groups products into the expected country counts', () => {
  assert.deepEqual(
    AI_COUNTRIES.map((country) => [country.id, getAiCountryProductCount(country.id)]),
    [
      ['cn', 6],
      ['us', 6],
      ['fr', 1],
      ['ca', 1],
    ],
  );
});

test('filters by country and product category', () => {
  const results = filterAiProducts({ categoryId: 'coding', countryId: 'cn' });

  assert.deepEqual(
    results.map((product) => product.id),
    ['qwen', 'deepseek', 'chatglm'],
  );
});

test('searches across product, company, domain and description', () => {
  assert.deepEqual(
    filterAiProducts({ categoryId: 'all', query: 'Anthropic' }).map((product) => product.id),
    ['claude'],
  );
  assert.deepEqual(
    filterAiProducts({ categoryId: 'all', query: '长文本' }).map((product) => product.id),
    ['kimi'],
  );
});

test('filters favorites without changing display order', () => {
  const results = filterAiProducts({
    categoryId: 'all',
    favoriteIds: ['grok', 'doubao', 'claude'],
    favoritesOnly: true,
  });

  assert.deepEqual(
    results.map((product) => product.id),
    ['doubao', 'claude', 'grok'],
  );
});
