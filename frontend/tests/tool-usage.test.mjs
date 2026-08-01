import assert from 'node:assert/strict';
import test from 'node:test';

import {
  addToolUsage,
  getCommonToolIds,
  parseToolUsage,
} from '../lib/tool-usage.ts';
import { createToolUsageStore } from '../lib/tool-usage-store.ts';

const defaults = ['one', 'two', 'three', 'four', 'five', 'six'];
const eligible = [...defaults, 'seven', 'eight'];

test('uses six defaults before the user opens any tools', () => {
  assert.deepEqual(getCommonToolIds(eligible, [], defaults), defaults);
});

test('ranks clicked tools by count and then by most recent click', () => {
  const usage = [
    { toolId: 'seven', clickCount: 3, lastClickedAt: 10 },
    { toolId: 'eight', clickCount: 3, lastClickedAt: 20 },
    { toolId: 'two', clickCount: 1, lastClickedAt: 30 },
  ];

  assert.deepEqual(getCommonToolIds(eligible, usage, defaults), [
    'eight',
    'seven',
    'two',
    'one',
    'three',
    'four',
  ]);
});

test('ignores unavailable usage and fills empty places from eligible tools', () => {
  const usage = [{ toolId: 'hidden', clickCount: 99, lastClickedAt: 99 }];

  assert.deepEqual(getCommonToolIds(['five', 'six'], usage, defaults), ['five', 'six']);
});

test('increments repeated tool usage without duplicating the tool', () => {
  const result = addToolUsage(
    [{ toolId: 'five', clickCount: 2, lastClickedAt: 10 }],
    'five',
    20,
  );

  assert.deepEqual(result, [{ toolId: 'five', clickCount: 3, lastClickedAt: 20 }]);
});

test('filters malformed stored usage', () => {
  assert.deepEqual(
    parseToolUsage([
      null,
      { toolId: '', clickCount: 1, lastClickedAt: 10 },
      { toolId: 'one', clickCount: 0, lastClickedAt: 20 },
      { toolId: 'two', clickCount: 2, lastClickedAt: 30 },
    ]),
    [{ toolId: 'two', clickCount: 2, lastClickedAt: 30 }],
  );
});

test('serializes rapid click records without losing increments', async () => {
  let storedValue = null;
  const store = createToolUsageStore(
    async () => storedValue,
    async (value) => {
      storedValue = value;
    },
  );

  await Promise.all([
    store.record('five', 10),
    store.record('five', 20),
    store.record('six', 30),
  ]);

  assert.deepEqual(await store.get(), [
    { toolId: 'five', clickCount: 2, lastClickedAt: 20 },
    { toolId: 'six', clickCount: 1, lastClickedAt: 30 },
  ]);
});
