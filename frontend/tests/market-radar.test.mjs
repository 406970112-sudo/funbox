import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  MARKET_CATEGORIES,
  MARKET_PERIODS,
  MARKET_SECTORS,
  buildMarketChartPoints,
  getMarketPulse,
  getMarketSector,
  getRankedMarketSectors,
} from '../lib/market-radar.ts';

test('defines stable unique market categories, periods and sectors', () => {
  assert.deepEqual(
    MARKET_CATEGORIES.map((category) => category.id),
    ['global', 'ai', 'metals'],
  );
  assert.deepEqual(
    MARKET_PERIODS.map((period) => period.id),
    ['1d', '5d', '20d'],
  );
  assert.equal(new Set(MARKET_SECTORS.map((sector) => sector.id)).size, MARKET_SECTORS.length);
});

test('ranks AI sectors by the selected one-day performance without mutating fixtures', () => {
  const fixtureOrder = MARKET_SECTORS.map((sector) => sector.id);

  assert.deepEqual(
    getRankedMarketSectors('ai', '1d').map((sector) => sector.id),
    ['cpo', 'storage', 'semiconductor', 'ai-compute', 'cloud'],
  );
  assert.deepEqual(
    MARKET_SECTORS.map((sector) => sector.id),
    fixtureOrder,
  );
});

test('changes ranking when the selected performance window changes', () => {
  assert.deepEqual(
    getRankedMarketSectors('ai', '20d').map((sector) => sector.id),
    ['ai-compute', 'cpo', 'semiconductor', 'storage', 'cloud'],
  );
});

test('summarizes the AI snapshot into a deterministic market pulse', () => {
  assert.deepEqual(getMarketPulse('ai', '1d'), {
    advancing: 5,
    declining: 0,
    score: 86,
    state: '强势',
    strongestSectorId: 'cpo',
  });
});

test('returns full sector detail and handles an unknown sector', () => {
  const sector = getMarketSector('ai-compute');

  assert.equal(sector?.name, 'AI 算力');
  assert.equal(sector?.drivers.length, 3);
  assert.deepEqual(
    sector?.constituents.map((constituent) => constituent.name),
    ['英伟达', '台积电', '博通'],
  );
  assert.equal(getMarketSector('missing-sector'), undefined);
});

test('registers market radar as an available tool for every app role', async () => {
  const registryUrl = new URL('../../backend/internal/access/feature_registry.json', import.meta.url);
  const registry = JSON.parse(await readFile(registryUrl, 'utf8'));
  const marketRadar = registry.find((tool) => tool.id === 'market-radar');

  assert.deepEqual(
    {
      initialRoles: marketRadar?.initialRoles,
      route: marketRadar?.route,
      status: marketRadar?.status,
    },
    {
      initialRoles: ['normal', 'vip', 'svip', 'admin'],
      route: '/tools/market-radar',
      status: 'available',
    },
  );
});

test('maps market series into bounded chart coordinates, including flat data', () => {
  assert.deepEqual(buildMarketChartPoints([0, 10, 5], 100, 40), [
    { x: 0, y: 40 },
    { x: 50, y: 0 },
    { x: 100, y: 20 },
  ]);
  assert.deepEqual(buildMarketChartPoints([7, 7, 7], 100, 40), [
    { x: 0, y: 20 },
    { x: 50, y: 20 },
    { x: 100, y: 20 },
  ]);
  assert.deepEqual(buildMarketChartPoints([], 100, 40), []);
});
