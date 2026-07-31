import assert from 'node:assert/strict';
import test from 'node:test';

import {
  analyzeDraws,
  generateReferenceBatch,
  getDrawStructure,
  runWalkForwardBacktest,
} from '../lib/double-color-ball.ts';

function makeSequentialDraws(count) {
  return Array.from({ length: count }, (_, index) => {
    const start = (index % 28) + 1;
    return {
      blue: (index % 16) + 1,
      date: `2026-01-${String((index % 28) + 1).padStart(2, '0')}`,
      issue: String(2027000 - index),
      red: Array.from({ length: 6 }, (_value, offset) => start + offset),
    };
  });
}

test('computes frequency totals, omissions and structures for the selected window', () => {
  const draws = makeSequentialDraws(30);
  const analysis = analyzeDraws(draws, 30);

  assert.equal(analysis.redStats.reduce((sum, stat) => sum + stat.frequency, 0), 180);
  assert.equal(analysis.blueStats.reduce((sum, stat) => sum + stat.frequency, 0), 30);
  assert.equal(analysis.latestDraw.issue, '2027000');
  assert.equal(analysis.redStats.find((item) => item.number === 1)?.omission, 0);
  assert.equal(analysis.redStats.find((item) => item.number === 33)?.omission, 27);
  assert.deepEqual(getDrawStructure({ red: [1, 2, 12, 17, 23, 33] }), {
    consecutivePairs: 1,
    oddCount: 4,
    redSum: 88,
    zones: [2, 2, 2],
  });
});

test('classifies exactly eight hot and eight cold red balls by activity rank', () => {
  const analysis = analyzeDraws(makeSequentialDraws(100), 100);

  assert.equal(analysis.redStats.filter((item) => item.temperature === 'hot').length, 8);
  assert.equal(analysis.redStats.filter((item) => item.temperature === 'cold').length, 8);
  assert.equal(analysis.redStats.filter((item) => item.temperature === 'neutral').length, 17);
});

test('rejects analysis when the requested newest-first window is incomplete', () => {
  assert.throws(
    () => analyzeDraws(makeSequentialDraws(29), 30),
    /至少需要 30 期开奖数据/,
  );
});

test('generates a deterministic legal low-overlap batch that follows strict structure rules', () => {
  const analysis = analyzeDraws(makeSequentialDraws(300), 100);
  const first = generateReferenceBatch(analysis, 0);
  const repeated = generateReferenceBatch(analysis, 0);

  assert.deepEqual(first, repeated);
  assert.equal(first.combinations.length, 5);
  for (const item of first.combinations) {
    assert.equal(new Set(item.red).size, 6);
    assert.deepEqual(item.red, [...item.red].sort((left, right) => left - right));
    assert.ok(item.red.every((value) => value >= 1 && value <= 33));
    assert.ok(item.blue >= 1 && item.blue <= 16);
    assert.ok(item.structureScore >= 0 && item.structureScore <= 100);
    assert.ok(item.structure.oddCount >= 2 && item.structure.oddCount <= 4);
    assert.ok(item.structure.latestRepeatCount <= 2);
    assert.ok(analysis.commonZonePatterns.some((pattern) => pattern.join('-') === item.structure.zones.join('-')));
    if (!item.relaxedConstraints.includes('sum-range')) {
      assert.ok(item.structure.redSum >= analysis.sumRange[0]);
      assert.ok(item.structure.redSum <= analysis.sumRange[1]);
    }
  }
  for (let left = 0; left < first.combinations.length; left += 1) {
    for (let right = left + 1; right < first.combinations.length; right += 1) {
      const overlap = intersectionSize(first.combinations[left].red, first.combinations[right].red);
      if (!first.combinations[right].relaxedConstraints.includes('batch-overlap')) {
        assert.ok(overlap <= 2);
      }
    }
  }
});

test('changes deterministic references when the batch index changes', () => {
  const analysis = analyzeDraws(makeSequentialDraws(300), 100);
  assert.notDeepEqual(generateReferenceBatch(analysis, 0), generateReferenceBatch(analysis, 1));
});

test('walk-forward backtest uses only preceding draws and accounts for every generated combination', () => {
  const observedWindows = [];
  const result = runWalkForwardBacktest(makeSequentialDraws(180), 100, {
    onWindow(target, history) {
      observedWindows.push({
        history: history.map((draw) => Number(draw.issue)),
        target: Number(target.issue),
      });
    },
  });

  assert.equal(result.sampleCount, 60);
  assert.equal(observedWindows.length, 60);
  for (const item of observedWindows) {
    assert.equal(item.history.length, 100);
    assert.ok(item.history.every((issue) => issue < item.target));
  }
  assert.equal(
    result.hitBuckets.zeroToOne + result.hitBuckets.twoToThree + result.hitBuckets.fourPlus,
    300,
  );
  assert.ok(result.blueHits >= 0 && result.blueHits <= 300);
});

function intersectionSize(left, right) {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value)).length;
}

export { makeSequentialDraws };
