import assert from 'node:assert/strict';
import test from 'node:test';

import { getDoubleColorBallHubPalette } from '../features/tools/double-color-ball-hub-theme.ts';

test('dark mode returns dark surfaces for every hub card', () => {
  const palette = getDoubleColorBallHubPalette('dark');

  assert.deepEqual(palette, {
    reference: {
      background: '#151b20',
      border: '#29323b',
      iconBackground: '#34242b',
    },
    labV2: {
      background: '#151d2b',
      border: '#2b4267',
      iconBackground: '#1d3153',
    },
    labV1: {
      background: '#211c14',
      border: '#4b3a21',
      iconBackground: '#302514',
    },
  });
});

test('light mode preserves the existing card accents', () => {
  const palette = getDoubleColorBallHubPalette('light');

  assert.deepEqual(palette, {
    reference: {
      background: '#ffffff',
      border: '#dde6fb',
      iconBackground: '#fff0f3',
    },
    labV2: {
      background: '#f5f8ff',
      border: '#c7d6ff',
      iconBackground: '#e8edff',
    },
    labV1: {
      background: '#fffaf0',
      border: '#f0d9b0',
      iconBackground: '#fff7e8',
    },
  });
});
