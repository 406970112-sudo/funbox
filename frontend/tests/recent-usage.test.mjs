import assert from 'node:assert/strict';
import test from 'node:test';

import { addRecentUsage, parseRecentUsage } from '../lib/recent-usage.ts';
import { createRecentUsageStore } from '../lib/recent-usage-store.ts';

test('keeps only the three most recently used items', () => {
  const result = addRecentUsage(
    [
      { kind: 'tool', itemId: 'one', usedAt: 1 },
      { kind: 'tool', itemId: 'two', usedAt: 2 },
      { kind: 'game', itemId: 'three', usedAt: 3 },
    ],
    { kind: 'tool', itemId: 'four', usedAt: 4 },
  );

  assert.deepEqual(
    result.map((item) => `${item.kind}:${item.itemId}`),
    ['tool:four', 'game:three', 'tool:two'],
  );
});

test('moves a repeatedly used item to the front without duplicating it', () => {
  const result = addRecentUsage(
    [
      { kind: 'game', itemId: 'tetris', usedAt: 20 },
      { kind: 'tool', itemId: 'text-to-speech', usedAt: 10 },
    ],
    { kind: 'tool', itemId: 'text-to-speech', usedAt: 30 },
  );

  assert.deepEqual(result, [
    { kind: 'tool', itemId: 'text-to-speech', usedAt: 30 },
    { kind: 'game', itemId: 'tetris', usedAt: 20 },
  ]);
});

test('filters malformed stored values and keeps the newest valid duplicate', () => {
  const result = parseRecentUsage([
    null,
    { kind: 'tool', itemId: '', usedAt: 50 },
    { kind: 'unknown', itemId: 'ignored', usedAt: 40 },
    { kind: 'game', itemId: 'tetris', usedAt: Number.NaN },
    { kind: 'tool', itemId: 'qr-code', usedAt: 10 },
    { kind: 'tool', itemId: 'qr-code', usedAt: 30 },
    { kind: 'game', itemId: 'gomoku', usedAt: 20 },
  ]);

  assert.deepEqual(result, [
    { kind: 'tool', itemId: 'qr-code', usedAt: 30 },
    { kind: 'game', itemId: 'gomoku', usedAt: 20 },
  ]);
  assert.deepEqual(parseRecentUsage({ kind: 'tool', itemId: 'qr-code', usedAt: 30 }), []);
});

test('serializes rapid records without losing the most recent three items', async () => {
  let storedValue = null;
  const store = createRecentUsageStore(
    async () => storedValue,
    async (value) => {
      storedValue = value;
    },
  );

  await Promise.all([
    store.record({ kind: 'tool', itemId: 'one', usedAt: 1 }),
    store.record({ kind: 'tool', itemId: 'two', usedAt: 2 }),
    store.record({ kind: 'game', itemId: 'three', usedAt: 3 }),
    store.record({ kind: 'tool', itemId: 'four', usedAt: 4 }),
  ]);

  assert.deepEqual(await store.get(), [
    { kind: 'tool', itemId: 'four', usedAt: 4 },
    { kind: 'game', itemId: 'three', usedAt: 3 },
    { kind: 'tool', itemId: 'two', usedAt: 2 },
  ]);
  assert.deepEqual(JSON.parse(storedValue), await store.get());
});

test('storage failures degrade safely without rejecting navigation work', async () => {
  const readFailureStore = createRecentUsageStore(
    async () => {
      throw new Error('read failed');
    },
    async () => undefined,
  );
  const writeFailureStore = createRecentUsageStore(
    async () => null,
    async () => {
      throw new Error('write failed');
    },
  );

  assert.deepEqual(await readFailureStore.get(), []);
  assert.deepEqual(
    await writeFailureStore.record({ kind: 'game', itemId: 'gomoku', usedAt: 10 }),
    [{ kind: 'game', itemId: 'gomoku', usedAt: 10 }],
  );
});
