import test from 'node:test';
import assert from 'node:assert/strict';

import {
  currentMonthKey,
  formatFocusDate,
  formatPercent,
  formatTaskDue,
  habitFrequencyLabel,
  isOverdueTask,
  normalizeSubtaskLines,
  priorityLabel,
  repeatLabel,
  todayDateString,
} from '../lib/focus.ts';

test('focus date helpers format local dates', () => {
  const today = todayDateString(new Date(2026, 7, 1));
  assert.equal(today, '2026-08-01');
  assert.equal(currentMonthKey(new Date(2026, 7, 1)), '2026-08');
  assert.equal(formatFocusDate('2026-08-01'), '8月1日 周六');
  assert.equal(formatPercent(0.76), '76%');
});

test('focus task due text handles today, overdue and upcoming', () => {
  assert.equal(formatTaskDue({ dueDate: '2026-08-01', dueTime: '09:30' }, '2026-08-01'), '今天 09:30');
  assert.equal(formatTaskDue({ dueDate: '2026-07-31', dueTime: '' }, '2026-08-01'), '已逾期');
  assert.equal(formatTaskDue({ dueDate: '2026-08-05', dueTime: '14:00' }, '2026-08-01'), '8/5 14:00');
  assert.equal(formatTaskDue({ dueDate: '', dueTime: '' }, '2026-08-01'), '随时');
});

test('focus overdue detection only flags open tasks', () => {
  assert.equal(isOverdueTask({ dueDate: '2026-07-31', status: 'open' }, '2026-08-01'), true);
  assert.equal(isOverdueTask({ dueDate: '2026-08-01', status: 'open' }, '2026-08-01'), false);
  assert.equal(isOverdueTask({ dueDate: '2026-07-31', status: 'done' }, '2026-08-01'), false);
});

test('focus labels and subtask parsing stay stable', () => {
  assert.equal(priorityLabel('high'), '高');
  assert.equal(priorityLabel('medium'), '中');
  assert.equal(priorityLabel('low'), '低');
  assert.equal(repeatLabel('daily'), '每天');
  assert.equal(repeatLabel('weekly'), '每周');
  assert.equal(repeatLabel('monthly'), '每月');
  assert.equal(repeatLabel('none'), '不重复');
  assert.deepEqual(normalizeSubtaskLines('写大纲\n校对成稿\n\n'), ['写大纲', '校对成稿']);
  assert.equal(
    habitFrequencyLabel({ frequency: 'weekly', weekdays: [1, 3, 5] }),
    '周一/周三/周五',
  );
  assert.equal(habitFrequencyLabel({ frequency: 'daily', weekdays: [] }), '每天');
});
