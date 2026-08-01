import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildMarketChartPoints,
  getMarketPulse,
  getMarketSector,
  getRankedMarketSectors,
  getSignalSectors,
  getWatchSectorSummaries,
  searchMarketSectors,
  sortMarketSectors,
} from '../lib/market-radar.ts';
import {
  MarketRadarAPIError,
  fetchMarketRadarSectorDetail,
  fetchMarketRadarSnapshot,
  getMarketRadarErrorMessage,
} from '../lib/market-radar-api.ts';

const aiSector = {
  categoryIds: ['market', 'ai'],
  changes: { '1d': 3.2, '5d': 8, '20d': 18 },
  constituents: [
    { change: 4.8, code: '601138', name: '工业富联', weight: 53, amount: 120000000 },
    { change: 4.4, code: '300308', name: '中际旭创', weight: 47, amount: 90000000 },
  ],
  id: 'BK1134',
  indicator: {
    advancing: 18,
    amount: 311939554793,
    averageAmount: 200000000000,
    averageTurnover: 2.0,
    close: 1764.6,
    coverage: 36,
    declining: 6,
    turnover: 3.1,
  },
  methodology: '东方财富公开板块行情 · 日K收盘价区间收益 · 成分按流通市值权重',
  name: '算力概念',
  series: [100, 101, 102, 103, 104, 105],
};

const manufacturingSector = {
  categoryIds: ['market', 'manufacturing'],
  changes: { '1d': -1.2, '5d': 2, '20d': 9 },
  constituents: [{ change: 4.1, code: '600547', name: '山东黄金', weight: 100, amount: 80000000 }],
  id: 'BK0732',
  indicator: {
    advancing: 12,
    amount: 123456789,
    averageAmount: 150000000,
    averageTurnover: 1.0,
    close: 2000,
    coverage: 24,
    declining: 8,
    turnover: 1.2,
  },
  methodology: '东方财富公开板块行情 · 日K收盘价区间收益 · 成分按流通市值权重',
  name: '贵金属',
  series: [100, 101, 102],
};

function makeSnapshot(overrides = {}) {
  const categories = [
    { id: 'market', label: '全市场' },
    { id: 'ai', label: 'AI科技' },
    { id: 'new-energy', label: '新能源' },
    { id: 'health', label: '医药消费' },
    { id: 'finance', label: '金融地产' },
    { id: 'manufacturing', label: '周期制造' },
    { id: 'themes', label: '热门题材' },
  ];
  const pulse = (score) => ({
    advancing: 1,
    declining: 0,
    score,
    state: score >= 80 ? '强势' : '偏强',
    strongestSectorId: 'BK1134',
  });
  const pulses = {};
  for (const category of categories) {
    pulses[category.id] = { '1d': pulse(100), '5d': pulse(100), '20d': pulse(100) };
  }
  return {
    categories,
    coverage: { loaded: 2, requested: 46 },
    fetchedAt: '2026-08-01T09:41:00+08:00',
    indices: [
      { id: 'sh', name: '上证指数', code: '000001', close: 3832.26, change: 0.72, region: 'A股' },
      { id: 'hsi', name: '恒生指数', code: 'HSI', close: 25884.43, change: 0.1, region: '港股' },
    ],
    periods: [
      { id: '1d', label: '1日' },
      { id: '5d', label: '5日' },
      { id: '20d', label: '20日' },
    ],
    pulses,
    sectors: [aiSector, manufacturingSector],
    signals: [
      {
        id: 'sig-leader-BK1134',
        type: 'leader',
        title: '领涨',
        description: '算力概念 近1日+3.20%，处于当前板块领涨位置',
        sectorId: 'BK1134',
        severity: 3,
      },
    ],
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
    getRankedMarketSectors(snapshot, 'market', '1d').map((sector) => sector.id),
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

test('searches, sorts, and resolves watched sectors', () => {
  const snapshot = makeSnapshot();
  assert.equal(searchMarketSectors(snapshot, '算力')[0]?.id, 'BK1134');
  assert.equal(searchMarketSectors(snapshot, 'missing').length, 0);
  assert.equal(
    sortMarketSectors(snapshot.sectors, '1d', 'amount')[0]?.id,
    'BK1134',
  );
  assert.equal(
    getWatchSectorSummaries(snapshot, ['BK0732', 'missing'])[0]?.name,
    '贵金属',
  );
  assert.equal(getSignalSectors(snapshot)[0]?.sector.name, '算力概念');
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

test('accepts snapshot sectors without trend series or constituents', async () => {
  const snapshot = makeSnapshot({
    sectors: [
      { ...aiSector, series: [], constituents: [] },
      { ...manufacturingSector, series: [], constituents: [] },
    ],
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(snapshot), { status: 200 });
  try {
    const result = await fetchMarketRadarSnapshot(undefined, false, 'http://127.0.0.1:3000');
    assert.equal(result.sectors[0].series.length, 0);
    assert.equal(result.sectors[0].constituents.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('requests sector detail with a real news list', async () => {
  const snapshot = makeSnapshot();
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      ...snapshot.sectors[0],
      related: [{ id: 'BK1128', name: 'CPO概念', score: 92 }],
      news: [{ id: 'n1', title: 'AI 算力需求增长', publishedAt: '2026-08-01T08:00:00Z', summary: { oneSentence: '算力需求增长' }, sources: [] }],
    }), { status: 200 });
  };
  try {
    const detail = await fetchMarketRadarSectorDetail('BK1134', undefined, 'http://127.0.0.1:3000');
    assert.equal(detail.id, 'BK1134');
    assert.equal(detail.news.length, 1);
    assert.equal(requestedUrl, 'http://127.0.0.1:3000/api/v1/market-radar/sectors/BK1134');
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
