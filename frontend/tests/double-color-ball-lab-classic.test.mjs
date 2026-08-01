import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fetchSSQLabHistory,
  getSSQLabErrorMessage,
  SSQLabAPIError,
} from '../lib/double-color-ball-lab-api.ts';
import {
  buildLabBacktestCsv,
  buildLowFrequencyPrediction,
  buildNormalFitPrediction,
  buildTimeWeightedPrediction,
  evaluatePrize,
  runLabBacktest,
} from '../lib/double-color-ball-lab-classic.ts';

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

function makeConstantDraws(count, red, blue) {
  return Array.from({ length: count }, (_, index) => ({
    blue,
    date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
    firstPrize: 7000000,
    issue: String(2027000 - index),
    red: [...red],
    secondPrize: 200000,
  }));
}

test('low-frequency prediction picks least frequent reds and blue', () => {
  const draws = makeConstantDraws(30, [1, 2, 3, 4, 5, 6], 1);
  const prediction = buildLowFrequencyPrediction(draws);

  assert.deepEqual(prediction.red, [7, 8, 9, 10, 11, 12]);
  assert.equal(prediction.blue, 2);
});

test('time-weighted prediction responds to decay parameter', () => {
  const draws = [];
  const makeDraw = (issue, red, blue) => ({
    blue,
    date: '2026-01-01',
    firstPrize: 7000000,
    issue: String(issue),
    red: [...red].sort((left, right) => left - right),
    secondPrize: 200000,
  });
  const fillerRed = (offset) => Array.from({ length: 6 }, (_value, index) => ((offset * 6 + index) % 27) + 1);
  draws.push(makeDraw(2027000, [28, 29, 30, 31, 32, 33], 1));
  draws.push(makeDraw(2026999, [28, 29, 30, 31, 32, 33], 1));
  for (let index = 0; index < 8; index += 1) {
    draws.push(makeDraw(2026998 - index, fillerRed(index), 1));
  }
  for (let index = 0; index < 10; index += 1) {
    draws.push(makeDraw(2026990 - index, [7, 8, 9, 10, 11, 12], 2));
  }
  for (let index = 0; index < 10; index += 1) {
    draws.push(makeDraw(2026980 - index, fillerRed(index), 1));
  }

  const strongDecay = buildTimeWeightedPrediction(draws, 0.5);
  const gentleDecay = buildTimeWeightedPrediction(draws, 0.999);
  assert.deepEqual(
    [...strongDecay.red].sort((left, right) => left - right),
    [22, 23, 24, 25, 26, 27],
  );
  assert.deepEqual(
    [...gentleDecay.red].sort((left, right) => left - right),
    [28, 29, 30, 31, 32, 33],
  );
});

test('normal-fit prediction returns six unique sorted red balls and one blue', () => {
  const prediction = buildNormalFitPrediction(makeSequentialDraws(100));

  assert.equal(new Set(prediction.red).size, 6);
  assert.deepEqual(prediction.red, [...prediction.red].sort((left, right) => left - right));
  assert.ok(prediction.red.every((value) => value >= 1 && value <= 33));
  assert.ok(prediction.blue >= 1 && prediction.blue <= 16);
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

test('classic lab backtest uses only preceding draws and summarizes money flow', () => {
  const observedWindows = [];
  const summary = runLabBacktest(makeSequentialDraws(180), {
    algorithm: 'low-frequency',
    decay: 0.999,
    onWindow(target, history) {
      observedWindows.push({
        history: history.map((draw) => Number(draw.issue)),
        target: Number(target.issue),
      });
    },
    targetCount: 50,
    windowSize: 100,
  });

  assert.equal(summary.records.length, 50);
  assert.equal(observedWindows.length, 50);
  for (const item of observedWindows) {
    assert.equal(item.history.length, 100);
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

test('classic lab exports a UTF-8 CSV with header, rows and summary', () => {
  const summary = runLabBacktest(makeSequentialDraws(180), {
    algorithm: 'normal-fit',
    decay: 0.999,
    targetCount: 20,
    windowSize: 100,
  });
  const csv = buildLabBacktestCsv(summary);

  assert.ok(csv.startsWith('\uFEFF期号,日期,预测号码'));
  assert.ok(csv.includes('算法,正态拟合'));
  assert.ok(csv.includes('总成本(元),40'));
  assert.ok(csv.split('\r\n').length > 20);
});

test('classic lab requests the shared history endpoint with selected count', async () => {
  const originalFetch = globalThis.fetch;
  let requestedURL = '';
  globalThis.fetch = async (input) => {
    requestedURL = String(input);
    return new Response(JSON.stringify({
      count: 400,
      draws: makeSequentialDraws(400),
      fetchedAt: '2026-07-31T08:00:00Z',
      source: 'cwl',
      sourceUrl: 'https://www.cwl.gov.cn/example',
      stale: false,
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 });
  };
  try {
    const snapshot = await fetchSSQLabHistory(400, undefined, 'http://127.0.0.1:3000');
    assert.equal(requestedURL, 'http://127.0.0.1:3000/api/v1/lottery/ssq-lab/history?count=400');
    assert.equal(snapshot.count, 400);
    assert.equal(snapshot.draws.length, 400);
    assert.equal(snapshot.source, 'cwl');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    getSSQLabErrorMessage(new SSQLabAPIError('invalid_count', 400)),
    '数据期数范围无效，请选择 100 到 1000 期。',
  );
});
