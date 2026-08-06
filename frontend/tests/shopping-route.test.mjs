import assert from 'node:assert/strict';
import test from 'node:test';

import {
  routeCompletenessLabel,
  routeStopNames,
  sourceLabel,
  zoneTypeLabel,
} from '../lib/shopping-route.ts';

test('zone and source labels are readable', () => {
  assert.equal(zoneTypeLabel('produce'), '蔬菜水果');
  assert.equal(zoneTypeLabel('unknown'), '其他');
  assert.equal(sourceLabel('openfoodfacts'), 'Open Food Facts');
  assert.equal(sourceLabel('cooking-guide'), '菜谱导入');
});

test('route completeness never fabricates distance or time', () => {
  const partial = {
    status: 'active',
    completeness: 0.75,
    unmappedCount: 1,
  };
  assert.equal(
    routeCompletenessLabel(partial),
    '75% 已归位 · 1 项未归位',
  );
  assert.equal(routeCompletenessLabel(undefined), '未生成路线');
});

test('route stop names follow real zone order', () => {
  const route = {
    zones: [
      { zone: { id: 'z1', name: '蔬菜区' } },
      { zone: { id: 'z2', name: '冷藏区' } },
    ],
  };
  assert.deepEqual(routeStopNames(route), ['蔬菜区', '冷藏区']);
});
