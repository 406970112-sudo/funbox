import assert from 'node:assert/strict';
import test from 'node:test';

import { createRealDataCache } from '../lib/real-data-cache-core.ts';

function createMemoryStorage() {
  const values = new Map();
  return {
    async getItem(key) {
      return values.get(key) ?? null;
    },
    async removeItem(key) {
      values.delete(key);
    },
    async setItem(key, value) {
      values.set(key, value);
    },
    peek: () => values,
  };
}

test('reads back a real cached response with its updatedAt timestamp', async () => {
  const storage = createMemoryStorage();
  const cache = createRealDataCache(storage);
  const payload = { news: ['真实热点'], fetchedAt: '2026-08-02T14:00:00Z' };

  await cache.write('hot-news', payload);
  const entry = await cache.read('hot-news', 60_000);

  assert.ok(entry);
  assert.equal(entry.data.news[0], '真实热点');
  assert.equal(typeof entry.updatedAt, 'number');
  assert.ok(entry.updatedAt <= Date.now());
});

test('treats an expired cache entry as missing', async () => {
  const storage = createMemoryStorage();
  const firstCache = createRealDataCache(storage);

  await firstCache.write('market-radar', { sectors: [] });
  const staleEntry = JSON.parse(storage.peek().get('market-radar'));
  staleEntry.updatedAt = Date.now() - 120_000;
  storage.peek().set('market-radar', JSON.stringify(staleEntry));

  const freshCache = createRealDataCache(storage);
  assert.equal(await freshCache.read('market-radar', 60_000), null);
});

test('remove clears both memory and storage', async () => {
  const storage = createMemoryStorage();
  const cache = createRealDataCache(storage);

  await cache.write('reading-shelf', { books: [] });
  await cache.remove('reading-shelf');

  assert.equal(await cache.read('reading-shelf', 60_000), null);
  assert.equal(storage.peek().has('reading-shelf'), false);
});

test('never lets a malformed stored value leak as fake data', async () => {
  const storage = createMemoryStorage();
  const cache = createRealDataCache(storage);
  storage.peek().set('hot-news', '{broken-json');

  assert.equal(await cache.read('hot-news', 60_000), null);
});
