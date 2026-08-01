import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSSQLabHistory,
  getSSQLabErrorMessage,
  SSQLabAPIError,
} from '../lib/double-color-ball-lab-api.ts';
import {
  buildLabBacktestCsv,
  buildProbabilityPrediction,
  buildProbabilityWeightedPrediction,
  buildRandomPrediction,
  evaluatePrize,
  runLabBacktest,
} from '../lib/double-color-ball-lab.ts';

function makeSequentialDraws(count) {
  return Array.from({ length: count }, (_, index) => {
    const start = (index % 28) + 1;
    return {
      blue: (index % 16) + 1,
      date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      firstPrize: 7000000 + index * 1000,
      issue: String(2027000 - index),
      red: Array.from({ length: 6 }, (_value, offset) => start + offset),
      secondPrize: 200000 + index * 100,
    };
  });
}

function makeRecencyDraws() {
  return Array.from({ length: 40 }, (_value, index) => ({
    blue: 1,
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    firstPrize: 7000000,
    issue: String(2027000 - index),
    red: index < 10 ? [7, 8, 9, 10, 11, 12] : [1, 2, 3, 4, 5, 6],
    secondPrize: 200000,
  }));
}

test('probability prediction picks the most frequent reds and blue', () => {
  const prediction = buildProbabilityPrediction(makeRecencyDraws());

  assert.deepEqual(prediction.red, [1, 2, 3, 4, 5, 6]);
  assert.equal(prediction.blue, 1);
});

test('probability weight shifts between frequency and recency', () => {
  const draws = makeRecencyDraws();

  assert.deepEqual(buildProbabilityWeightedPrediction(draws, 100).red, [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(buildProbabilityWeightedPrediction(draws, 0).red, [7, 8, 9, 10, 11, 12]);
});

test('random prediction returns six unique sorted red balls and one blue', () => {
  const draws = makeSequentialDraws(100);
  const first = buildRandomPrediction(draws, () => 0.2);
  const repeated = buildRandomPrediction(draws, () => 0.2);

  assert.deepEqual(first, repeated);
  assert.equal(new Set(first.red).size, 6);
  assert.deepEqual(first.red, [...first.red].sort((left, right) => left - right));
  assert.ok(first.red.every((value) => value >= 1 && value <= 33));
  assert.ok(first.blue >= 1 && first.blue <= 16);
});

test('evaluates official fixed and floating prize levels', () => {
  assert.deepEqual(evaluatePrize(6, true, 9000000, 300000), { level: 'first', prize: 9000000 });
  assert.deepEqual(evaluatePrize(6, false, 9000000, 300000), { level: 'second', prize: 300000 });
  assert.deepEqual(evaluatePrize(5, true, 9000000, 300000), { level: 'third', prize: 3000 });
  assert.deepEqual(evaluatePrize(5, false, 9000000, 300000), { level: 'fourth', prize: 200 });
  assert.deepEqual(evaluatePrize(4, true, 9000000, 300000), { level: 'fourth', prize: 200 });
  assert.deepEqual(evaluatePrize(4, false, 9000000, 300000), { level: 'fifth', prize: 10 });
  assert.deepEqual(evaluatePrize(3, true, 9000000, 300000), { level: 'fifth', prize: 10 });
  assert.deepEqual(evaluatePrize(2, true, 9000000, 300000), { level: 'sixth', prize: 5 });
  assert.deepEqual(evaluatePrize(0, true, 9000000, 300000), { level: 'sixth', prize: 5 });
  assert.deepEqual(evaluatePrize(0, false, 9000000, 300000), { level: 'none', prize: 0 });
});

test('lab backtest uses only preceding draws and summarizes money flow', () => {
  const observedWindows = [];
  const summary = runLabBacktest(makeSequentialDraws(180), {
    algorithm: 'probability-weighted',
    onWindow(target, history) {
      observedWindows.push({
        history: history.map((draw) => Number(draw.issue)),
        target: Number(target.issue),
      });
    },
    targetCount: 50,
    weight: 50,
    windowSize: 30,
  });

  assert.equal(summary.records.length, 50);
  assert.equal(observedWindows.length, 50);
  for (const item of observedWindows) {
    assert.equal(item.history.length, 30);
    assert.ok(item.history.every((issue) => issue < item.target));
  }
  assert.equal(summary.totalCost, 100);
  assert.equal(
    summary.redHitBuckets.zeroToOne
      + summary.redHitBuckets.twoToThree
      + summary.redHitBuckets.fourPlus,
    50,
  );
  assert.equal(summary.net, summary.totalPrize - summary.totalCost);
  assert.equal(summary.evPerTicket, summary.totalPrize / summary.totalCost);
  assert.ok(summary.totalPrize >= 0);
});

test('exports a UTF-8 CSV with header, rows and summary', () => {
  const summary = runLabBacktest(makeSequentialDraws(180), {
    algorithm: 'probability',
    targetCount: 20,
    weight: 50,
    windowSize: 30,
  });
  const csv = buildLabBacktestCsv(summary);

  assert.ok(csv.startsWith('\uFEFF期号,日期,预测号码'));
  assert.ok(csv.includes('算法,概率预测法'));
  assert.ok(csv.includes('总成本(元),40'));
  assert.ok(csv.split('\r\n').length > 20);
});

test('requests the lab history endpoint with selected count', async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = '';
  globalThis.fetch = async (input) => {
    requestedURL = String(input);
    return new Response(JSON.stringify({
      count: 1000,
      draws: makeSequentialDraws(1000),
      fetchedAt: '2026-07-31T08:00:00Z',
      source: 'cwl',
      sourceUrl: 'https://www.cwl.gov.cn/example',
      stale: false,
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  };
  try {
    const snapshot = await fetchSSQLabHistory(1000, undefined, 'http://127.0.0.1:3000');
    assert.equal(requestedURL, 'http://127.0.0.1:3000/api/v1/lottery/ssq-lab/history?count=1000');
    assert.equal(snapshot.count, 1000);
    assert.equal(snapshot.draws.length, 1000);
    assert.equal(snapshot.source, 'cwl');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    getSSQLabErrorMessage(new SSQLabAPIError('invalid_count', 400)),
    '数据期数范围无效，请选择 100 到 1000 期。',
  );
});
