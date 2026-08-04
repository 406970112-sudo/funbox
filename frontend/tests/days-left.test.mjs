import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCalendarDays,
  computeDaysLeft,
  cycleUnitLabel,
  formatDateCN,
  recordTypeLabel,
  riskLabel,
  sourceLabel,
} from '../lib/days-left.ts';

test('days left labels stay stable', () => {
  assert.equal(recordTypeLabel('fixed'), '固定到期');
  assert.equal(recordTypeLabel('opened'), '开封有效');
  assert.equal(recordTypeLabel('recurring'), '周期续费');
  assert.equal(recordTypeLabel('event'), '纪念日');
  assert.equal(cycleUnitLabel('year'), '年');
  assert.equal(cycleUnitLabel('month'), '月');
  assert.equal(cycleUnitLabel('week'), '周');
  assert.equal(sourceLabel('api'), '接口校验');
  assert.equal(sourceLabel('user'), '手动录入');
  assert.equal(riskLabel('overdue'), '已逾期');
  assert.equal(riskLabel('safe'), '安全');
});

test('days left calculations use local calendar boundaries', () => {
  assert.equal(computeDaysLeft('2026-10-26', '2026-08-04'), 83);
  assert.equal(computeDaysLeft('2026-08-04', '2026-08-04'), 0);
  assert.equal(computeDaysLeft('2026-08-03', '2026-08-04'), -1);
});

test('monthly calendar keeps real due counts and today highlight', () => {
  const due = new Map([['2026-08-10', 2]]);
  const cells = buildCalendarDays('2026-08', due);
  assert.equal(cells.length, 36);
  assert.equal(cells.filter((cell) => cell.day === 10)[0]?.count, 2);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  const todayCell = cells.find((cell) => cell.date === todayKey);
  if (todayCell) {
    assert.equal(todayCell.today, true);
  }
});

test('date formatting uses Chinese labels', () => {
  assert.equal(formatDateCN('2026-10-26'), '10月26日 周一');
});
