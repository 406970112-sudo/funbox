import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_COMMON_TOOL_IDS,
  FEATURED_CANDIDATE_TOOL_IDS,
  getFeaturedToolIds,
} from '../lib/home-tool-selection.ts';

const registryOrder = [
  'free-reading',
  'card-score',
  'hot-news',
  'release-email-assistant',
  'ai-navigation',
  'market-radar',
  'double-color-ball-hub',
  'text-to-speech',
  'qr-code',
  'image-compressor',
  'resource-search',
  'smart-translation',
];

test('keeps six default common tools and four featured candidates', () => {
  assert.equal(DEFAULT_COMMON_TOOL_IDS.length, 6);
  assert.equal(new Set(DEFAULT_COMMON_TOOL_IDS).size, 6);
  assert.equal(FEATURED_CANDIDATE_TOOL_IDS.length, 4);
});

test('prefers featured candidates in the documented order', () => {
  assert.deepEqual(getFeaturedToolIds(registryOrder, []), [
    'text-to-speech',
    'image-compressor',
    'qr-code',
    'smart-translation',
  ]);
});

test('excludes common tools and fills from registry order', () => {
  const commonTools = [
    'free-reading',
    'card-score',
    'hot-news',
    'ai-navigation',
    'market-radar',
    'double-color-ball-hub',
    'text-to-speech',
  ];

  assert.deepEqual(getFeaturedToolIds(registryOrder, commonTools), [
    'image-compressor',
    'qr-code',
    'smart-translation',
    'release-email-assistant',
  ]);
});

test('never exceeds four featured items or duplicates entries', () => {
  const result = getFeaturedToolIds(
    registryOrder,
    ['text-to-speech', 'image-compressor', 'qr-code', 'smart-translation'],
  );

  assert.equal(result.length, 4);
  assert.equal(new Set(result).size, result.length);
  assert.deepEqual(result, [
    'free-reading',
    'card-score',
    'hot-news',
    'release-email-assistant',
  ]);
});

test('ignores ineligible tools and returns fewer than four', () => {
  assert.deepEqual(getFeaturedToolIds(['image-compressor'], ['text-to-speech']), [
    'image-compressor',
  ]);
});
