import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyPageLoadResult,
  getMinLoadingDelayMs,
  isPageLoadTimeout,
} from '../lib/page-load-state.ts';

test('classifies real data as ready', () => {
  assert.deepEqual(classifyPageLoadResult({ items: [1, 2, 3] }), {
    data: { items: [1, 2, 3] },
    state: 'ready',
  });
});

test('classifies null and undefined as empty, never as mock data', () => {
  assert.deepEqual(classifyPageLoadResult(null), { data: null, state: 'empty' });
  assert.deepEqual(classifyPageLoadResult(undefined), { data: null, state: 'empty' });
});

test('keeps the minimum loading window short enough for fast real data', () => {
  assert.equal(getMinLoadingDelayMs(100, 350), 250);
  assert.equal(getMinLoadingDelayMs(350, 350), 0);
  assert.equal(getMinLoadingDelayMs(700, 350), 0);
});

test('detects the 8 second timeout boundary', () => {
  const startedAt = 1_000;
  assert.equal(isPageLoadTimeout(9_000, startedAt, 8_000), true);
  assert.equal(isPageLoadTimeout(8_999, startedAt, 8_000), false);
  assert.equal(isPageLoadTimeout(10_000, startedAt, 8_000), true);
});
