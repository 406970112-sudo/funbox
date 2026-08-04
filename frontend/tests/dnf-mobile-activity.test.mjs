import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DNF_STATUS_LABELS,
  filterDnfActivities,
  formatDnfActivityDateRange,
  getDnfActivityDaysLabel,
  getDnfActivityStatusLabel,
  getDnfCalendarGrid,
  isLongRunning,
  isToday,
  sortDnfActivities,
} from '../lib/dnf-activity-model.ts';

function makeActivity(overrides = {}) {
  return {
    id: 'a1',
    sourceId: 'a1',
    title: '摸金秘境 星赠好礼',
    startDate: '2026-07-15',
    endDate: '2026-08-11',
    status: 'ongoing',
    daysLeft: 7,
    mobileUrl: 'https://act2.hdnf.qq.com/a20260625luckystar/index.html',
    fetchedAt: '2026-08-04T12:00:00+08:00',
    stale: false,
    ...overrides,
  };
}

test('maps activity status to Chinese labels', () => {
  assert.equal(getDnfActivityStatusLabel('ongoing'), '进行中');
  assert.equal(getDnfActivityStatusLabel('upcoming'), '未开始');
  assert.equal(getDnfActivityStatusLabel('ended'), '已结束');
  assert.equal(getDnfActivityStatusLabel('unknown'), '时间待确认');
  assert.equal(DNF_STATUS_LABELS.ongoing, '进行中');
});

test('formats real date ranges and days left', () => {
  const activity = makeActivity();
  assert.equal(formatDnfActivityDateRange(activity), '2026-07-15 ~ 2026-08-11');
  assert.equal(getDnfActivityDaysLabel(activity), '剩余 7 天');
  assert.equal(getDnfActivityDaysLabel(makeActivity({ status: 'ended' })), '');
  assert.equal(
    formatDnfActivityDateRange(makeActivity({ startDate: '', endDate: '' })),
    '时间以官网为准',
  );
});

test('marks long running official activities', () => {
  assert.equal(isLongRunning(makeActivity({ startDate: '2026-07-13', endDate: '2030-07-13' })), true);
  assert.equal(isLongRunning(makeActivity()), false);
});

test('filters by status and query without fake fallback', () => {
  const items = [
    makeActivity({ id: 'a', title: '摸金秘境 星赠好礼', status: 'ongoing' }),
    makeActivity({ id: 'b', title: '公会召集令', status: 'ongoing' }),
    makeActivity({ id: 'c', title: '开石鉴宝 点石成金', status: 'ended' }),
  ];
  assert.deepEqual(
    filterDnfActivities(items, 'ended', '').map((item) => item.id),
    ['c'],
  );
  assert.deepEqual(
    filterDnfActivities(items, '', '鉴宝').map((item) => item.id),
    ['c'],
  );
  assert.equal(filterDnfActivities(items, '', '不存在').length, 0);
});

test('sorts ongoing first by end date then ended', () => {
  const items = [
    makeActivity({ id: 'a', title: '摸金秘境', endDate: '2026-08-11', status: 'ongoing' }),
    makeActivity({ id: 'b', title: '公会召集令', endDate: '2026-08-09', status: 'ongoing' }),
    makeActivity({ id: 'c', title: '已结束活动', endDate: '2026-07-22', status: 'ended' }),
  ];
  const sorted = sortDnfActivities(items, 'ending');
  assert.deepEqual(
    sorted.map((item) => item.id),
    ['b', 'a', 'c'],
  );
});

test('builds calendar grid with real activity dots', () => {
  const grid = getDnfCalendarGrid(2026, 8, {
    '2026-08-04': ['a', 'b'],
    '2026-08-09': ['b'],
  });
  const todayCell = grid.find((cell) => cell.date === '2026-08-04');
  const emptyCell = grid.find((cell) => cell.date === '2026-08-20');
  assert.ok(todayCell);
  assert.equal(todayCell.has, true);
  assert.equal(emptyCell.has, false);
  assert.equal(grid.length % 7, 0);
});

test('detects today from local date', () => {
  const now = new Date();
  const local = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  assert.equal(isToday(local), true);
  assert.equal(isToday('2099-01-01'), false);
});
