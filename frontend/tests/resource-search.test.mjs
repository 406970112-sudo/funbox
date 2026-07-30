import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_RESOURCE_SEARCH_SOURCE_IDS,
  getResourceSearchQueue,
  normalizeResourceSearchQuery,
  RESOURCE_SEARCH_SOURCES,
} from '../lib/resource-search.ts';

test('normalizes surrounding and repeated whitespace', () => {
  assert.equal(normalizeResourceSearchQuery('  流浪地球   2  '), '流浪地球 2');
});

test('defines five HTTPS search sources', () => {
  assert.equal(RESOURCE_SEARCH_SOURCES.length, 5);
  assert.ok(RESOURCE_SEARCH_SOURCES.every((source) => source.url.startsWith('https://')));
  assert.equal(new Set(RESOURCE_SEARCH_SOURCES.map((source) => source.id)).size, 5);
});

test('uses the first three sources as the default queue', () => {
  const queue = getResourceSearchQueue(DEFAULT_RESOURCE_SEARCH_SOURCE_IDS);

  assert.deepEqual(
    queue.map((source) => source.id),
    ['quark-pan-search', 'panyq', 'tvso'],
  );
});

test('returns selected sources in stable display order without duplicates', () => {
  const queue = getResourceSearchQueue(['yunso', 'panyq', 'yunso']);

  assert.deepEqual(
    queue.map((source) => source.id),
    ['panyq', 'yunso'],
  );
});
