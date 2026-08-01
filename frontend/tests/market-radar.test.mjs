import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildMarketChartPoints,
  getMarketPulse,
  getMarketSector,
  getRankedMarketSectors,
} from '../lib/market-radar.ts';
import {
  MarketRadarAPIError,
  fetchMarketRadarSnapshot,
  getMarketRadarErrorMessage,
} from '../lib/market-radar-api.ts';

const aiSector = {
  anomaly: '近5日上涨8.00%，同类板块最强',
  categoryIds: ['global', 'ai'],
  changes: { '1d': 3.2, '5d': 8, '20d': 18 },
  constituents: [
    { change: 4.8, code: '601138', name: '工业富联', weight: 53 },
    { change: 4.4, code: '300308', name: '中际旭创', weight: 47 },
  ],
  id: 'BK1134',
  indicator: { advancing: 2, amount: 311939554793, close: 1764.6, coverage: 2, declining: 0, turnover: 2.88 },
  methodology: '东方财富公开板块行情 · 日K收盘价区间收益 · 成分按流通市值权重',
  name: '算力概念',
  series: [100, 101, 102, 103, 104, 105],
};

const metalsSector = {
  categoryIds: ['global', 'metals'],
  changes: { '1d': 1, '5d': 2, '20d': 9 },
  constituents: [{ change: 4.1, code: '600547', name: '山东黄金', weight: 100 }],
  id: 'BK0732',
  indicator: { advancing: 1, amount: 123456789, close: 2000, coverage: 1, declining: 0, turnover: 1.2 },
  methodology: '东方财富公开板块行情 · 日K收盘价区间收益 · 成分按流通市值权重',
  name: '贵金属',
  series: [100, 101, 102],
};

function makeSnapshot(overrides = {}) {
  const pulse = (score) => ({
    advancing: 1,
    declining: 0,
    score,
    state: score >= 80 ? '强势' : '偏强',
    strongestSectorId: 'BK1134',
  });
  return {
    categories: [
      { id: 'global', label: '全球' },
      { id: 'ai', label: 'AI' },
      { id: 'metals', label: '有色' },
    ],
    coverage: { loaded: 2, requested: 10 },
    fetchedAt: '2026-07-31T09:41:00+08:00',
    periods: [
      { id: '1d', label: '1日' },
      { id: '5d', label: '5日' },
      { id: '20d', label: '20日' },
    ],
    pulses: {
      global: { '1d': pulse(100), '5d': pulse(100), '20d': pulse(100) },
      ai: { '1d': pulse(100), '5d': pulse(100), '20d': pulse(100) },
      metals: { '1d': pulse(100), '5d': pulse(100), '20d': pulse(100) },
    },
    sectors: [aiSector, metalsSector],
    source: 'eastmoney',
    sourceUrl: 'https://quote.eastmoney.com',
    stale: false,
    ...overrides,
  };
}

test('ranks sectors from an API snapshot without mutating it', () => {
  const snapshot = makeSnapshot();
  const original = JSON.parse(JSON.stringify(snapshot));

  assert.deepEqual(
    getRankedMarketSectors(snapshot, 'global', '1d').map((sector) => sector.id),
    ['BK1134', 'BK0732'],
  );
  assert.deepEqual(snapshot, original);
});

test('reads pulse and full sector detail from the snapshot', () => {
  const snapshot = makeSnapshot();
  const pulse = getMarketPulse(snapshot, 'ai', '1d');
  assert.equal(pulse.strongestSectorId, 'BK1134');
  assert.equal(getMarketSector(snapshot, 'BK0732')?.name, '贵金属');
  assert.equal(getMarketSector(snapshot, 'missing-sector'), undefined);
});

test('requests a forced backend refresh', async () => {
  const snapshot = makeSnapshot();
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify(snapshot), { status: 200 });
  };
  try {
    const result = await fetchMarketRadarSnapshot(undefined, true, 'http://127.0.0.1:3000');
    assert.equal(result.source, 'eastmoney');
    assert.equal(requestedUrl, 'http://127.0.0.1:3000/api/v1/market-radar/snapshot?refresh=1');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rejects non-eastmoney payloads', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ source: 'demo', sectors: [] }), { status: 200 });
  try {
    await assert.rejects(
      () => fetchMarketRadarSnapshot(undefined, false, 'http://127.0.0.1:3000'),
      /market_radar_source_invalid/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('preserves backend error codes and maps them to user copy', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: 'market_radar_insufficient_coverage' }), { status: 502 });
  try {
    await assert.rejects(
      () => fetchMarketRadarSnapshot(undefined, false, 'http://127.0.0.1:3000'),
      (error) => {
        assert.ok(error instanceof MarketRadarAPIError);
        assert.equal(error.code, 'market_radar_insufficient_coverage');
        assert.equal(error.status, 502);
        assert.equal(
          getMarketRadarErrorMessage(error),
          '板块数据覆盖不足，请稍后重试。',
        );
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
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
