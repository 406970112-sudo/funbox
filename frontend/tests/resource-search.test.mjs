import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDefaultResourceSearchSourceIds,
  getResourceSearchQueue,
  groupResourceSearchSources,
  normalizeResourceSearchQuery,
  RESOURCE_SEARCH_CATEGORIES,
} from '../lib/resource-search.ts';

const sources = [
  {
    adapterKey: 'laoer_sse',
    cacheTtlMs: 120000,
    category: '网盘',
    defaultSelected: true,
    description: '免费网盘资源搜索',
    domain: 'laoer.motewan.com',
    enabled: true,
    id: 'laoer-motewan',
    logo: 'L2',
    logoBackground: '#fff6d9',
    logoColor: '#a66d00',
    maxResults: 20,
    mode: 'aggregate',
    name: '老二搜索',
    sortOrder: 1,
    timeoutMs: 12000,
    updatedAt: '2026-08-02T00:00:00Z',
    url: 'https://laoer.motewan.com/',
  },
  {
    adapterKey: 'homepage_only',
    cacheTtlMs: 120000,
    category: '网盘',
    defaultSelected: true,
    description: '综合网盘资源',
    domain: 'quarkpanso.com',
    enabled: true,
    id: 'quark-pan-search',
    logo: 'QP',
    logoBackground: '#e7ebff',
    logoColor: '#4b6bff',
    maxResults: 20,
    mode: 'direct',
    name: '夸克盘搜',
    sortOrder: 2,
    timeoutMs: 12000,
    updatedAt: '2026-08-02T00:00:00Z',
    url: 'https://www.quarkpanso.com/',
  },
  {
    adapterKey: 'homepage_only',
    cacheTtlMs: 120000,
    category: '影视',
    defaultSelected: false,
    description: '影视内容检索',
    domain: 'tvso.uk',
    enabled: false,
    id: 'tvso',
    logo: 'TV',
    logoBackground: '#fff0e7',
    logoColor: '#e46c2e',
    maxResults: 20,
    mode: 'direct',
    name: 'TV 搜',
    sortOrder: 3,
    timeoutMs: 12000,
    updatedAt: '2026-08-02T00:00:00Z',
    url: 'https://www.tvso.uk/',
  },
];

test('normalizes surrounding and repeated whitespace', () => {
  assert.equal(normalizeResourceSearchQuery('  流浪地球   2  '), '流浪地球 2');
});

test('default source ids come from real config order and defaultSelected', () => {
  assert.deepEqual(getDefaultResourceSearchSourceIds(sources), ['laoer-motewan', 'quark-pan-search']);
});

test('queue returns selected enabled sources in stable display order', () => {
  const queue = getResourceSearchQueue(sources, ['quark-pan-search', 'laoer-motewan', 'tvso']);

  assert.deepEqual(
    queue.map((source) => source.id),
    ['laoer-motewan', 'quark-pan-search'],
  );
});

test('groups sources by category with configured category order', () => {
  const groups = groupResourceSearchSources(sources);

  assert.deepEqual(
    groups.map((group) => group.category),
    ['网盘', '影视'],
  );
  assert.deepEqual(
    groups[0].items.map((source) => source.id),
    ['laoer-motewan', 'quark-pan-search'],
  );
  assert.ok(RESOURCE_SEARCH_CATEGORIES.includes('网盘'));
});
