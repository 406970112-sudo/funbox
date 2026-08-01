import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  filterSSQHistoryDraws,
  formatSSQBall,
  paginateSSQHistoryDraws,
  validateSSQHistoryFilters,
} from '../lib/double-color-ball-history.ts';

const draws = [
  { issue: '2026005', date: '2026-08-01', red: [1, 5, 8, 16, 22, 33], blue: 9 },
  { issue: '2026004', date: '2026-07-29', red: [2, 6, 9, 17, 23, 31], blue: 4 },
  { issue: '2026003', date: '2026-07-27', red: [3, 7, 10, 18, 24, 30], blue: 12 },
  { issue: '2026002', date: '2026-07-24', red: [4, 8, 11, 19, 25, 29], blue: 2 },
  { issue: '2026001', date: '2026-07-22', red: [5, 9, 12, 20, 26, 28], blue: 16 },
];

test('limits history to the selected newest-first range', () => {
  const filtered = filterSSQHistoryDraws(draws, {
    range: 3,
    issue: '',
    startDate: '',
    endDate: '',
  });

  assert.deepEqual(filtered.map((draw) => draw.issue), ['2026005', '2026004', '2026003']);
});

test('matches a complete issue exactly within the selected range', () => {
  const filtered = filterSSQHistoryDraws(draws, {
    range: 5,
    issue: '2026003',
    startDate: '',
    endDate: '',
  });

  assert.deepEqual(filtered.map((draw) => draw.issue), ['2026003']);
});

test('filters draw dates with inclusive boundaries', () => {
  const filtered = filterSSQHistoryDraws(draws, {
    range: 5,
    issue: '',
    startDate: '2026-07-24',
    endDate: '2026-07-29',
  });

  assert.deepEqual(filtered.map((draw) => draw.issue), ['2026004', '2026003', '2026002']);
});

test('rejects a non-numeric issue', () => {
  assert.equal(
    validateSSQHistoryFilters({ issue: '2026A03', startDate: '', endDate: '' }),
    '期号只能输入数字',
  );
});

test('rejects a calendar date that does not exist', () => {
  assert.equal(
    validateSSQHistoryFilters({ issue: '', startDate: '2026-02-30', endDate: '' }),
    '日期格式需为 YYYY-MM-DD',
  );
});

test('rejects a start date after the end date', () => {
  assert.equal(
    validateSSQHistoryFilters({ issue: '', startDate: '2026-08-02', endDate: '2026-08-01' }),
    '开始日期不能晚于结束日期',
  );
});

test('paginates without mutating the filtered results', () => {
  const paginated = paginateSSQHistoryDraws(draws, 2);

  assert.deepEqual(paginated.items.map((draw) => draw.issue), ['2026005', '2026004']);
  assert.equal(paginated.hasMore, true);
  assert.equal(draws.length, 5);
});

test('formats single-digit balls with a leading zero', () => {
  assert.equal(formatSSQBall(3), '03');
  assert.equal(formatSSQBall(12), '12');
});

test('registers history results as a hidden available tool for every role', () => {
  const registry = JSON.parse(readFileSync(
    new URL('../../backend/internal/access/feature_registry.json', import.meta.url),
    'utf8',
  ));
  const tool = registry.find((item) => item.id === 'double-color-ball-history');

  assert.ok(tool);
  assert.equal(tool.route, '/tools/double-color-ball-history');
  assert.equal(tool.status, 'available');
  assert.equal(tool.hiddenFromList, true);
  assert.deepEqual(tool.initialRoles, ['normal', 'vip', 'svip', 'admin']);
});
